# HTTP API security contract

## Authentication

`AuthTokens` contains an access token, refresh token, and `expiresIn`; `RefreshRequest` and `LogoutRequest` carry a refresh token. Access tokens are short-lived bearer credentials and MUST be sent only over TLS in the `Authorization: Bearer <token>` header. Refresh tokens MUST be stored server-side as one-way hashes with family/session metadata, rotated on every successful refresh, and invalidated on logout.

A refresh token is single-use. Reusing a consumed token is a replay signal: revoke the entire token family/session and return a generic authentication error. The response MUST NOT issue a replacement token after replay. Login, register, refresh, and logout errors MUST avoid revealing whether an email or token exists.

The current type package defines payload DTOs but no route path, status-code, error-code, or cookie policy registry. The route table below is the required logical surface for integration; implementations MUST publish the concrete paths and preserve these authorization rules.

## Logical operation matrix

| Operation       | Input contract            | Required authorization                        | Security requirements                                                                                                              |
| --------------- | ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Register        | `RegisterRequest`         | Anonymous                                     | Normalize and validate email/username; hash password; do not return password material.                                             |
| Login           | `LoginRequest`            | Anonymous                                     | Constant-work password verification; generic invalid-credential response; rotate/create refresh family.                            |
| Refresh         | `RefreshRequest`          | Refresh credential                            | Atomic consume-and-rotate; detect replay and revoke family.                                                                        |
| Logout          | `LogoutRequest`           | Refresh credential/session owner              | Revoke the presented session/family; idempotent generic success is acceptable.                                                     |
| Create server   | `CreateServerRequest`     | Access token                                  | New caller becomes owner/member with the documented administrative grant; creation is transactional.                               |
| Server snapshot | `ServerSnapshot`          | Access token + membership                     | Do not include servers/channels/memberships outside caller visibility.                                                             |
| Create channel  | `CreateChannelRequest`    | Membership + `MANAGE_CHANNELS`                | Validate server ownership and channel type/name; publish only after commit.                                                        |
| Create invite   | `CreateInviteRequest`     | Membership + server-management permission     | Generate high-entropy, non-guessable code; atomically enforce expiry/max uses.                                                     |
| Accept invite   | Invite code (path/body)   | Access token + valid code                     | Enforce expiry and max uses atomically; joining twice is idempotent; never leak private server data on invalid code.               |
| Message history | `MessagePage` response    | Membership + `VIEW_CHANNEL`                   | Cursor must be opaque, bounded, and scoped to channel/user visibility; deleted content remains deleted.                            |
| Send message    | `SendMessageRequest`      | Membership + `VIEW_CHANNEL` + `SEND_MESSAGES` | Enforce server-side content/attachment limits; `clientNonce` deduplicates retries per author/channel.                              |
| Update message  | `UpdateMessageRequest`    | Author or `MANAGE_MESSAGES`                   | Re-check message channel membership and current lifecycle in the same transaction.                                                 |
| Delete message  | Message identifier        | Author or `MANAGE_MESSAGES`                   | Soft-delete consistently in history and events; never allow cross-server IDs to bypass channel checks.                             |
| Media token     | `MediaTokenRequest`       | Membership + channel visibility + `CONNECT`   | Grant media capabilities separately: microphone requires `SPEAK`, camera/screen requires `STREAM`; use short-lived, scoped tokens. |
| Voice state     | `MediaVoiceStateResponse` | Membership + `VIEW_CHANNEL`                   | Read active LiveKit rooms server-side; expose only participants and track state from voice channels visible to the caller.         |

## Request and response invariants

- Every protected response is scoped to the authenticated user and current membership. IDs are not authorization.
- Error responses use the shared `ApiError` shape (`code`, generic `message`, `requestId`, optional validation `details`). Validation details MUST never echo passwords, refresh tokens, invite codes, signed URLs, or private membership data.
- `requestId` is for support/correlation, not a secret or an authorization decision.
- Pagination cursors are opaque and must be rejected when replayed against another channel or user scope.
- Create/send endpoints must be idempotent where the request contract supplies a nonce. A duplicate `clientNonce` returns the original message, not a second message.
- Authorization checks occur before loading sensitive records where possible, and inaccessible/unknown resources use indistinguishable errors.

## Upload threat boundary

Attachments use a private S3-compatible bucket. `Attachment.url` is the authenticated content
route, never a storage capability. The upload lifecycle is:

1. `POST /channels/:channelId/attachments` accepts `filename`, `mimeType`, and `size`, checks
   `SEND_MESSAGES`, persists a `PENDING` attachment, and returns `attachmentId`, a short-lived
   `uploadUrl`, required `headers`, and `expiresIn`.
2. The client uploads the exact bytes with the returned headers, then calls
   `POST /attachments/:id/complete`. Completion is uploader-only and verifies the object with S3
   `HEAD`, including exact byte size and content type, before moving the record to `READY`.
3. Message creation claims the complete requested attachment set in the same transaction as the
   message. Every attachment must be unclaimed, `READY`, owned by the author, and scoped to the
   target channel; otherwise the whole transaction fails.
4. `GET /attachments/:id/content` authorizes the uploader while the attachment is unassigned and a
   channel member after claim, then redirects to a separately signed short-lived GET URL.
5. Clients treat filename and MIME as untrusted metadata. They do not execute uploaded content or
   render SVG/HTML as image previews.

## Integration blockers

The current implementation now exposes Fastify routes and a Prisma repository, so executable DI tests cover authentication, membership, invites, messages, and realtime policy helpers. The following blockers remain evidence-backed findings:

- `PrismaRepository.acceptInvite` reads `uses` before a transaction and increments without a conditional update; concurrent accepts can exceed `maxUses`. It also throws a plain `Error`, which the HTTP error handler maps to `500 INTERNAL_ERROR` rather than a stable invalid-invite response.
- `PrismaRepository.listMessages` does not filter `deletedAt`, so deleted message content can reappear in history.
- Refresh-session family identity is reconstructed as `userId` in `findRefreshSession`, and `revokeRefreshFamily` filters by `userId`; family revocation is therefore broader than the stored family contract and can revoke unrelated sessions.
- `AuthService.refresh` relies on the repository rotation primitive for compare-and-swap semantics; the current Prisma transaction updates the consumed session without a `revokedAt IS NULL` guard, so concurrent refresh requests need a uniqueness/conditional-update fix.

These findings must be fixed or explicitly accepted before production security sign-off. The tests in `apps/server/test/` intentionally exercise the stable authorization behavior and document missing persistence-level race assertions that require a database-backed test fixture.
