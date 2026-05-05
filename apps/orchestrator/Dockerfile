# syntax=docker/dockerfile:1
# Multi-stage build for the @felafel/orchestrator service. Builder
# installs the workspace deps and produces dist/index.mjs + a flattened
# prod node_modules via `pnpm deploy`. Runtime ships just that.
#
# Base image: `node:24-slim` (Debian-slim, glibc) instead of
# `node:24-alpine`. Reason: @felafel/db pulls in `better-sqlite3`, whose
# prebuilds are glibc-only — Alpine (musl) would force a source compile
# requiring Python + build-base in the builder, AND a runtime that can
# load a glibc-compiled .node binary (which Alpine can't). Slim is ~75MB
# vs alpine's ~30MB; the size delta is acceptable for working
# native-module support out of the box.

FROM node:24-slim AS builder
WORKDIR /repo
# Python + build tools for better-sqlite3's source compile.
# better-sqlite3@11.x doesn't ship Node 24 prebuilts (last prebuilt
# version is Node 22), so the postinstall falls back to building from
# source. Upgrading to better-sqlite3@12.x would remove this need but
# is out of scope here. Slim's base image is bare; install the toolchain,
# do the install, then `pnpm deploy` strips everything that isn't a
# runtime dep — so the runtime stage stays toolchain-free.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Cache install layer by copying only manifests first.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/orchestrator/package.json apps/orchestrator/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @felafel/orchestrator...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY apps/orchestrator apps/orchestrator

RUN pnpm --filter @felafel/orchestrator build
RUN pnpm --filter @felafel/orchestrator --legacy deploy --prod /deploy

FROM node:24-slim
WORKDIR /app
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/dist ./dist
# tsup inlines @felafel/db's source into ./dist/index.mjs, so when
# `createDb()` resolves `migrationsFolder` via `import.meta.dirname`
# at runtime it looks for /app/migrations (sibling of /app/dist),
# not /app/node_modules/@felafel/db/migrations where pnpm deploy put
# them. Copy them where the bundled code actually looks. Dev mode
# (tsx, no bundling) keeps using the original packages/db/migrations
# path because import.meta.dirname there points at the source file.
COPY --from=builder /deploy/node_modules/@felafel/db/migrations ./migrations

ENV ORCHESTRATOR_DATA_DIR=/data
ENV ORCHESTRATOR_HOST=0.0.0.0
ENV ORCHESTRATOR_PORT=9090

EXPOSE 9090
VOLUME /data

CMD ["node", "dist/index.mjs"]
