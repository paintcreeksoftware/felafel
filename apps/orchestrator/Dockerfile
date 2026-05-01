# syntax=docker/dockerfile:1
# Multi-stage build for the @felafel/orchestrator service. Builder installs the
# full pnpm workspace deps and produces dist/index.js + a flattened prod
# node_modules via `pnpm deploy`. Runtime is a minimal node:24-alpine with just
# the deployable artifact.

FROM node:24-alpine AS builder
WORKDIR /repo
RUN corepack enable

# Cache install layer by copying only manifests first
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/orchestrator/package.json apps/orchestrator/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @felafel/orchestrator...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/orchestrator apps/orchestrator

RUN pnpm --filter @felafel/orchestrator build
RUN pnpm --filter @felafel/orchestrator --legacy deploy --prod /deploy

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/dist ./dist

ENV ORCHESTRATOR_DATA_DIR=/data
ENV ORCHESTRATOR_HOST=0.0.0.0
ENV ORCHESTRATOR_PORT=9090

EXPOSE 9090
VOLUME /data

CMD ["node", "dist/index.mjs"]
