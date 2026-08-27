# Guilda

Guilda is a modular monolith for community text, voice and media, with a Tauri desktop client. The server owns authentication, authorization and persistence; the desktop app consumes the shared contracts.

## Requirements

- Node.js 22+
- pnpm 9.12+
- Docker Desktop (for local infrastructure)
- Rust 1.77+ and the host-specific Tauri 2 prerequisites when building the
  native application

## Quick start

```sh
pnpm install
cp .env.example .env
pnpm infra:up
pnpm check
```

`pnpm check` runs formatting, linting, typechecking, tests and builds across the workspace. Run `pnpm dev` to start the server and desktop development processes once their packages are available.

## Workspace packages

| Package              | Responsibility                                   |
| -------------------- | ------------------------------------------------ |
| `@guilda/types`      | Shared API, entity, realtime and media contracts |
| `@guilda/validation` | Runtime validation for API inputs                |
| `@guilda/database`   | Prisma schema and PostgreSQL access              |
| `@guilda/server`     | Fastify HTTP and realtime modular monolith       |
| `@guilda/desktop`    | Tauri and React desktop client                   |
| `@guilda/config`     | Shared ESLint and Prettier configuration         |

Only `@guilda/types` is a cross-workstream contract package. Domain authorization and persistence stay server-side.

## Local infrastructure

`docker compose up -d` starts PostgreSQL, Redis, MinIO and LiveKit with health
checks. This Compose file is development-only and binds every published port to
the loopback interface. The local endpoints are:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO API: `http://localhost:9100`
- MinIO console: `http://localhost:9101`
- LiveKit: `ws://localhost:7880`

The credentials in `.env.example` and `infrastructure/livekit/livekit.yaml` are for local development only; never reuse them in a shared or production deployment.

Useful commands:

```sh
pnpm infra:logs
pnpm infra:down
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Native desktop commands:

```sh
pnpm desktop:native:dev
pnpm desktop:native:check
VITE_API_URL=https://api.example.com pnpm desktop:native:build
```

Native bundles are host-specific and remain unsigned unless real
signing/notarization credentials are supplied outside the repository. See
[docs/development.md](docs/development.md) for platform packages, keyring,
deep-link limitations and release commands.

See [docs/development.md](docs/development.md) for workspace conventions and troubleshooting.

## Official distribution

- Web: https://noxera.online/
- Windows: https://apps.microsoft.com/detail/9p4np4hlsp8t

Production infrastructure and deployment automation are intentionally maintained
outside this public source repository.

## License

Guilda is available under the [MIT License](LICENSE).
