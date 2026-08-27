# Authorization and permission bitfields

## Evidence and scope

This document describes the authorization contract exposed by `@guilda/types` and the server-side checks required by the architecture. The current repository defines the bit constants in `packages/types/src/entities.ts`; role assignments exist in the Prisma schema and permission evaluation exists in `apps/server/src/modules/permissions.ts`, but those role contracts are not yet represented in shared DTOs. Those boundaries are integration concerns, not client defaults: clients MUST NOT decide authorization locally.

## Bitfield definition

`Permission` is a numeric bitfield. A permission is granted when `(permissions & bit) === bit`; checks MUST use bitwise inclusion rather than equality so multiple grants compose.

|                Bit | Name              | Protected capability                                                    |
| -----------------: | ----------------- | ----------------------------------------------------------------------- |
|     `1 << 0` (`1`) | `VIEW_CHANNEL`    | Read a channel snapshot and message history; receive channel events.    |
|     `1 << 1` (`2`) | `SEND_MESSAGES`   | Create messages in a text channel.                                      |
|     `1 << 2` (`4`) | `MANAGE_MESSAGES` | Edit/delete messages not owned by the caller, subject to server policy. |
|     `1 << 3` (`8`) | `MANAGE_CHANNELS` | Create or modify channels and channel visibility.                       |
|    `1 << 4` (`16`) | `MANAGE_SERVER`   | Modify server settings and create/manage server-level resources.        |
|    `1 << 5` (`32`) | `KICK_MEMBERS`    | Remove a member from a server.                                          |
|    `1 << 6` (`64`) | `BAN_MEMBERS`     | Ban a member from a server.                                             |
|   `1 << 7` (`128`) | `MANAGE_ROLES`    | Create or change roles and their grants.                                |
|   `1 << 8` (`256`) | `CONNECT`         | Obtain a voice/media connection token.                                  |
|   `1 << 9` (`512`) | `SPEAK`           | Publish microphone audio in a voice room.                               |
| `1 << 10` (`1024`) | `STREAM`          | Publish camera or screen-share media.                                   |

`PermissionBitfield` is currently typed as `number`. Server code MUST reject unknown bits when accepting role updates, and MUST avoid JavaScript signed-bitwise surprises if the set grows beyond bit 30 (use a wider representation before adding such bits).

## Required authorization invariants

1. Authentication precedes authorization. Every protected HTTP request and Socket.IO handshake must authenticate the presented access token and bind the request to one user ID.
2. Membership is an independent prerequisite. A valid token alone never grants access to a server, channel, invite, message, or realtime room.
3. Channel access requires `VIEW_CHANNEL`; message creation additionally requires `SEND_MESSAGES`.
4. The author may update/delete their own message only while it exists and only under the message lifecycle policy. A caller changing another user's message requires `MANAGE_MESSAGES`.
5. Channel administration requires `MANAGE_CHANNELS`; server administration requires `MANAGE_SERVER`. These checks are not interchangeable.
6. Invite creation and revocation require server administration. Accepting an invite requires a valid, unexpired, non-exhausted code and must be idempotent for an existing member.
7. Voice/media token issuance requires membership, channel visibility and `CONNECT`; the resulting media-plane capabilities are checked independently (`SPEAK` and `STREAM`).
8. Realtime room joins and every command are checked server-side. Membership checked only during handshake is insufficient because membership and permissions can change mid-connection.
9. Authorization failures MUST be indistinguishable where disclosure would reveal resource existence (for example, return the same response for an inaccessible channel and an unknown channel). Error details MUST NOT include membership or invite information to an unauthorized caller.
10. All mutating operations MUST be atomic with their authorization-sensitive state transition. Invite use increments, membership creation, token rotation, and message creation must not be raceable by concurrent requests.

## Missing data required before implementation can be considered secure

- Role and role-assignment persistence exists, but there is no shared role DTO or documented owner/role hierarchy policy. A role editor must not be able to grant permissions above its own authority.
- The canonical evaluator accepts arbitrary numeric bits and does not reject unknown permission bits at write time.
- HTTP and realtime route/event code now exists, but no single registry or contract test guarantees that every new operation selects the correct server/channel/media permission.
- Upload initiation has a size bound but no shared MIME allowlist, object ownership/completion, message-binding, or authorized download contract; see `docs/api.md`.

These gaps are security acceptance criteria, not reasons to add client-side checks. Keep authorization server-side and add persistence-backed race tests for invite use and refresh rotation.

The existing QA tests assert the evaluator and route guards; persistence-backed tests are still required before production security sign-off. A UI that hides controls without these server checks is not a security boundary.
