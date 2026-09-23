# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ─── base: node + pnpm ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@11
WORKDIR /app

# ─── deps: full install (dev deps needed for build, prisma CLI, tsx) ─────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─── build: generate Prisma client, compile TypeScript, bundle ───────────────
FROM deps AS build
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# The bundle inlines every dependency (incl. Prisma's query compiler), so the
# runtime image needs no node_modules at all.
RUN pnpm build && pnpm bundle

# ─── migrate: one-shot job that applies migrations, seeds and prepares storage
FROM build AS migrate
COPY scripts ./scripts
CMD ["sh", "-c", "pnpm db:deploy && pnpm storage:init && ([ -z \"$ADMIN_EMAIL\" ] || pnpm db:seed)"]

# ─── runtime: small image, non-root ──────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/bundle ./bundle
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "--enable-source-maps", "bundle/server.mjs"]
