# ADR 0002 — Hetzner + Docker (not Vercel, not serverless)

- **Status:** accepted, 2026-07-15
- **Deciders:** Shreyas

## Context

Where to run the Next.js app + its Postgres. Vercel is the "obvious"
choice for a Next.js dev, but it comes with serverless request lifecycle
(cold starts on Prisma, request timeouts, per-invocation billing) and
no baked-in path to a persistent Postgres.

## Decision

Rent a Hetzner CPX shared-CPU box (~€6/month), run the app + Postgres
in docker compose, terminate HTTPS via Cloudflare Tunnel.

## Consequences

- **Positive:** Prisma stays warm, Telegram webhooks respond in
  <200 ms, background jobs (cron, triage) run in the same process as
  the request handler. €6/month covers the whole stack — Vercel Pro
  starts at $20 and pushes DB elsewhere. Docker gives one-command
  deploy locally too.
- **Negative:** One machine = one point of failure. No auto-scaling.
  When the box goes down, we're down until we restart.
- **Reversible?** Mostly. Moving Next.js to Vercel is a few hours;
  extracting Postgres into a managed DB (Neon, Supabase) is also a
  few hours. What can't be lifted-and-shifted is anything using local
  disk (`/data/users/`) — those would need R2/S3 first.
