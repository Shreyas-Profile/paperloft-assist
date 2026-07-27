# Paperloft Assist

A personal AI assistant that lives on Telegram (and the web). Set reminders in
plain English, send voice notes / photos / PDFs and it reads them, track
medications with taken/snooze/skip buttons. Live at
[paperloft.uk](https://paperloft.uk).

The plan is a full personal assistant — email, phone calls, PowerPoint,
calendar sync are on the way. See [CHANGELOG.md](./CHANGELOG.md) for what's
shipped when.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **Auth.js v5** — Google + Telegram Login Widget
- **Prisma 6.19.2** + **Postgres 16**
- **OpenRouter** for LLM calls (chat via configurable `MODEL`, voice
  transcription via `google/gemini-2.5-flash`)
- **Docker Compose** on Hetzner, fronted by Cloudflare Tunnel
- **Remotion / video-render-mcp**, **docs-mcp**, **cron-mcp**, **tor-mcp** —
  hosted skills, plumbed in through the pluggable skills marketplace

## Running locally

Prereqs: **Node.js 22+**, **pnpm 11+**, **Docker Desktop** (for the local
Postgres).

```bash
git clone https://github.com/Shreyas-Profile/paperloft-assist.git
cd paperloft-assist
pnpm install

# 1. Start local Postgres in Docker (leaves it running in background)
docker compose -f docker-compose.dev.yml up -d

# 2. Copy the env template and fill in the required keys
#    (see .env.example — AUTH_SECRET, OPENROUTER_API_KEY, Google OAuth,
#    USER_SKILL_ENCRYPTION_KEY. Telegram / hosted-MCP keys are optional.)
cp .env.example .env
# then edit .env

# 3. Push the schema to the local DB
pnpm exec prisma db push

# 4. Start the Next.js dev server
pnpm dev
```

Open http://localhost:3000. Sign-in with Google works out of the box;
Telegram sign-in needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` +
`TELEGRAM_WEBHOOK_SECRET` (see .env.example for how to get them).

## Environments

Two environments today (dev/prod split — no separate staging yet):

| Environment | Where | DB | Purpose |
|---|---|---|---|
| **dev** | your machine | local Docker Postgres | day-to-day iteration |
| **prod** | Hetzner (`37.27.193.248`) | Postgres in Docker (`paperloft-assist-db`) | live site at [paperloft.uk](https://paperloft.uk) |

**Never edit files directly on the Hetzner box.** All changes flow through
git → the CI/CD pipeline deploys automatically on merge to `main`
(see [DEPLOY.md](./DEPLOY.md)).

## Testing

```bash
pnpm test          # run all unit tests once (CI does this)
pnpm test:watch    # re-run on file changes
pnpm typecheck     # tsc --noEmit
pnpm lint
```

Tests live next to the code they cover (`src/lib/foo.ts` + `src/lib/foo.test.ts`).
Every bug we've hit in production gets a matching test to prevent regression —
see [CHANGELOG.md](./CHANGELOG.md) for the story of what's been added.

## Deploying

Automated. Push to `main` → GitHub Actions runs tests → if green, rsyncs the
code to Hetzner and rebuilds the container. Full flow + rollback plan in
[DEPLOY.md](./DEPLOY.md).

## Project layout

```
paperloft-assist/
├── .github/workflows/          # CI (tests) + CD (deploy)
├── prisma/
│   └── schema.prisma           # DB schema — user, reminder, message, etc.
├── src/
│   ├── app/                    # Next.js App Router — pages + /api routes
│   │   ├── api/telegram/       # Bot webhook + login endpoints
│   │   ├── api/cron/           # Scheduled reminder fires
│   │   ├── chat/               # Web chat UI
│   │   ├── signin/             # Telegram + Google sign-in
│   │   └── skills/             # Skills marketplace
│   ├── lib/
│   │   ├── telegram-chat.ts    # Central Telegram → LLM → tool chain
│   │   ├── telegram-media.ts   # Voice / photo / PDF ingest
│   │   ├── skills/             # Skill implementations (reminders, etc.)
│   │   └── ...
│   └── test-setup.ts           # Injects placeholder env vars for tests
├── docker-compose.yml          # Prod stack (used on Hetzner)
├── docker-compose.dev.yml      # Local dev — just Postgres
├── Dockerfile                  # Multi-stage prod build
├── CHANGELOG.md
└── DEPLOY.md
```
