# API reference

Every HTTP route Paperloft exposes. Kept short — each entry is
purpose, auth, request shape, response shape, one example.

The public routes are what a third-party mobile app or scripting user
would call. The internal routes are for Paperloft's own frontend and
scheduled jobs; they're documented anyway so future-me remembers what
they do.

Base URL: `https://paperloft.uk`

---

## Public

### `POST /api/support`

Submit a support ticket. Anyone can call — no auth required.

**Body**

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",      // optional
  "title": "Bot forgets my reminders after refresh",
  "body": "Steps to reproduce..."
}
```

- `name`: 1–80 chars
- `email`: optional, valid email if given
- `title`: 3–140 chars
- `body`: 5–4000 chars

**Response (201)**

```json
{ "ok": true, "ticketId": "cms3cmrp5...", "ticketNumber": 42 }
```

**Response (400)** — validation failure with issue list.

**Side effects:** the row is persisted synchronously; AI triage and
Telegram admin notification fire in the background after the response.

---

### `GET /api/health`

Health probe. See [ADR 0002](./adr/0002-hetzner-docker-hosting.md)
for the operational context.

**Response (200)** — site is up (even if some subsystems degraded)

```json
{
  "status": "ok",
  "version": "0.2.0",
  "timestamp": "2026-07-28T14:00:00.000Z",
  "checks": {
    "database":   { "status": "ok", "latencyMs": 3 },
    "telegramBot":{ "status": "ok", "latencyMs": 120 },
    "openrouter": { "status": "ok", "detail": "config only" }
  }
}
```

**Response (503)** — database check failed, site is genuinely down.

---

## Auth

### `POST /api/auth/telegram-login`

Verifies a signed payload from the Telegram Login Widget and issues a
NextAuth session cookie. Called only by the widget script — not a
public JSON API.

### `POST /api/auth/otp/verify`

Legacy WhatsApp/Telegram OTP path. Consumes a code from `sign_in_codes`
and issues a session cookie.

### `GET|POST /api/auth/[...nextauth]`

Standard Auth.js catch-all — sign-in, sign-out, callbacks, providers.

---

## Telegram

### `POST /api/telegram/bot-webhook/[secret]`

Inbound webhook from Telegram. Handles `/start`, plain-text messages,
voice notes, photos, and PDFs. The `[secret]` path segment must match
`TELEGRAM_WEBHOOK_SECRET` — mismatches return 200 (no error) so
Telegram doesn't disable the webhook on bad requests.

Body is a Telegram `Update` object; see
[Telegram Bot API docs](https://core.telegram.org/bots/api#update).

**Response:** always `{ok: true}` and always 200 within milliseconds
(the actual handling is fire-and-forget so Telegram doesn't retry).

### `POST /api/telegram/link-init`

Issues a short-lived nonce so the signed-in web user can prove to the
bot that a specific Telegram chat is theirs. Auth-required.

**Response**

```json
{ "url": "https://t.me/PaperloftAssistantBot?start=abc123", "expiresAt": "..." }
```

---

## Reminders + cron

### `POST /api/cron/fire`

Called by cron.regiq.in with an HMAC-signed payload when a scheduled
prompt or reminder is due. Signature verified against
`CRON_WEBHOOK_SIGNING_SECRET`.

### `POST /api/cron/reminders`

Legacy self-scheduled endpoint. Called with a bearer token matching
`CRON_SECRET`. Runs one tick of the reminder scheduler (find due
reminders, deliver, mark sent).

---

## Chat

### `POST /api/chat`

Streams the LLM's response. Auth-required.

**Body**

```json
{
  "conversationId": "...",
  "message": "remind me to call mum at 8pm"
}
```

**Response:** `text/event-stream` — server-sent-events with the model
tokens as they arrive. Consumed by the web chat UI, not typically
called by external tooling.

---

## Skills marketplace

### `POST /api/skills/[skillId]/toggle`

Enables or disables a skill for the current user. Auth-required.

### `POST /api/user-skills`

Adds a bring-your-own MCP skill. Body includes an MCP URL + optional
headers. Headers are AES-256-GCM encrypted before persistence.

### `DELETE /api/user-skills/[id]`

Removes a BYO skill. Encrypted headers are wiped.

### `POST /api/platform/provision-user`

Provisions a sub-account on the paired hosted-MCP skill server
(docs.regiq.in etc.) for the current user. Runs once per skill on
first enable.

---

## Admin

### `POST /api/admin/support/[id]`

Update a support ticket's status or trigger a fresh AI triage.
`isAdmin(session.user.email)`-gated; non-admin returns 403.

**Body — status change**

```json
{ "status": "in_progress" | "done" | "wont_fix" | "open" }
```

**Body — retriage**

```json
{ "retriage": true }
```

---

## Uploads + docs

### `POST /api/docs/upload`

Proxies an uploaded file to docs.regiq.in using the current user's
sub-account key. Auth-required. Body is multipart/form-data with a
`file` field.

---

## Debug + LinkedIn (rarely used)

- `GET /api/debug/client-event` — dev-only client-side event echo.
- `GET /api/linkedin/connect` — starts the LinkedIn OAuth flow.
- `POST /api/linkedin/post` — publishes text to the connected LinkedIn
  account. Only called from the `linkedin_post` tool inside the LLM
  toolbelt.

---

## Response envelope conventions

- Errors return `{ "error": "<snake_case_code>", ...detail? }` and a
  matching non-2xx HTTP code. `invalid_input` for validation failures,
  `forbidden` for auth, `not_found` for missing rows.
- Success responses either return the resource directly or
  `{ ok: true, ...fields }`.
- Nothing is ever paginated by cursor today. Lists cap at `take: N`
  (usually 20–50) — if we outgrow that, cursor pagination gets added
  per-endpoint.
