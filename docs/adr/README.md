# Architecture Decision Records

An ADR is a short doc explaining WHY we picked a particular technology
or approach. Two sentences of context, the decision, the reason. Not a
tutorial. Not a design doc.

Purpose: when future-me (or someone new) opens the repo and wonders
"why on earth are we using X?", the answer is here instead of in a
Slack thread from months ago.

Format: markdown, numbered, immutable once merged. If a decision is
reversed, add a new ADR pointing back at the old one — don't delete.

## Index

- [0001 — Telegram-first delivery](./0001-telegram-first-delivery.md)
- [0002 — Hetzner + Docker (not Vercel)](./0002-hetzner-docker-hosting.md)
- [0003 — Postgres + Prisma](./0003-postgres-and-prisma.md)
- [0004 — OpenRouter for every LLM call](./0004-openrouter-for-llm.md)
- [0005 — Vendored Nova reminders skill](./0005-nova-forked-reminders.md)
