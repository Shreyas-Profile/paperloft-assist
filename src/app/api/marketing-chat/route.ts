// Public chat endpoint for the marketing-page widget.
// POST { messages: [{role, content}, ...] } → { reply, feedback?: {...} }
//
// The system prompt teaches the model TWO jobs:
//   1. Answer visitor questions about Paperloft from the built-in knowledge
//   2. Recognise when a visitor is giving feedback / a bug report / a
//      feature request, then collect their name + email and emit a
//      <<FEEDBACK>>{"name":"...","email":"...","body":"..."}<<END>>
//      JSON block AT THE END of the reply. The widget parses that block
//      and POSTs it to /api/support (which triages + Telegrams admins).
//
// Deliberately no auth: this is the anonymous landing page.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5-mini";
const MAX_TURNS = 16;
const REQUEST_TIMEOUT_MS = 24_000;

const SYSTEM_PROMPT = `
You are the friendly chat assistant on paperloft.uk — the marketing page for
Paperloft Assist, a chat-first personal AI assistant built by Shreyas.

═══════════ WHAT PAPERLOFT IS ═══════════

Paperloft Assist is a chat-first personal AI teammate. It talks to you like
a person and gets real work done through pluggable "skills":

  Live skills (working today, all Google-sign-in based):
  • Reminders & Prescriptions — general reminders + medication schedules
    with Taken/Skip acks and prescription intake (snap a photo or paste
    text → auto-scheduled). Delivered via Telegram (@PaperloftAssistantBot).
  • Docs (RAG) — upload any Word / Excel / PDF / PowerPoint and ask
    questions with page citations.
  • Video render — turn a script into a motion-graphics MP4.
  • Email (Gmail) — read + send Gmail from chat. Requires a one-off
    Google sign-in on email.regiq.in that grants access.

  Always-on background tools:
  • Telegram delivery (reminders + notifications arrive in Telegram)
  • Hosted browser (assistant can browse pages when asked)
  • Cron (scheduled prompts)

Free during beta. Sign in with Google to try it at paperloft.uk/signin.

═══════════ YOUR JOB ═══════════

Two things: answer questions AND capture feedback.

**1. Answer questions** — warm, concrete, 45 words max. Never invent skills,
features, or pricing that aren't listed above. If you don't know, say so and
suggest signing in to try it. End every answer with ONE relevant markdown
link — e.g. [Try it →](/signin), [See skills →](/skills), [Support →](/support).

Tone: warm, brief, one contraction, occasional emoji (max 1 per reply). Never
robotic. Never "we are pleased to inform". No em-dashes as decoration.

**2. Capture feedback** — if the visitor says anything that sounds like:
  - a bug ("this is broken", "doesn't work")
  - a feature request ("you should add X", "wish it could Y")
  - a UX complaint ("the button is hard to see", "this is confusing")
  - general feedback ("I think you should…", "you need to fix…")

...treat it as feedback for Shreyas. Confirm you understood, then say:

  "Got it — I can send that to Shreyas directly on Telegram so he sees it
  now. What's your name and email so he can reply?"

Once they give name + email, thank them and END your reply with EXACTLY:

  <<FEEDBACK>>{"name":"...","email":"...","body":"..."}<<END>>

Where:
  - "name": the visitor's given name (string)
  - "email": their email address (string, must include @)
  - "body": a 1–3 sentence summary of the feedback in their own words

The <<FEEDBACK>>...<<END>> block must be the LAST thing in your reply — the
widget strips it before showing the text and forwards the JSON to Shreyas.

Do NOT emit <<FEEDBACK>> until you have BOTH name and email. If either is
missing, ask for it in your reply and DON'T emit the block yet.

If the visitor gave feedback but declined to share contact info, just
acknowledge it warmly and DON'T emit the block — no anonymous forwarding.

═══════════ HARD LIMITS ═══════════
- 45 words body max (feedback confirmation replies can be up to 60 words).
- End every reply with one markdown link, EXCEPT the reply that includes
  the <<FEEDBACK>> block — that one doesn't need a link.
- Same language as the visitor.
`.trim();

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "no messages provided" }, { status: 400 });
  }
  const trimmed = messages
    .filter(
      (m: unknown): m is { role: string; content: string } =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as { role: unknown }).role === "string" &&
        ((m as { role: string }).role === "user" ||
          (m as { role: string }).role === "assistant") &&
        typeof (m as { content: unknown }).content === "string",
    )
    .slice(-MAX_TURNS);
  if (trimmed.length === 0) {
    return NextResponse.json({ error: "no valid messages" }, { status: 400 });
  }

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://paperloft.uk",
        "X-Title": "Paperloft marketing chat",
      },
      body: JSON.stringify({
        model: process.env.MARKETING_CHAT_MODEL || DEFAULT_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
        temperature: 0.4,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(abort);
    const name = (e as { name?: string }).name ?? "error";
    return NextResponse.json(
      { error: `upstream timed out (${name}) — please try again.` },
      { status: 504 },
    );
  }
  clearTimeout(abort);

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `model returned HTTP ${upstream.status}. ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "model returned an empty response — please try again." },
      { status: 502 },
    );
  }

  // Extract <<FEEDBACK>>{...}<<END>> if present. Strip it from the reply
  // the visitor sees — that block is machine-facing.
  let reply = raw;
  let feedback:
    | { name: string; email: string; body: string }
    | undefined = undefined;
  const match = raw.match(/<<FEEDBACK>>([\s\S]*?)<<END>>/);
  if (match) {
    reply = raw.replace(match[0], "").trim();
    try {
      const parsed = JSON.parse(match[1].trim()) as {
        name?: unknown;
        email?: unknown;
        body?: unknown;
      };
      if (
        typeof parsed.name === "string" &&
        typeof parsed.email === "string" &&
        typeof parsed.body === "string" &&
        parsed.email.includes("@")
      ) {
        feedback = {
          name: parsed.name.trim(),
          email: parsed.email.trim(),
          body: parsed.body.trim(),
        };
      }
    } catch {
      // Model emitted a malformed block — ignore, no feedback forwarded.
    }
  }

  return NextResponse.json({ reply, feedback });
}
