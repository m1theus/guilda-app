# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS build
RUN apt-get update \
  && apt-get install --no-install-recommends -y build-essential python3 openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/database packages/database
COPY packages/types packages/types
COPY packages/validation packages/validation
RUN pnpm --filter @guilda/database db:generate \
  && pnpm --filter @guilda/server build

FROM base AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates dumb-init openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/database/prisma packages/database/prisma
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile --prod --filter @guilda/server... \
  && pnpm --filter @guilda/database db:generate \
  && pnpm store prune

COPY --from=build /app/apps/server/dist apps/server/dist

USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/dist/server.js"]
