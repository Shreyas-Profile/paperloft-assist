# Support

## Reporting a bug or requesting a feature

Fill in the form at [paperloft.uk/support](https://paperloft.uk/support).
Anyone can — you don't have to be signed in. If you leave your email I'll
reply there; if not, you'll have to check back yourself.

## What happens after you submit

```
your form submission
        │
        ▼
POST /api/support
        │
        ▼
┌──────────────────────────┐
│ Ticket saved to DB       │  ← ticket exists here even if the next steps fail
│ (SupportTicket row,      │
│  ticket #N, status=open) │
└──────────────────────────┘
        │
        ▼  fire-and-forget
┌──────────────────────────┐
│ AI triage                │  one LLM call, structured output:
│                          │  { category, priority, summary,
│                          │    suggestedFiles[], draftReply, notes }
│                          │  stored on the ticket
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│ Telegram DM to admin(s)  │  I get the AI's take + a link to
│                          │  /admin/support/:id
└──────────────────────────┘
        │
        ▼
      I read it.
```

The AI-triage step is **suggestive, not decisive** — I read every ticket
and pick priority / category myself if I disagree. It exists to make my
first-look faster, not to auto-close anything.

## SLA — what "as fast as I can" means

I'm one person building this alongside school. I'm honest about that.
Here's what I try to hit:

| Priority | Meaning | Response |
|---|---|---|
| **P0** | Site is down, or user data was lost / corrupted, or something dangerous (medication reminders firing wrong meds, etc.) | Same day, whenever I next look at my phone |
| **P1** | Feature is broken for one specific user — sign-in loop, missing reminder, chat crash on their conversation | Within 3 days |
| **P2** | Annoying UX, a small bug that has a workaround, a copy fix | Within a week or two |
| **P3** | Cosmetic, low-value, "would be nice if…" | When I get to it (could be a while) |

The AI's initial priority is often wrong on the way UP — treat any P0/P1
guess with suspicion until I've confirmed it.

## For me (admin ops runbook)

### Where to see tickets
- Public form: `/support`
- Admin list: `/admin/support` (admin-email-gated)
- Detail: `/admin/support/[id]` — shows the AI triage, status buttons, retriage

### Adjusting an incoming ticket
Open the detail page → the buttons at the top do everything:
- **Mark in progress** / **Mark done** / **Won't fix** / **Reopen** — status
- **Retriage** — re-run the LLM against the current text (useful if
  triage returned nonsense the first time, or if the ticket has been edited)

### Adding a new admin
Edit `src/lib/admin.ts` — the `ADMIN_EMAILS` set. Deploy. New admins
also see the Telegram DM automatically as long as they've linked their
Telegram to their Paperloft account (via `/settings`).

## What v2 will add

- **AI-drafted PRs.** The agent goes from "here are the files you should
  look at" to "here's a branch with a proposed diff — approve on GitHub
  or reject and try again." Needs a GitHub PAT with repo scope + tight
  scoping so it can't touch anything outside `src/`.
- **Duplicate detection** — the triage pass compares against recent open
  tickets and flags likely duplicates.
- **Reply-to-ticket via email** — if the submitter left an email, I can
  reply directly from the admin page and the exchange gets logged.
