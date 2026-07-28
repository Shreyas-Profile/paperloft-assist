# ADR 0001 — Telegram-first delivery

- **Status:** accepted, 2026-07-26
- **Deciders:** Shreyas

## Context

Paperloft needs a delivery channel for reminders and chat. Original plan
was WhatsApp via wasenderapi (a Baileys-based reseller). In practice,
the wasenderapi WhatsApp sessions dropped silently — OTPs were "sent"
but never arrived, so sign-in got stuck for real users. Every incident
required manual QR-code re-scan on the wasender dashboard.

## Decision

Move the primary flow to Telegram:

- Sign-in via the Telegram Login Widget (browser-side signed payload,
  no OTP round-trip).
- Reminder delivery via `@PaperloftAssistantBot`.
- WhatsApp send path stays in the code as a backdoor but is not
  surfaced in the UI.

## Consequences

- **Positive:** No more silent OTP drops. Voice notes, photos, and PDFs
  come through the same Telegram Bot API as text — no extra plumbing
  needed. The bot API is stable and free.
- **Negative:** UK users are less familiar with Telegram than
  WhatsApp. The landing page has to include a "never used Telegram?
  2-minute setup" collapsible.
- **Reversible?** Yes, cheaply. The WhatsApp send path already works;
  bringing back sign-in is one-page of UI plus reinstating a working
  wasender account.
