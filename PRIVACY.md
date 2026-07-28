# Privacy policy

_Last updated: 2026-07-28._

Paperloft Assist is a small personal-assistant service run by Shreyas
Pavuluri from the United Kingdom. This document explains what the
service knows about you, why it knows it, how long it keeps it, and
how you can make it forget.

Plain English throughout. If anything is unclear, [file a support
ticket](https://paperloft.uk/support) and I'll rewrite it.

## What we collect

Only what the service needs to function. No analytics beacons, no
third-party trackers.

| Category | Data | Why |
|---|---|---|
| Identity | Google email + name (Google sign-in), or Telegram username + first name + chat_id (Telegram sign-in) | So we know which reminders / chats belong to you |
| Chat history | Messages you send Paperloft (web or Telegram) + Paperloft's replies | Loaded as context on your next message so the bot remembers what you were talking about |
| Reminders | Title, due time, recurrence, medication metadata, ack state | The reminder itself and the fire schedule |
| Prescription uploads | PDF or image files you send, plus the extracted structured data (medication, dose, times) | The vision-model output the reminder scheduler runs off of |
| Support tickets | Name, optional email, ticket body, plus AI triage output | So you can raise bugs / requests and I can reply |
| Skill connections | For hosted skills (docs.regiq.in etc.), a per-user API key stored encrypted with AES-256-GCM | So Paperloft can call those skills as you |
| Operational logs | Timestamps, tool-call names, LLM latency, error messages | Debugging the app; auto-rotated after 14 days |

## What we don't collect

- No IP address logging beyond what Cloudflare's edge does by default.
- No cross-site tracking cookies. Session cookies are for auth only.
- No selling or sharing of any of the above to third parties. Period.

## Who else sees your data

Paperloft calls a small number of third-party services to work. They
see the data listed:

- **OpenRouter** — every chat message you send and every reply Paperloft
  generates flows through OpenRouter to the underlying LLM (Anthropic,
  Google, etc.). OpenRouter's [privacy policy](https://openrouter.ai/privacy)
  applies to that leg. You can opt out of provider training by using
  models that offer that (most Anthropic + Google models do by default).
- **Telegram** — if you use the bot, Telegram's servers relay your
  messages to Paperloft. Telegram's [privacy policy](https://telegram.org/privacy)
  applies to that leg.
- **Google** — if you sign in with Google, Google sees only that you
  authenticated at paperloft.uk (standard OAuth).
- **Cloudflare** — sits in front of paperloft.uk and can see request
  metadata (IP, path, headers). Standard tunnel provider.
- **Hetzner** — hosts the actual server. Physical infrastructure only;
  they don't have access to the application database in any operational
  sense.

## How long we keep it

| Data | Retention |
|---|---|
| Chat messages | Kept until you delete them or delete your account |
| Reminders (past, cancelled) | Kept until you delete them; auto-purged after 1 year |
| Prescription uploads | Kept until you delete them |
| Support tickets | Kept 2 years, then anonymised (submitter name/email nulled) |
| Operational logs | Auto-rotated at 14 days |
| Encrypted skill keys | Kept for as long as the skill is enabled; wiped on disable |

## How to delete your data

**Individual items:** message the bot / use the web chat / hit the
appropriate button in `/skills` or `/settings`.

**Everything:** [file a support ticket](https://paperloft.uk/support)
asking to delete your account. I'll manually run a purge of every row
tied to your identifier — email, chat_id, phone — within 30 days and
email you when it's done. If you left an email; otherwise I'll reply
on Telegram.

Some operational logs may retain your identifier for the 14-day
rotation window; they get wiped when they roll over.

## Children

Paperloft doesn't market to under-13s. If you're a parent and think a
child under 13 created an account, [file a support ticket](https://paperloft.uk/support)
and I'll delete it.

## Changes to this policy

Any change gets a fresh date at the top of this file and a note in
[CHANGELOG.md](./CHANGELOG.md). No email blast — small service, small
audience.

## Contact

Anything not covered here — questions, concerns, requests, complaints
— [file a support ticket](https://paperloft.uk/support) or email
[shreyas.pavuluri@gmail.com](mailto:shreyas.pavuluri@gmail.com).
