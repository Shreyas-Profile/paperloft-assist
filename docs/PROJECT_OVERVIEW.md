# Paperloft Assist — Full Project Overview

*A personal AI assistant with pluggable skills, medication reminders, document search, and short-video generation. Built solo from scratch over ~5 weeks.*

**Live at:** [paperloft.uk](https://paperloft.uk)
**Repo:** [github.com/Shreyas-Profile/paperloft-assist](https://github.com/Shreyas-Profile/paperloft-assist)
**Bot:** `@PaperloftAssistantBot` on Telegram

---

## Table of contents

1. [What Paperloft Assist is](#1-what-paperloft-assist-is)
2. [High-level architecture](#2-high-level-architecture)
3. [The tech stack (and why each piece)](#3-the-tech-stack-and-why-each-piece)
4. [How the app is deployed on Hetzner](#4-how-the-app-is-deployed-on-hetzner)
5. [DNS, Cloudflare Tunnel, and TLS](#5-dns-cloudflare-tunnel-and-tls)
6. [Authentication (Telegram Login Widget)](#6-authentication-telegram-login-widget)
7. [The two chat surfaces (web + Telegram bot)](#7-the-two-chat-surfaces-web--telegram-bot)
8. [The Skills marketplace and enable-button system](#8-the-skills-marketplace-and-enable-button-system)
9. [Skill #1: Reminders & Prescriptions (deep dive)](#9-skill-1-reminders--prescriptions-deep-dive)
10. [Skill #2: Docs — RAG over uploaded files (deep dive)](#10-skill-2-docs--rag-over-uploaded-files-deep-dive)
11. [Skill #3: Video Render — script → MP4 (deep dive)](#11-skill-3-video-render--script--mp4-deep-dive)
12. [Bring-your-own MCP skills](#12-bring-your-own-mcp-skills)
13. [Support tickets with AI triage](#13-support-tickets-with-ai-triage)
14. [Health, status, and monitoring](#14-health-status-and-monitoring)
15. [Testing strategy](#15-testing-strategy)
16. [CI/CD pipeline (GitHub Actions)](#16-cicd-pipeline-github-actions)
17. [Change control (PRs, branches, code review)](#17-change-control-prs-branches-code-review)
18. [Privacy and data handling](#18-privacy-and-data-handling)
19. [Design decisions and things I got wrong the first time](#19-design-decisions-and-things-i-got-wrong-the-first-time)
20. [What's next](#20-whats-next)

---

## 1. What Paperloft Assist is

Paperloft Assist is a personal assistant you chat with in plain English — either in your web browser or on Telegram. The same account works from both. It doesn't just answer questions; it can DO things on your behalf through "skills":

- **Set and manage reminders** ("remind me every Wednesday at 5pm to call grandma") — including medication schedules where you tap Taken / Skip when they fire on Telegram.
- **Read documents you upload** — PDFs, Word docs, Excel sheets, PowerPoints — and answer questions about them later with page-level citations. Includes photos of documents (via a vision model, not text extraction).
- **Generate short explainer videos** from a script — voice-over, animated scenes, no watermark.
- **Bring your own skills** — anyone can plug in a Model Context Protocol (MCP) server they run themselves, and the assistant will use it.

It's built as a portfolio project to demonstrate end-to-end product ownership: I designed it, built the frontend and backend, wrote the deploy pipeline, hosted the infrastructure, and did the testing and change control. It's live, real people can use it, and it processes real data.

---

## 2. High-level architecture

```
                        ┌──────────────────────────┐
                        │   User's browser / phone │
                        └───────────┬──────────────┘
                                    │
                                    │ HTTPS
                                    ▼
                        ┌──────────────────────────┐
                        │  Cloudflare Tunnel edge  │
                        │  (paperloft.uk)          │
                        └───────────┬──────────────┘
                                    │
                                    │ private tunnel to origin
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │             Hetzner box (37.27.193.248)           │
        │  ┌────────────────┐   ┌────────────────────────┐  │
        │  │  paperloft-web │──▶│    paperloft-db        │  │
        │  │  Next.js 16    │   │   Postgres 16 + pgvec  │  │
        │  │  Node runtime  │   └────────────────────────┘  │
        │  └────────┬───────┘                               │
        │           │                                       │
        │           │ HTTPS (to other hosted MCPs)          │
        │           ▼                                       │
        │  ┌───────────────────────────────────────────┐    │
        │  │  Sibling containers on the same box:      │    │
        │  │   • docs-mcp     (docs.globalion.in)          │    │
        │  │   • video-render-mcp (video-render...)    │    │
        │  │   • cron-mcp     (cron.globalion.in)          │    │
        │  │   • tor-mcp      (tor.globalion.in)           │    │
        │  └───────────────────────────────────────────┘    │
        │                                                   │
        │           ▲                                       │
        │           │ every minute — reminder scheduler tick│
        │           │                                       │
        │  ┌────────┴────────┐                              │
        │  │  host cron      │                              │
        │  └─────────────────┘                              │
        └───────────────────────────────────────────────────┘
                                    │
                                    │ outbound to internet
                                    ▼
                     ┌──────────────────────────┐
                     │ OpenRouter (LLM proxy)   │
                     │   Claude Haiku 4.5       │
                     │   Gemini 2.5 Flash       │
                     └──────────────────────────┘
                                    │
                                    ▼
                     ┌──────────────────────────┐
                     │ Telegram Bot API         │
                     │  @PaperloftAssistantBot  │
                     └──────────────────────────┘
```

Everything runs on **one Hetzner box** (small VPS at ~€10/month). Cloudflare Tunnel keeps the origin IP private and handles TLS termination. Postgres and the Next.js app run as two Docker Compose services. External hosted MCP servers (docs, video-render, cron, tor) are separate containers on the same box, exposed via their own Cloudflare Tunnel hostnames. When a user's chat needs one of those skills, the paperloft server calls the MCP server over HTTPS.

The **LLM never runs locally** — every model call goes out to OpenRouter, which proxies to the actual model. Default is Anthropic Claude Haiku 4.5 for chat, Google Gemini 2.5 Flash for voice transcription. Using OpenRouter means I never touch vendor-specific SDKs; if a new model gets cheaper I switch by changing one env var.

---

## 3. The tech stack (and why each piece)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | Full-stack in one codebase — the same repo serves the HTML, the API routes, and the server-side rendering. Fast dev loop. |
| Language | **TypeScript** | Type safety catches whole classes of bug at compile time. Every tool schema is a Zod object with types inferred. |
| Runtime | **Node 24** (in the Docker container) | Modern Node so the AI SDK's streaming features work. |
| Package manager | **pnpm 11** (via corepack) | Faster than npm, deterministic lockfile, less disk usage. |
| Database | **Postgres 16 + pgvector** | Relational for reminders/tickets/users; pgvector extension for embedding search in the Docs skill. One database, two workloads. |
| ORM | **Prisma 6.19.2** (pinned) | Type-safe schema-first ORM. Version pinned because Prisma 7 changed the async client behaviour in ways that broke my code. |
| Auth | **Auth.js v5 (JWT-only)** | No server-side session store — everything lives in the httpOnly JWT cookie. Simpler; scales trivially. |
| LLM | **OpenRouter** (Claude Haiku 4.5 default, Gemini 2.5 Flash for voice) | Provider-agnostic. One API, any model. |
| AI SDK | **Vercel AI SDK v5.1** | Streaming, tool-calling, structured output. Tool definitions are Zod schemas the model must satisfy. |
| Container | **Docker + Docker Compose** | Reproducible builds, one command to run the whole stack. |
| Reverse proxy / TLS | **Cloudflare Tunnel** (`cloudflared`) | The Hetzner box has no public IP exposed — Cloudflare's edge terminates TLS and tunnels to the box over an outbound connection. Free, secure, no firewall config. |
| CI/CD | **GitHub Actions** | Two workflows: CI (typecheck + tests) on every PR, Deploy (rsync + rebuild + health check + auto-rollback) on merge to main. |
| Testing | **Vitest 4.1** | Fast, ESM-native, works with the AI SDK's tool schemas. |
| Frontend | React (server components + client islands), CSS via Tailwind | Standard Next.js stack. Chat is a client component that streams via Server-Sent Events. |

---

## 4. How the app is deployed on Hetzner

The Hetzner box is a Cloud VPS (CX22, 2 vCPU, 4 GB RAM) in Nuremberg, Germany. On it, running:

```
/opt/paperloft/          <- this repo, deployed by rsync
    docker-compose.yml   <- defines the two services
    src/                 <- Next.js app source
    prisma/              <- schema + migrations
    ...

Docker services:
  paperloft-web          <- Node 24 container, port 3000 (internal only)
  paperloft-db           <- Postgres 16, port 5432 (internal only, volume-persisted)
```

Neither service exposes a public port. Instead, `cloudflared` (the Cloudflare Tunnel daemon, running as a systemd service on the host) subscribes to `paperloft.uk` and forwards inbound HTTPS requests to `http://localhost:3000`. That's how the site is reachable from anywhere without opening a firewall port.

**Deploy sequence** (automatic on merge to `main`):

1. GitHub Actions builds a fresh SSH deploy key and connects to `root@37.27.193.248`.
2. Snapshots the currently-running image as `paperloft-web:previous` for rollback.
3. `rsync -a` copies the new source into `/opt/paperloft/`.
4. `docker compose up -d --build` rebuilds and restarts the web container. Postgres is untouched.
5. Health check: hits `https://paperloft.uk/api/health` three times, 6 seconds apart. Needs all three to return HTTP 200.
6. If health check fails, retag `paperloft-web:previous` → `paperloft-web:latest` and restart — the app is back to the last known-good version within ~15 seconds.
7. Report success or failure back to the PR.

Zero-downtime isn't quite achieved (there's a ~5s gap during the container restart) but auto-rollback means a broken deploy self-heals rather than pages me at 2am.

**Manual actions when needed** (rare):

- `docker compose logs -f paperloft-web` to tail logs.
- `docker exec -it paperloft-db psql -U paperloft paperloft` to query the DB.
- `docker compose restart` to force a restart without rebuilding.

---

## 5. DNS, Cloudflare Tunnel, and TLS

I own three relevant domains, all managed through Cloudflare:

- **paperloft.uk** — main product URL, points to the paperloft-web container.
- **globalion.in** — infra domain, subdomains for each MCP server (`docs.globalion.in`, `video-render.globalion.in`, `cron.globalion.in`, `tor.globalion.in`). Older Pawan-owned services still on `regiq.in`.
- **shreyas.uk** — my personal portfolio site.

DNS records for `paperloft.uk` are `CNAME` records pointing at a Cloudflare Tunnel ID. When someone hits `paperloft.uk`, Cloudflare edges resolve it, terminate TLS with a certificate they auto-provision, and forward the request through the tunnel to the Hetzner box.

Advantages of this setup vs. traditional nginx + Let's Encrypt:

- **Zero certificate management** — Cloudflare handles renewal.
- **Origin IP hidden** — attackers can't hit the box directly, only via the tunnel.
- **Free DDoS protection** at Cloudflare's edge.
- **No firewall config** on the box — inbound TCP is fully closed. The tunnel connects outbound.

---

## 6. Authentication (Telegram Login Widget)

The whole app has one sign-in method: **Telegram**.

The `/signin` page embeds Telegram's official Login Widget (the blue "Log in with Telegram" button). When a user taps it:

1. Telegram's OAuth-like flow opens.
2. User confirms in their Telegram app.
3. Telegram redirects back to `paperloft.uk/api/auth/callback/telegram` with a signed payload.
4. Auth.js verifies the signature against the bot token, extracts `chat_id`, `first_name`, `username`, and creates a session JWT.
5. In the same auth `signIn` event handler, I upsert two rows:
   - a `UserChannelPref` row keyed by the synthetic email `tg-<chatId>@telegram.paperloft.local` so the reminder system knows where to deliver notifications
   - a `TelegramLink` row linking the chat_id to the user

The session cookie is `httpOnly` (JavaScript can't read it) and `SameSite=Lax`. Because the session is a JWT (not a database row), the app is stateless and horizontally scalable.

**Why Telegram only?** Because the main feature is reminders delivered via Telegram anyway. Making Telegram the sign-in method means every user is already set up to receive notifications — no separate "link Telegram" step. It's an opinionated filter: if you don't have Telegram, this isn't the product for you.

**Downside:** it's a barrier for LinkedIn / US audiences where Telegram uptake is lower. Deliberate tradeoff.

**Admins** are defined by a hardcoded whitelist (`src/lib/admin.ts`) mapping specific emails to admin permissions. Right now that's my Google email, my WhatsApp phone number, and my Telegram synthetic email.

---

## 7. The two chat surfaces (web + Telegram bot)

The assistant is accessible two ways, but the same LLM pipeline serves both.

### Web chat (`/chat`)

- React client component that streams the assistant's response via Server-Sent Events.
- Attach button opens a file picker for PDF / Word / Excel / PowerPoint / image upload (routes to the Docs skill).
- History persists per-conversation in Postgres.

### Telegram bot (`@PaperloftAssistantBot`)

- Users message the bot on Telegram; the bot's webhook fires an HTTPS POST to `/api/telegram/webhook`.
- The handler in `src/lib/telegram-chat.ts`:
  1. Resolves the incoming `chat_id` to a paperloft user via `TelegramLink`.
  2. If they attached voice / photo / PDF, downloads it, runs it through the appropriate handler (Gemini for voice transcription, vision model for photos, page rasterisation for PDFs).
  3. Runs the message through the same LLM pipeline as web chat, but with a Telegram-specific system-prompt addendum (extra guardrails against hallucinated confirmations).
  4. Sends the reply back via `sendMessage` on the Telegram Bot API.

Both surfaces call `makeUserScopedSkills(email)` to build the tool set. That means the same skills, same tools, same permissions — the only difference is the transport.

### Anti-hallucination guardrails

The LLM sometimes claims it did something (`"✅ Reminder set for 9am"`) without actually calling the tool. This costs the user a missed reminder. To prevent this:

- **`REMINDER_CLAIM_RE`** — a regex that detects past-tense claims in the LLM's reply.
- If detected AND no reminder tool was called this turn → force a retry with `toolChoice: "required"` so the LLM *must* call something.
- **`OFFER_LANGUAGE_RE`** — guards against false positives ("want me to set a reminder?" isn't a hallucinated confirmation).
- **`buildThinReplySummary`** — if the LLM ran tools but returned a bare `"✅"`, synthesise a factual line ("cancelled 3 reminders") so the user doesn't think nothing happened.

These are the ugly-but-real edge cases you only find by shipping to real users and watching them get confused.

---

## 8. The Skills marketplace and enable-button system

`/skills` is where users see what the assistant can do and toggle individual capabilities.

### Enable button UX

Every skill card has a toggle. When you flip it on, the assistant can call that skill's tools in your very next message — no reload, no wait. The toggle writes to a `UserSkillPref` row (`{ userId, skillId, enabled }`) and the next chat turn's tool builder reads that row.

Implementation:

- `src/app/skills/page.tsx` — server component that reads `listEnabledSkills(email)` and renders the marketplace grid.
- `src/app/api/skills/[skillId]/toggle/route.ts` — POST endpoint that upserts the pref.
- `src/lib/enabled-skills.ts` — the read side; single query returns a `Set<string>` of enabled skill ids.
- `src/lib/skill-tool-map.ts` — the source-of-truth mapping from skill id to the list of tool names it exposes.

When the LLM builds tools for a chat turn:

```
enabled = listEnabledSkills(email)               // Set of skill ids
allowedToolNames = skillToolMap.filter(enabled)  // Set of tool names
tools = filter(allTools, allowedToolNames)       // subset given to the model
```

So an off-toggle skill's tools are literally absent from the model's toolbox — the model can't even try to call them.

### Per-user provisioning (for external MCP skills)

Some skills — Docs, Tor — provision a **per-user tenant** on the external MCP server on first enable:

1. User flips Docs on.
2. Paperloft calls `POST docs.globalion.in/api/platform/provision-user { userEmail }` with a shared platform key.
3. `docs-mcp` mints a per-user API key and returns it.
4. Paperloft encrypts that key with `USER_SKILL_ENCRYPTION_KEY` (AES-256-GCM) and stores it in `UserSkill.encryptedApiKey`.
5. From then on, whenever the user's chat triggers `docs_upload / docs_search / etc.`, paperloft passes their key to `docs-mcp` — the MCP server sees only their data.

That's how isolation works across the platform: **each user gets their own tenant on each external skill they use.** Their docs corpus, their credit balance, their request logs — separate from every other user.

Other skills — Video Render, Cron — use a **shared platform key** (all paperloft users share one account on the external service, and requests are tagged with `metadata.userEmail` for attribution). Simpler, but no data isolation, so it's only used where the data isn't sensitive (video renders are ephemeral, cron jobs are just schedules).

### BYO skills

Users can add their own MCP servers (see [section 12](#12-bring-your-own-mcp-skills)). Those appear in the "Your custom skills" section at the top of `/skills`.

---

## 9. Skill #1: Reminders & Prescriptions (deep dive)

The most complex skill. Forked from an open-source starting point (`Pakki10/nova-reminders`), rewritten and extended significantly.

### Data model

Three Prisma models:

- **`Reminder`** — the series definition. Fields: `title`, `dueAt`, `recurrence` (string), `recurrenceEnd`, `type` (general / medication / appointment), `ackMode`, `escalateAfterMin`, `prescriptionId` (optional back-ref).
- **`ReminderInstance`** — one row per firing. Fields: `reminderId`, `scheduledFor`, `firedAt`, `ackState` (pending / acked / skipped / missed), `ackAt`, `channels`.
- **`Prescription`** — metadata extracted from a prescription image/PDF. Fields: `doctorName`, `medications` (JSON array), `followUpDate`, `fileRef`.

### Recurrence rules

The `recurrence` column stores a string. Supported forms:

| Form | Meaning |
|---|---|
| `"none"` | one-shot |
| `"hourly"` | every hour from `dueAt` |
| `"daily"` | every day |
| `"weekdays"` | Mon–Fri, skips weekends |
| `"weekly"` | every 7 days from `dueAt` |
| `"weekly:mon,wed,fri"` | explicit day picker — single or multi-day |
| `"monthly"` | same day next month (clamped: Jan 31 → Feb 28/29) |
| `"quarterly"` | +3 months, clamped |
| `"yearly"` | anniversary — clamped (Feb 29 → Feb 28 in non-leap years) |
| `"every:15m"` | every 15 minutes (min 5) |
| `"every:2h"` | every 2 hours (min 1) |

All date arithmetic uses UTC setters to avoid DST drift. All the fixed rules and interval forms have unit tests (51 tests across every rule, month-end clamping, leap years, DST safety).

### The scheduler

`src/lib/skills/nova-reminders/scheduler/index.ts` — a `tick()` function that:

1. Finds every reminder where `status = "pending"` AND `dueAt <= now`.
2. For each one:
   - Creates a `ReminderInstance` row if one doesn't already exist for that `(reminderId, scheduledFor)`.
   - Builds the message envelope (text + ack buttons if applicable).
   - Calls the delivery adapter (`sendTelegramToChatId` or `wasenderapi.sendWhatsApp`).
   - Marks `firedAt` on success.
   - Rolls `dueAt` forward via `nextOccurrence(dueAt, rule)` if recurring, or flips status to `"sent"` if one-shot.
3. Handles escalation (for reminders with `escalateAfterMin > 0`, resend once if unacked past the window).
4. Marks long-unacked instances as `"missed"`.

The scheduler is called by a **host-side cron job every minute** via `GET /api/cron/reminders` with a Bearer token. Not a distributed scheduler — a plain HTTP endpoint hit once a minute by system cron. Sufficient at this scale.

### The 14 tools the LLM sees

- `reminder_create` — with recurrence + type + ackMode + optional recurrenceEnd
- `reminder_list` — filter by status / type / date range
- `reminder_get` — full detail by id
- `reminder_update` — change any field
- `reminder_delete` — soft-delete (status → cancelled, never hard-delete)
- `reminder_delete_many` — bulk delete, returns titles of what was cancelled
- `reminder_ack` — mark a firing acked or skipped
- `reminder_missed` — list fires the user missed in the last N hours
- `prescription_ingest` — accept an image or PDF, LLM extracts meds and follow-up
- `prescription_confirm` — after user approval, auto-create all medication reminders
- `prescription_list` — user's prescriptions
- `prescription_star` — pin a prescription (survives 30-day file purge)
- `channel_prefs_get` / `channel_prefs_update` — configure delivery channels

### System-prompt guardrails

The reminder skill ships with a large system-prompt fragment that:
- Explains every recurrence format with examples.
- Requires the LLM to **list first before editing/deleting** — never guess an id.
- If ambiguous ("delete the medication one" with 3 medications), the LLM must present a numbered list and ask which one.
- Forbids fake "✅ Reminder set" confirmations without a successful tool call.

### Snooze — deliberately removed

Originally the ack buttons were Taken / +10 min / Skip. The +10 min button turned out to be a UX quicksand — the state got stale, users lost the message context between fires, and the reference-by-instance-id mechanic broke down when the fire was 30+ minutes old.

Simpler decision: **no snooze**. If you want to postpone a reminder, the assistant offers to create a new reminder for the later time. The DB columns are kept for backwards-compatibility with historical data.

---

## 10. Skill #2: Docs — RAG over uploaded files (deep dive)

Ask the assistant a question about a document you uploaded — it finds the relevant pages and cites them.

### The stack

- **`docs-mcp`** (`docs.globalion.in`) — a separate MCP server I built. Handles the storage, vector indexing, and search. Runs in its own Docker container on the same Hetzner box.
- **paperloft-web** — talks to `docs-mcp` over HTTPS via the MCP JSON-RPC protocol, using the user's provisioned per-tenant API key.

### Ingestion flow

1. User uploads a file via the web chat's paperclip button (or drops it into a Telegram message).
2. `paperloft-web` streams it to `docs-mcp` (`docs_upload` tool).
3. `docs-mcp`:
   - Extracts text with Poppler / python-docx / openpyxl / python-pptx depending on the file type.
   - For scanned pages or images, runs the pages through Gemini Flash Lite (vision model) — treats every page as an image so charts, tables, and handwriting all get read.
   - Chunks the text (~300 tokens per chunk with 50-token overlap), embeds each chunk with a Gemini embedding model.
   - Stores chunks + embeddings in Postgres with pgvector.
4. Returns `{ documentId, pageCount }` to paperloft.

### Search flow

1. User asks "when's my Dr Sharma appointment?"
2. LLM calls `docs_search({ query: "Dr Sharma appointment date time" })`.
3. `docs-mcp` embeds the query, does a cosine-similarity search against the user's corpus, returns the top 5 chunks with their `documentId` + `pageNumber` + snippet.
4. LLM synthesises the answer, quoting the page citation.

### Retention

- File bytes: kept 30 days on disk, then purged.
- Extracted text + embeddings: kept forever.
- Per-user quota: 10 live files (older ones get their file purged; text stays).
- Starred prescriptions bypass the quota purge.

### Billing (planned)

`docs-mcp` has a Stripe integration (Pawan's account) but paperloft's UI shows "free — 100 pages from Paperloft's platform pool" for now during beta. Real billing kicks in when the pool is exhausted.

---

## 11. Skill #3: Video Render — script → MP4 (deep dive)

Turn a text script into a short motion-graphics video with voiceover.

### The stack

- **`video-render-mcp`** — a Remotion-based render service. Runs on the same Hetzner box (Pawan's project, forked and adapted).
- **Voice**: Microsoft Edge Neural TTS (free), routed via OpenRouter → Gemini for occasional fallback.
- **Animation**: Remotion (React-based video framework) with a preset motion-graphics theme.
- **Output**: MP4 (H.264, 720p, AAC audio).

### The flow

Paperloft exposes three tools to the LLM:

- **`video_plan(title, targetDurationSec, script, scenes)`** — draft a plan, zero credits. Returns the same shape `video_render` accepts. LLM shows this to the user to approve.
- **`video_render(...)`** — actually kick off the render. Async — returns immediately with `{ jobId, videoUrl, creditsQuoted }`, the render takes 60–300s in the background.
- **`video_status(jobId)`** — check whether it's done.

Typical LLM flow: plan → user confirms → render → tell them the URL → they check back in a few minutes.

### Scene shapes

The `scenes` array supports:

| Type | Fields |
|---|---|
| `title` | `copy` + optional `subtitle` |
| `stat` | `big` (large text) + `small` (caption) + optional inline image |
| `image` | `src` (must be a `data:` URI — never a fabricated https URL) + `caption` |
| `code` | `language` + `snippet` + `caption` |
| `cta` | `url` + `copy` |

Every scene type has a concrete example in the tool description so the LLM doesn't have to guess.

### Bugs I hit shipping this

Three real production bugs I found through end-to-end testing:

1. **URL hallucination**: the LLM sometimes replied `https://paperloft.uk/video/[jobId]` — literal `[jobId]` in the URL — because it templated the response instead of pasting the returned value. Fixed by explicitly telling the LLM in the tool description: "PASTE the exact videoUrl string, NEVER template with `[jobId]` or `<url>`."

2. **Fabricated image URLs**: LLM invented image URLs like `https://paperloft.uk/assets/foo.png` and passed them to the render service, which then 404'd and killed the whole job. Fixed by adding "ONLY `data:image/...` URIs allowed; NEVER guess an https URL" to the tool description, plus updating the safe-default example to text-only.

3. **Markdown-mangled URLs**: LLM wrapped URLs in `**bold**` for Telegram, and Telegram's link parser included the trailing `**` in the URL. Clicks 404'd. Fixed by teaching the LLM to send URLs as plain text on their own line — no markdown, no `[link](...)`, no backticks.

Every fix was: **notice bug in production → find the specific tool description that let the LLM make that mistake → strengthen the description with explicit anti-examples → deploy → verify**. Small PRs, one bug at a time.

---

## 12. Bring-your-own MCP skills

Users can plug in any MCP server they run themselves. The assistant will discover its tools and let the LLM call them.

Flow:

1. User goes to `/skills` → clicks "+ Add skill".
2. Fills in: name, MCP endpoint URL, auth header (optional).
3. Paperloft stores the config in `UserSkill` (with the auth header encrypted).
4. Next chat turn, paperloft:
   - Fetches the MCP server's tool list.
   - Adds those tools to the LLM's toolbox.
   - When the LLM calls one, paperloft forwards the JSON-RPC call to the user's MCP server with their auth header.
   - Returns the response to the LLM.

That means anyone can extend the assistant with their own capabilities — a private company API, a hobby project, whatever — without me having to build a skill for them.

Cap: 20 custom skills per user. Encryption key: `USER_SKILL_ENCRYPTION_KEY` (AES-256-GCM). Rotating that key would require re-encrypting every existing row — so it's a "never rotate" constant.

---

## 13. Support tickets with AI triage

`/support` is a public ticket form (name, optional email, title, body). When submitted:

1. Row inserted in `SupportTicket` with `status = "new"`.
2. An LLM triage pass (Claude Haiku 4.5) is fired immediately: reads the ticket body, outputs structured JSON with `{ category, priority, summary, suggestedFiles }`.
3. The triage output is saved to `aiTriage` (JSON column) and shown to me on `/admin/support` alongside the raw ticket.
4. **I decide the real priority** — the AI is a suggestion, not the source of truth.
5. When a new ticket lands, a Telegram DM fires to my admin account so I see it immediately.

SLA displayed publicly on `/support`:
- P0 (site down / data loss): same day
- P1 (broken for you): 3 days
- P2 (annoying UX / small bug): 1–2 weeks
- P3 (cosmetic / low value): when I get to it

Admin surface at `/admin/support` lists all tickets, `/admin/support/[id]` shows full detail and lets me update status.

---

## 14. Health, status, and monitoring

- **`/api/health`** — machine-readable JSON: `{ status, checks: { database, telegramBot, openrouter } }`. Called by the deploy pipeline's post-deploy verification, and by anyone who wants to programmatically check the site.
- **`/status`** — human-readable page rendering the same data with green / amber / red pills. Shown to users if they suspect something's broken.
- **`RUNBOOK.md`** in the repo — step-by-step recovery for common failures (DB down, Telegram bot down, health check failing, deploy loop broken).

Currently no external monitoring service (no PagerDuty, no Sentry) — the deploy pipeline's health check is the safety net. If it fails, deploy auto-rolls back. If something breaks between deploys, I find out from the user via a support ticket.

---

## 15. Testing strategy

- **Vitest 4.1** for unit and integration-style tests. Runs on every PR via CI.
- **92 tests currently passing**, covering:
  - The recurrence engine (`nextOccurrence` for every rule + month-end clamping + leap years + DST safety) — 51 tests
  - Telegram hallucination-detector regexes (`REMINDER_CLAIM_RE`, `OFFER_LANGUAGE_RE`)
  - `buildThinReplySummary` — the fallback that synthesises a reply when the LLM returns `"✅"` with no context
  - Recurrence validation (the tool-boundary guard that rejects `every:2m` because 5-min is the floor)

- **End-to-end tests** are manual — via the real web chat and real Telegram bot as myself. Every code change that affects a user-facing flow gets a manual E2E pass before I consider it done. When bugs are found this way, I add a test to lock the behaviour so it can't regress silently.

- **No CI DB** — Prisma-touching tools are tested via the manual E2E path rather than a fake Postgres in CI. Reason: setting up a real Postgres in CI is a chunk of infra work that's not paying for itself yet. If the app grows past me, I'd add it.

---

## 16. CI/CD pipeline (GitHub Actions)

Two workflows in `.github/workflows/`:

### `ci.yml` — runs on every PR and push

1. `pnpm install --frozen-lockfile`
2. `pnpm exec prisma generate` (needed for typecheck to see the Prisma client types)
3. `pnpm exec tsc --noEmit` (typecheck)
4. `pnpm exec vitest run` (test suite)

Green CI is required to merge (branch protection rule on `main`).

### `deploy.yml` — runs on merge to `main`

1. Triggered by `workflow_run` — fires after CI completes successfully on the main branch.
2. Sets up an ephemeral SSH key from a GitHub Actions secret.
3. Snapshots the currently-running `paperloft-web` Docker image as `paperloft-web:previous`.
4. `rsync -a` the current source to `/opt/paperloft/` on Hetzner.
5. `docker compose up -d --build` — rebuild and restart the web container.
6. Health check loop: 3 attempts, 6 seconds apart, requires HTTP 200 from `paperloft.uk/api/health`.
7. On any failure: retag `paperloft-web:previous` → `paperloft-web:latest`, restart. Container reverts to last known-good.

---

## 17. Change control (PRs, branches, code review)

Every code change goes through a Pull Request. I never push directly to `main`. Branch naming follows a convention documented in `docs/branching.md`:

- `feat/<short-name>` — new feature
- `fix/<short-name>` — bug fix
- `chore/<short-name>` — infra / docs / small cleanup
- `refactor/<short-name>` — no behaviour change

Every PR uses the template in `.github/PULL_REQUEST_TEMPLATE.md`:

- **Summary** — 1–3 bullets
- **Test plan** — how I verified it works

CI must pass. On merge, the deploy pipeline fires automatically.

Recent examples of the flow:

- [PR #5](https://github.com/Shreyas-Profile/paperloft-assist/pull/5) — Reminders recurrence overhaul + 51 new tests
- [PR #7](https://github.com/Shreyas-Profile/paperloft-assist/pull/7) — Remove snooze feature end-to-end
- [PR #8](https://github.com/Shreyas-Profile/paperloft-assist/pull/8) — Fix video URL hallucination
- [PR #10](https://github.com/Shreyas-Profile/paperloft-assist/pull/10) — Fix markdown-wrapped URLs breaking Telegram

Each PR is small and focused. Big changes get broken into a series of PRs rather than one giant one — easier to review, easier to roll back if any single piece is wrong.

---

## 18. Privacy and data handling

Documented in full at [`/privacy`](https://paperloft.uk/privacy). Highlights:

- **What's collected**: identity (Telegram / Google email + name), chat history, reminders, prescription images, support tickets, encrypted per-user skill API keys, operational logs.
- **What's NOT collected**: no analytics beacons, no third-party trackers, no ad networks.
- **Retention**:
  - Prescription image files → 30 days on disk, then purged. Extracted metadata kept forever.
  - Chat history → kept indefinitely (needed for the assistant to remember context).
  - Support tickets → kept indefinitely.
  - Server logs → kept 90 days.
- **Deletion**: users can email me to have their account and all data wiped.
- **Data location**: all Postgres data is in Germany (Hetzner Nuremberg). LLM calls go through OpenRouter, which may route to US-based Anthropic / Google infra — chat body content leaves the EU during processing.

Encryption:
- Passwords: N/A (no password auth).
- User skill API keys: AES-256-GCM with `USER_SKILL_ENCRYPTION_KEY`.
- Session JWTs: signed with `NEXTAUTH_SECRET`.
- TLS: Cloudflare-issued certs, TLS 1.3.

---

## 19. Design decisions and things I got wrong the first time

Some of the calls I made and the reasoning:

- **Telegram-only auth** — accepted the LinkedIn-audience friction to get a much simpler onboarding for the target user.
- **JWT-only sessions** — no server session store means the app scales horizontally without a shared session cache.
- **Soft-delete reminders** (status → cancelled, never hard delete) — so users can recover an accidentally-cancelled reminder by listing all statuses.
- **Snooze removed after shipping it** — turned out to be a UX quicksand. Simpler is better.
- **Per-user tenants on external MCPs** — data isolation matters. All the effort to build the provisioning flow pays for itself the first time two users have opposing prescription contents.
- **No microservices** — one Next.js app, one Postgres, plus a few sibling MCP containers. Fewer moving parts, easier to reason about.
- **No feature flags** — small enough project that PRs merge fast; adding a flag layer would be premature complexity.

Things I got wrong and had to fix:
- **Month-end recurrence** — Jan 31 + 1 month was rolling into Mar 3 because I used JS's default `setMonth` overflow. Fixed by clamping to the target month's last valid day.
- **DST drift** — used local-time date setters, then discovered that when a fire crossed a BST/GMT boundary the time drifted an hour. Fixed by switching everything to UTC setters.
- **The whole "instance ID" mental model for snooze** — assumed users would react to a fire quickly. In practice they see it 30 minutes later, ask to snooze, and the id is stale. Killed the feature rather than build ever-more-complex workarounds.
- **Trusting the LLM to paste URLs verbatim** — three separate bugs (templated `[jobId]`, fabricated image URLs, markdown-wrapped URLs). Each fixed by teaching the LLM more explicitly in the tool description what NOT to do.

The pattern I've learned: **LLM tool descriptions are your API contract with the model.** Vague description = LLM guesses = production bug.

---

## 20. What's next

Live and working today (verified end-to-end):
- Web chat + Telegram bot
- Reminders (all recurrence types, edit, delete, list-first ambiguity)
- Docs (upload PDFs / Word / Excel / PowerPoint / images, ask questions with page citations)
- Video render (script → MP4 with voice + animation)
- Support tickets with AI triage
- Health + status pages
- Auto-deploy with rollback

Planned for the coming weeks / months:
- **Email management** (Gmail / Outlook) — read, triage, draft, reply. User approves every send.
- **Phone calls** — "call the dentist and reschedule my appointment." Text me the outcome.
- **PowerPoint generation** — "turn this into a 10-slide deck." Return a real `.pptx`.
- **Calendar sync** — reminders and events flow into Google Calendar / iCal.
- **Family sharing** — one account, reminders for the whole household.
- **A first-party skills marketplace** — more built-in skills, not just user-added ones.

Open technical debt:
- **Cross-user isolation stress test** — architecturally sound (every query filters by user id), but not verified with a live second-account test.
- **Automated E2E tests** for the CRUD tools (would need a test DB in CI).
- **The Telegram Login Widget as only auth** — probably need to add a second method before wider public launch.
- **Monitoring** — no Sentry / no external uptime check. Deploy pipeline health check is the only safety net.

---

*This project was built solo, from scratch, in ~5 weeks. Every line of application code, every deploy script, every schema decision, every UX choice is mine. The infrastructure is real (paying customers use it), the deploys are automated, the code is on GitHub, and the whole thing is running today at paperloft.uk.*
