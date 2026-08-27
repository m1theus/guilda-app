# Current milestone

Milestone 1 — Integrated runtime baseline

## Completed

- [x] Monorepo workspace dependencies and locked install
- [x] Shared API, entity, realtime and media contracts
- [x] Database schema, Prisma repository and seed
- [x] Fastify HTTP routes, health/readiness checks and auth
- [x] Socket.IO realtime presence and messaging integration
- [x] LiveKit media authorization and desktop media controls
- [x] React desktop shell and Vite production build
- [x] Root format, lint, typecheck and test checks

## In progress

- [ ] Local PostgreSQL, Redis and LiveKit infrastructure exercise
- [ ] Native Tauri packaging validation on a configured Rust toolchain

## Blocked

None for the JavaScript workspace checks. Native Tauri packaging was not exercised
in this validation; the repository now exposes locked native checks and a tagged
native-runner release matrix.

## Next integration

Exercise the containerized dependencies, then run `pnpm desktop:native:check` and
a host-native `VITE_API_URL=... pnpm --filter @guilda/desktop tauri build --debug`
on a machine with the platform prerequisites documented in `development.md`.
