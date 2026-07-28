# Changelog

All notable changes to Paperloft Assist land here. Newest at the top.
Version numbers follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Added — Round 4 (SDLC docs + operations)
- **`/api/health` endpoint** — real DB + Telegram bot health probe. 503
  when DB is down, 200 with detail otherwise. Pointable at UptimeRobot.
- **`/status` public page** — human-readable ✅/⚠️/❌ badges per subsystem,
  rendered server-side from /api/health.
- **`/privacy` page + PRIVACY.md** — what we collect, why, retention,
  deletion process. Public GDPR-ish policy suitable for handing to a
  reviewer.
- **RUNBOOK.md** — "at 2am something's broken" cheat-sheet: site down,
  Telegram silent, reminders not firing, disk full, deploy shipped bad
  code, key rotation.
- **docs/architecture.md** — one-page system diagram (Mermaid) + component
  descriptions + request-path walkthroughs + "when each piece would
  need to change" table.
- **docs/adr/** — 5 architecture decision records: Telegram-first
  delivery, Hetzner+Docker choice, Postgres+Prisma pin, OpenRouter
  routing, Nova reminders fork.
- **docs/branching.md** + **CONTRIBUTING.md** + **`.github/PULL_REQUEST_TEMPLATE.md`** —
  formalised the feature-branch + PR workflow that this round is the
  first to use.
- **docs/api.md** — every /api/* route documented (purpose, auth,
  request, response, examples).
- **Landing footer links** — `/status`, `/support`, `/privacy` added.
- **`foldStatus` regression tests** — pins the subsystem rollup rules.

### Added — Round 1-3 (from earlier)
- **Test suite** — Vitest, 36 tests total (`pnpm test`).
- **CI** — GitHub Actions runs type-check + tests on every push and PR.
- **`typecheck` script** — `pnpm typecheck` runs `tsc --noEmit`.

### Changed
- Extracted pure helpers from `telegram-chat.ts` (`sliceRecentMessages`,
  `buildThinReplySummary`, `OFFER_LANGUAGE_RE`) and re-exported
  `REMINDER_CLAIM_RE` so regression tests can pin their behaviour.

## [0.2.0] — 2026-07-26

### Added
- **`reminder_delete_many` tool** — bulk-cancel by ids or by status filter
  (`{status: "all"}` wipes everything). Solves "delete all my reminders"
  only deleting one and hitting `STEP_CAP` mid-chain.
- **`reminder_list` accepts `status: "all"`** — user can now ask for
  "everything I have" and see pending + sent + cancelled in one reply.
- **Telegram voice / photo / PDF handling** (`telegram-media.ts`) —
  voice notes transcribed via Gemini 2.5 Flash on OpenRouter;
  images described via configured chat model; PDFs rasterised
  page-by-page via `pdftoppm` (poppler-utils in Docker image) and
  sent as vision blocks so image-only pages don't get silently
  dropped by providers that only extract text.
- **Thin-reply fallback** — when the model runs tools but produces
  <15 chars (e.g. a lone "✅" after burning `STEP_CAP` on deletes),
  code builds a deterministic factual summary from tool-call counts
  and (for `reminder_delete_many`) the actual cancelled count.

### Changed
- Landing page + skills page reframed around Telegram-first delivery;
  dropped "browse real websites" / "anonymous browsing" copy.
- System prompts stripped of web-browsing claims. Added:
  - "never invent current facts — say you can't check that live"
  - "be direct, don't apologise unless a tool actually failed"
  - "skip decorative emojis (🙏 🔧 ✨) — a single ✅ / ❌ is fine"
  - "when the user says 'delete all', prefer `reminder_delete_many`
    over looping `reminder_delete`"
- `STEP_CAP` bumped **8 → 15** so bulk operations have room for a
  summary step after ~10 tool calls.
- `ALWAYS_ON_TOOLS` reduced to `cron_*` only — `fetch_url` and every
  `browser_*` removed from the toolbelt.
- `REMINDER_CLAIM_RE` tightened to only match unambiguous first-person
  past-tense claims. Old regex misfired on "want me to set…?" and
  "you're all set with that reminder" (idiom, not verb).
- `HISTORY_LIMIT` bumped **20 → 30** with a fix from `orderBy: asc`
  to `orderBy: desc + reverse` so history returns the last N messages
  instead of the oldest N — silent context loss after msg 20.

### Fixed
- **History returned oldest 20** — root cause of "the bot forgot what
  we were talking about" once a conversation grew past 20 messages.
- **Hallucination-catch false positives** — bot was retrying (and
  wasting tokens) on offer/idiom replies that only mentioned "reminder"
  in passing.
- **PDF vision** — some providers only extracted text and silently
  dropped image-only pages (scanned receipts, stamped forms). Now
  every page is rasterised and sent as an image block regardless.

## [0.1.0] — pre-2026-07-26

- Initial Paperloft Assist app on Hetzner (Next.js 16 + Prisma 6.19.2
  + Postgres). Web `/chat`, Telegram `@PaperloftAssistantBot`, sign-in
  via Telegram Login Widget, Nova-forked reminders skill, docs-mcp RAG,
  video-render-mcp, cron-mcp.
