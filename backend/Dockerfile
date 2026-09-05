# syntax=docker/dockerfile:1
# ---- Base: pnpm via corepack (+ openssl for Prisma's musl engine on alpine) ----
FROM node:20-alpine AS base
RUN apk add --no-cache openssl \
 && corepack enable \
 && corepack prepare pnpm@10.32.1 --activate
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

# ---- Builder: install all deps, build @zenflow/shared + the API ----
FROM base AS builder

# Copy workspace manifests first so the (slow) install layer is cached across
# source-only changes. Only the packages in the backend's dependency graph are needed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/

# Full install (incl. devDeps) for the backend and its workspace deps.
RUN pnpm install --frozen-lockfile --filter backend...

# Sources.
COPY packages/shared ./packages/shared
COPY backend ./backend

# @zenflow/shared must be built first (the backend imports its compiled dist),
# then generate the Prisma client and compile the Nest app.
RUN pnpm --filter @zenflow/shared build \
 && pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build

# Self-contained production bundle: prod deps only, with @zenflow/shared copied in
# (not symlinked) and the Prisma CLI present for `migrate deploy` at boot. --legacy
# copies workspace deps in (pnpm 10 otherwise requires inject-workspace-packages).
RUN pnpm deploy --filter=backend --prod --legacy /app/deploy

# ---- Runner: minimal production image ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=5000

# Production node_modules + manifest (npm scripts) from the deploy bundle...
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json

# Chromium runtime dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Install Playwright's Chromium browser
RUN pnpm exec playwright install chromium

# ...and the build artifacts. dist/ and generated/ are gitignored, so the deploy
# bundle omits them — copy them straight from the builder's backend workspace.
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/generated ./generated

EXPOSE 5000

# start:prod = `prisma migrate deploy && node dist/main`
CMD ["pnpm", "start:prod"]
