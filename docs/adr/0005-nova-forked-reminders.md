# ADR 0005 — Vendored Nova reminders skill

- **Status:** accepted, 2026-07-16
- **Deciders:** Shreyas

## Context

The reminders skill (create/list/update/delete, medication schedules,
prescription intake with vision, cron-based fires) is a big chunk of
code. Pawan's separate project (`Pakki10/nova-reminders`) already had
a working implementation — same problem, MIT-licensed, actively used
in his Nova assistant.

## Decision

Vendor Nova's reminders skill directly into
`src/lib/skills/nova-reminders/` rather than build a competing
implementation. `userId` is stored as email (Paperloft convention);
everything else runs as-is with a thin adapter (`reminders-adapter.ts`).

## Consequences

- **Positive:** Weeks of work skipped. We inherit the ack-button state
  machine, the prescription vision extractor, and the recurrence
  parser. When Pawan fixes a bug in Nova, we can cherry-pick the diff.
- **Negative:** We can't drop what we don't like. Some Nova defaults
  (WhatsApp channel names, specific model choices) don't fit
  Paperloft's Telegram-first shape — we've had to layer overrides.
  Divergence risk grows over time.
- **Reversible?** Yes, but expensive. Building from scratch would take
  a couple of weeks. Only worth it if Nova stops being maintained OR
  the two products' requirements diverge sharply.
