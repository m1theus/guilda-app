# Arquitetura

Guilda é um monólito modular com um cliente desktop Tauri.

## Limites

- `apps/desktop`: shell Tauri, React, estado e integrações nativas.
- `apps/server/src/http`: API Fastify autenticada.
- `apps/server/src/realtime`: Socket.IO, rooms, presença e typing.
- `apps/server/src/modules`: regras de domínio e adapters externos.
- `packages/database`: Prisma, PostgreSQL e seed.
- `packages/types`: contratos HTTP, realtime, entidades serializadas e mídia.
- `packages/validation`: schemas de entrada compartilhados.
- `packages/ui`: componentes visuais sem regras de domínio.
- `infrastructure`: PostgreSQL, Redis, MinIO e LiveKit para desenvolvimento local.

## Fluxos

HTTP persiste estado durável no PostgreSQL. Socket.IO autentica access tokens e valida membership/permissões antes de entrar em rooms ou aceitar comandos. Redis mantém presença efêmera e distribui eventos entre processos. Uploads usam URLs assinadas S3-compatible. LiveKit transporta áudio, vídeo e screen share diretamente pelo media plane; o backend emite tokens somente após validar `CONNECT`, `SPEAK` e `STREAM`. Em produção, aplicação e media plane devem ser isolados para que mídia WebRTC não concorra por CPU, memória ou rede com a API e a persistência.

## Dependências

```text
contracts ─┬─ database ─┬─ http ───────┐
           │            └─ realtime ──┤
foundation┼─ desktop shell            ├─ integration/e2e
           ├─ frontend ───────────────┤
           └─ livekit/media ──────────┘
```

Workstreams compartilham apenas contratos de `@guilda/types`; autorização e persistência permanecem server-side. O frontend pode usar adapter mock enquanto os mesmos DTOs são respeitados.
