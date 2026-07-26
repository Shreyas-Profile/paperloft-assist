FROM node:22-slim AS base
# poppler-utils gives us `pdftoppm`, used by src/lib/telegram-media.ts to
# rasterise every PDF page to a PNG before handing it to the vision model.
# Trusting the model's own PDF handling misses image-only pages (scans,
# stamped forms, photo-of-a-doc PDFs) on some providers, so we always
# vision-process every page. openssl+ca-certificates stay for Prisma/HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
COPY prisma ./prisma/
# --no-frozen-lockfile lets pnpm reconcile the lock after our package.json edits.
# TODO: run pnpm install locally + commit the new lock so we can flip back.
RUN pnpm install --no-frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# env.ts eagerly zod-parses at import time; Next collects page data during
# build which triggers it. Provide a placeholder so the parse passes — the
# real DATABASE_URL comes in at runtime from docker-compose.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build_time_placeholder_not_a_real_secret \
    AUTH_GOOGLE_ID=build_placeholder \
    AUTH_GOOGLE_SECRET=build_placeholder \
    OPENROUTER_API_KEY=build_placeholder
RUN pnpm exec prisma generate
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
# Prisma's generated client lives inside @prisma/client (0.5.x+ location).
# Copy the whole @prisma dir — it's small and covers both possible layouts.
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Some Prisma versions ALSO emit to node_modules/.prisma; copy if present.
RUN mkdir -p ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/.prisma/client

ENV HOME=/home/nextjs
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@6.19.2 db push --accept-data-loss --skip-generate && node server.js"]
