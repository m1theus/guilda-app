# Realtime security contract

## Evidence and scope

`packages/types/src/events.ts` defines Socket.IO client commands, server events, and `SocketData` (`userId`, `sessionId`). `docs/architecture.md` states that Socket.IO authenticates access tokens and validates membership/permissions before room entry or commands. This document turns those statements into enforceable rules; it does not replace a server implementation.

## Handshake and connection lifecycle

- The client presents a short-lived access token through the Socket.IO auth payload or an `Authorization` header over TLS. Tokens in query strings, room names, logs, or event payloads are prohibited.
- The server verifies signature, issuer/audience, expiry, and session revocation before accepting the handshake. It sets `socket.data.userId` and `socket.data.sessionId` from verified claims, never from client-supplied `SocketData`.
- Invalid, expired, revoked, or absent credentials are rejected before the socket becomes observable to other users. Failure responses are generic.
- A connected socket is not permanently authorized. Membership, bans, permission changes, logout, and refresh-family revocation must invalidate or re-evaluate affected sockets; disconnect stale sessions promptly.
- Rate-limit connection attempts and command acknowledgements. Do not log bearer or refresh tokens.

## Rooms and event authorization

Room identifiers are opaque server-generated values or validated `server:<id>`/`channel:<id>` names; room membership is never treated as proof of authorization. Before joining or subscribing to a server/channel room, the server checks current membership and the required channel permission (`VIEW_CHANNEL`). A user may only receive events for resources they can currently view.

Every command is independently validated against the authenticated socket and current state:

| Command                        | Required checks                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `message:create`               | Member of channel's server, `VIEW_CHANNEL` and `SEND_MESSAGES`; validate content, nonce, reply, and attachments in that channel. |
| `typing:start` / `typing:stop` | Member with `VIEW_CHANNEL`; payload channel must be visible to the caller.                                                       |
| `presence:update`              | Authenticated session; status must be one of the shared `PresenceStatus` values; scope broadcast to authorized peers.            |

Server events (`message:create`, `message:update`, `message:delete`, `channel:create`, `member:join`, `member:leave`, presence, and typing) are emitted only to sockets authorized for the event's server/channel at emission time. Never trust a client-provided recipient room. A failed command acknowledgement uses the shared `RealtimeError` shape and must not disclose inaccessible resource existence.

## Message and history consistency

`clientNonce` is an idempotency key scoped at least to author and channel. Concurrent duplicate commands produce one durable message and one create event. The server must persist before broadcasting; reconnect/history must not expose a message that failed persistence. Deleted messages must not leak content in history, replay, or realtime update payloads.

## Presence and privacy

Presence and typing are ephemeral, user-scoped signals. Broadcast them only to users who can view the relevant server/channel, and clear state on disconnect/timeout. A user cannot set another user's status or inject another user's `userId`; event user IDs come from verified socket data.

## Media authorization

Realtime channel access does not grant media privileges. Media token issuance requires membership, channel visibility and `CONNECT`; media-plane grants are independently constrained by `SPEAK` and `STREAM`. Tokens must be short-lived, audience-scoped, room-scoped, participant-scoped, and revoked when membership or permissions are removed.

## Upload event boundary

Realtime messages may reference only server-issued attachment IDs that are already authorized and bound to the same channel/message flow. Clients must never broadcast arbitrary storage URLs, object keys, MIME types, or completion events. Storage access remains an HTTP signed-URL decision under the rules in `docs/api.md`.

## Required abuse controls

Enforce payload size and schema validation before domain work; cap event rate and acknowledgement waiters; isolate per-socket errors; and use server-side request IDs for audit correlation. Room names, user IDs, message IDs and invite codes are untrusted input. Tests must cover an authenticated non-member attempting room entry, history, typing, and message creation, plus a member whose permission is revoked while connected.

## Current blockers

The repository now has a Socket.IO server, handshake middleware, room initialization, and exported authorization helpers; `apps/server/test/realtime.test.ts` exercises the helper boundary. Remaining evidence-backed blockers are:

- Initial room membership is loaded at connection time and cached in `socket.data.memberships`; permission or membership revocation requires an explicit disconnect/reload path that is not present in the current server.
- `emitChannelCreated`, `emitMemberJoined`, and `emitMemberLeft` broadcast to server rooms without re-checking current membership for each connected socket. This is safe only if stale sockets are reliably disconnected on revocation, which is not currently demonstrated.
- Presence updates correctly bind the user ID to verified socket data, but presence visibility is broadcast to the whole server room; a server-level privacy policy is not represented in the contracts.
- There is no Socket.IO history command; history remains the HTTP endpoint and must preserve its `VIEW_CHANNEL` checks.

These are integration blockers for production sign-off, not test skips. Add a database-backed revocation scenario and a two-client Socket.IO receive assertion when the runtime harness is available.
