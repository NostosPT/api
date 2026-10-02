# Node and pnpm versions follow package.json ("engines" / "packageManager").
ARG NODE_VERSION=22.18.0

# ---- Base: Node + corepack-managed pnpm ----
FROM node:${NODE_VERSION}-alpine AS base

ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

# ---- Dependencies (dev included: Prisma CLI + TypeScript) ----
FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# ---- Build: generate the Prisma client, compile TypeScript ----
FROM deps AS build

COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# prisma.config.ts resolves DATABASE_URL eagerly; generate never connects, so a
# placeholder (scoped to this command, not persisted) is enough.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate \
    && pnpm build

# ---- Migrate: one-shot `prisma migrate deploy` (compose "migrate" service) ----
FROM build AS migrate

USER node

CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ---- Production dependencies (keeps the generated Prisma client) ----
FROM build AS prod-deps

RUN pnpm prune --prod

# ---- Runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Root-owned and read-only for the unprivileged runtime user.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node

EXPOSE 3000

# 127.0.0.1, not localhost: HOST=0.0.0.0 binds IPv4 only and busybox may
# resolve localhost to ::1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/v1/health" || exit 1

CMD ["node", "dist/index.js"]
