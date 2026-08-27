# Development

## Setup

Use Node.js 22 or newer and pnpm 9.12 or newer. Web-only development additionally
uses Docker Desktop for local services. Native desktop work requires Rust 1.77+
(`rustup` is recommended) and the Tauri 2 platform prerequisites below.

```sh
pnpm install
cp .env.example .env
pnpm infra:up
```

`.env` is ignored by Git. The checked-in example contains non-secret local defaults only.

## Workspace commands

Commands run from the root and use pnpm's workspace recursion where appropriate:

| Command             | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `pnpm dev`          | Start server and desktop development processes in parallel |
| `pnpm format`       | Format supported source and configuration files            |
| `pnpm format:check` | Verify formatting without changing files                   |
| `pnpm lint`         | Run the shared ESLint flat configuration                   |
| `pnpm typecheck`    | Typecheck every package exposing that script               |
| `pnpm test`         | Run package tests                                          |
| `pnpm build`        | Build every package exposing that script                   |
| `pnpm check`        | Run formatting, lint, typecheck, test and build checks     |

Run a package command without leaving the root with `pnpm --filter <package> <command>`, for example:

```sh
pnpm --filter @guilda/validation typecheck
```

## Native desktop

Install the host-specific Tauri prerequisites before running native commands:

- **macOS 11+**: Xcode Command Line Tools (`xcode-select --install`). Building a
  distributable DMG requires a full Xcode installation and accepting its license.
- **Windows 10/11**: Microsoft C++ Build Tools with the Desktop development with
  C++ workload and WebView2. MSI creation also requires the WiX tooling downloaded
  by Tauri during the first bundle.
- **Ubuntu 22.04**: `build-essential`, `libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsecret-1-dev`, and
  `patchelf`. Other distributions must provide equivalent WebKitGTK 4.1 and
  Secret Service development packages.

Run the Vite UI in a browser with `pnpm --filter @guilda/desktop dev`, or launch
the native shell with:

```sh
pnpm desktop:native:dev
pnpm desktop:native:check
pnpm desktop:native:test
```

The native dev command merges `src-tauri/tauri.dev.conf.json`, which is the only
Tauri configuration allowing localhost HTTP/WebSocket connections. Production
CSP allows secure `https:` and `wss:` endpoints only. Browser development persists
the complete access/refresh/expiry bundle in localStorage so refreshes survive
reloads; an invalid refresh clears it, while transient hydration failures preserve
it for a later retry. Installed Tauri bundles store the same bundle in Keychain,
Credential Manager, or Secret Service without a localStorage or plaintext fallback.
Linux therefore needs a running Secret Service implementation.

Public invites use `https://noxera.online/invite/<code>` and the web client carries
the code through authentication into the join flow. The installed desktop shell
still recognizes the private `guilda://invite/<code>` protocol for native launch
events, but generated and copied invites never expose that scheme.

Camera and microphone consent remains WebView-managed. On Windows, **Share screen**
opens an in-app list of screens and visible, non-minimized windows, then sends the
selected source through native Windows Graphics Capture; the WebView picker is not
used. Browser and macOS builds continue to use `getDisplayMedia`, while Linux screen
capture depends on its desktop portal and compositor. System-audio capture is not
claimed as supported by the shell.

## Native release builds

Production endpoints are build inputs, not committed defaults. Set a real HTTPS
API URL for a local release build:

```sh
VITE_API_URL=https://api.example.com pnpm desktop:native:build
```

Tauri builds only for the current host. Configure platform-owner signing outside
the repository and keep certificates, passwords, identities and publishing
credentials in a dedicated secret manager. Set server `CORS_ORIGIN` to an exact
allowlist for the installed targets in use; never use `*` with credentialed
requests.

## Local services

The Compose stack is deliberately development-only:

```sh
pnpm infra:up
pnpm infra:logs
pnpm infra:down
```

PostgreSQL, Redis, MinIO, and LiveKit persist data in named Docker volumes and
publish only to `127.0.0.1`. Remove volumes only when intentionally resetting
local state. LiveKit reads `infrastructure/livekit/livekit.yaml`; its development
credentials must never be reused outside the local stack.

`docker-compose.yml` is not a production deployment manifest.

## Production deployment

Production infrastructure, deployment workflows, provider-specific IaC and
operational runbooks are intentionally maintained outside this public source
repository. Use isolated environments, least-privilege identities, encrypted
state, a secret manager, immutable artifacts, readiness checks and a documented
rollback procedure for your own deployment.

## Package boundaries

- Import cross-workstream DTOs and entities from `@guilda/types`.
- Validate untrusted HTTP payloads with `@guilda/validation` before domain logic.
- Keep database adapters in `@guilda/database`; do not import Prisma into the desktop app.
- Keep authorization and external-service credentials in the server process.
- Preserve the exact package names `@guilda/types`, `@guilda/database`, `@guilda/server` and `@guilda/desktop` when adding workspaces.

## CI

GitHub Actions uses Node 22 and pnpm 9.12, installs with the lockfile, and runs
formatting, lint, typecheck, test and build checks. Run `pnpm check`,
`pnpm desktop:native:check`, and `pnpm desktop:native:test` on a configured host
before opening a pull request.
