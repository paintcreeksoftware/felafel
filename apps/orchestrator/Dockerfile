# syntax=docker/dockerfile:1
# Multi-stage build for the @felafel/orchestrator service. Builder
# installs the workspace deps and produces dist/index.mjs + a flattened
# prod node_modules via `pnpm deploy`. Runtime ships just that.
#
# Base image: `node:24-slim` (Debian-slim, glibc). After the PAI-103
# cutover from better-sqlite3 to node:sqlite, there are no native
# modules left in the orchestrator bundle — we could move to
# `node:24-alpine` (musl) for a ~45MB size reduction. Deferred to a
# separate ticket so this change stays scoped to the driver swap.

FROM node:24-slim AS builder
WORKDIR /repo
RUN corepack enable

# Cache install layer by copying only manifests first.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/orchestrator/package.json apps/orchestrator/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/logs/package.json packages/logs/
COPY packages/backend/package.json packages/backend/
RUN pnpm install --frozen-lockfile --filter @felafel/orchestrator...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/contracts packages/contracts
COPY packages/db packages/db
# packages/logs and packages/backend have non-workspace npm deps, so
# `pnpm install` above created `node_modules/` with symlinks under
# them. A bulk `COPY packages/logs packages/logs` would try to
# overlay the host's `node_modules/@types/node` onto the container's
# existing symlink and fail with "cannot copy to non-directory".
# Copy just the source + manifest; the install-layer symlinks stay
# untouched.
COPY packages/logs/src packages/logs/src
COPY packages/logs/package.json packages/logs/
COPY packages/backend/src packages/backend/src
COPY packages/backend/package.json packages/backend/
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
