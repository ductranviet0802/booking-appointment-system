# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# package-lock.json only carries a fully resolved entry for the darwin-arm64
# dev machine's native optional deps (e.g. lightningcss) — when that lock is
# fed into npm as-is, npm won't self-heal the missing Linux binary variant
# even with `npm install` (confirmed: it only adds it when installed by exact
# name). So we intentionally do NOT copy package-lock.json here — npm resolves
# fresh from package.json inside the container, picking the correct native
# optional binaries for whatever platform actually builds this image.
FROM base AS deps
COPY package.json ./
RUN npm install

FROM base AS deps-prod
COPY package.json ./
RUN npm install --omit=dev

FROM deps AS builder
COPY . .
ENV NODE_ENV=production
# Placeholder only — prisma.config.ts's env("DATABASE_URL") requires the var to be
# set for `prisma generate` to load config, but generate never connects to a DB.
# Real DATABASE_URL is supplied at container runtime via docker-compose.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=9105 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nextjs
EXPOSE 9105

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:9105/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
