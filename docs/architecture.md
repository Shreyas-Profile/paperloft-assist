# Architecture

A single Next.js app on Hetzner talks to a single Postgres, drives one
Telegram bot, and calls a handful of hosted MCP skills. That's it —
nothing distributed, nothing serverless, no message queue. This document
is the map.

## System diagram

```mermaid
flowchart LR
    subgraph "User surfaces"
        Browser[/Web browser<br/>paperloft.uk/]
        Telegram[/Telegram<br/>@PaperloftAssistantBot/]
    end

    subgraph "Hetzner: 37.27.193.248"
        subgraph "docker compose stack"
            Web[Next.js 16<br/>paperloft-assist-web<br/>:3000]
            DB[(Postgres 16<br/>paperloft-assist-db)]
        end
        Files[/data/users/<br/>volume]
    end

    subgraph "External"
        OR[OpenRouter<br/>LLM]
        TG[Telegram Bot API]
        Docs[docs.regiq.in<br/>RAG]
        Cron[cron.regiq.in]
        Tor[tor.regiq.in]
    end

    Browser -- HTTPS via Cloudflare tunnel --> Web
    Telegram -- webhook POST --> Web
    Web -- outbound API --> TG
    TG -- inbound webhook --> Web

    Web <--> DB
    Web -- prescription PDFs, uploads --> Files
    Web -- chat completions,<br/>voice transcription --> OR
    Web -- optional skills --> Docs
    Web -- scheduled fires --> Cron
    Web -- anonymous fetch --> Tor
```

## Components

**Web (Next.js 16 App Router)** — the single deployable. Serves the
public landing + /support + /signin, the auth-gated /chat + /skills +
/settings, the admin /admin/support, and every /api/* route including
the Telegram webhook. Written in TypeScript, tests in Vitest.

**DB (Postgres 16)** — one instance, one database (`paperloft_assist`),
inside the same docker compose stack. Prisma is the ORM. Schema in
`prisma/schema.prisma`. Runs migrations on container boot via
`prisma db push --accept-data-loss --skip-generate`.

**File volume (`/data/users/`)** — persistent docker volume for user
uploads (prescription PDFs, images). Survives container rebuilds and
schema changes.

**Cloudflare Tunnel** — terminates HTTPS + hides the raw IP.
`paperloft.regiq.in` and `paperloft.uk` both route through the same
tunnel to `web:3000`.

**Telegram Bot API** — inbound webhook lands at
`/api/telegram/bot-webhook/<secret>`. Outbound sends go via the
standard REST API.

**OpenRouter** — every LLM call goes through it. Chat uses the
model configured in `MODEL` (default `anthropic/claude-haiku-4.5`).
Voice transcription is hardcoded to `google/gemini-2.5-flash` (Claude
has no audio input channel).

**Hosted MCP skills** — separate services on the same Hetzner box
that we call over HTTPS as a paying tenant:
- `docs.regiq.in` — RAG over uploaded documents
- `cron.regiq.in` — HMAC-signed webhook cron
- `tor.regiq.in` — anonymous fetch through Tor exits

Each skill has a per-user API key stored (encrypted with
`USER_SKILL_ENCRYPTION_KEY`) in `SkillConnection`.

## Request paths

**Web chat message:** browser → `/api/chat` → auth → prisma read
history → generateText loop → prisma write → stream back.

**Telegram text message:** Telegram → webhook → `handleTelegramMessage`
→ same LLM pipeline as web chat, with reminder + skill tools available
→ Telegram API send.

**Telegram voice/photo/PDF:** webhook → detect media type →
transcribeVoice / describeImage / summarisePdf → convert to plain text
→ handleTelegramMessage as if the user had typed it.

**Reminder fire:** cron.regiq.in → HMAC-signed POST →
`/api/cron/fire` → verify signature → run scheduler tick → for each
due reminder, resolve delivery channel → Telegram API send.

**Support ticket:** browser → `/api/support` → prisma insert →
fire-and-forget: AI triage → prisma update → admin Telegram DM.

## Why not…

- **Why not Vercel / serverless?** Prisma cold starts + long-lived
  Telegram webhook connections don't fit the request model.
  See [ADR 0002](./adr/0002-hetzner-docker-hosting.md).
- **Why not Kubernetes?** One box, one dev. Adding orchestration
  buys nothing at this scale.
- **Why not multiple services (chat, telegram, cron separate)?**
  All three share the same DB + LLM code + auth. Splitting would
  triple the deploy pipelines to save nothing.

## When each piece would need to change

| Trigger | Piece that grows / changes |
|---|---|
| Second concurrent developer | Feature branches become non-optional; PR reviews get another human |
| >10k active users | Add a read replica; move reminder cron to a dedicated worker |
| Real revenue | Add Stripe billing; add usage caps per skill |
| Multiple hosts / regions | Move DB out of docker compose to managed Postgres; add CDN cache |
| First 2am outage | Runbook gets fleshed out; UptimeRobot signs up; on-call routing |

None of those are true today.
