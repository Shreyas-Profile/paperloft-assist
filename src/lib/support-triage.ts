// AI triage for incoming support tickets.
//
// Called from POST /api/support right after the ticket is persisted, and
// again from POST /api/admin/support/:id/retriage when an admin wants a
// fresh take. One LLM call, one structured output — no tool loop, no
// side-effects on the codebase. The output is stored on the ticket for
// the admin to accept or ignore.
//
// Design intent: reduce the amount of reading an admin has to do BEFORE
// they decide what to do with a ticket. Not to actually fix the bug.
// PR-drafting (the "v2" of #6) is a separate, riskier step that we
// deliberately don't do here.

import { generateText } from "ai";
import { z } from "zod";

import { CHAT_MODEL, openrouter } from "./openrouter";

// Schema the model has to fit into. Enums are used both to constrain the
// model's output and to render pill-style tags on the admin page.
export const triageSchema = z.object({
  category: z.enum(["bug", "feature", "question", "other"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  summary: z
    .string()
    .max(280)
    .describe(
      "One-tweet summary of what the user is actually asking for. No jargon.",
    ),
  suggestedFiles: z
    .array(z.string())
    .max(5)
    .describe(
      "Repo-relative paths the admin should probably open first. Empty if a code change is unlikely to be involved.",
    ),
  draftReply: z
    .string()
    .max(500)
    .describe(
      "One-paragraph reply the admin could send back verbatim after glancing at the fix.",
    ),
  notes: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Anything else worth flagging — duplicate of ticket N, security-sensitive, blocked on external, etc.",
    ),
});

export type TriageResult = z.infer<typeof triageSchema>;

const TRIAGE_SYSTEM_PROMPT = `You are the triage assistant for Paperloft Assist, an AI reminder app on Telegram + web.

Your job on each incoming support ticket:
1. Read the user's message.
2. Return a JSON object matching the schema:
   - category: bug (something broke) | feature (they want a new thing) | question (they need help using it) | other
   - priority: p0 (site down / data loss / actively broken for many users) | p1 (broken for one user / major regression) | p2 (nice-to-have fix / minor UX issue) | p3 (cosmetic / low-value ask)
   - summary: single sentence, plain English, no jargon
   - suggestedFiles: up to 5 repo-relative paths the maintainer should read first (empty array if the ticket is a question with no code involved). Common areas:
     * src/lib/telegram-chat.ts — Telegram message handling + hallucination catch
     * src/lib/telegram-media.ts — voice/photo/PDF ingest
     * src/lib/skills/nova-reminders/* — reminder CRUD, prompts, delivery
     * src/app/api/telegram/bot-webhook/[secret]/route.ts — inbound Telegram webhook
     * src/app/api/cron/reminders/route.ts — reminder scheduler tick
     * src/app/(marketing)/page.tsx, src/app/signin/page.tsx — landing + sign-in
   - draftReply: one paragraph the admin could send back verbatim once the fix ships
   - notes: optional, only if there's something the admin needs to know beyond category/priority

3. Never make up facts about the codebase — if the ticket is too vague to guess at files, return an empty suggestedFiles array.
4. Bias priority DOWN, not up. p0 is only for "app is down". p3 is fine and honest.
5. Draft replies must be plain English, no "we appreciate your feedback" corporate voice.`;

// LLM call. Returns a validated triage object; on any failure returns a
// safe default so the ticket flow doesn't block on triage errors.
export async function triageTicket({
  title,
  body,
}: {
  title: string;
  body: string;
}): Promise<TriageResult> {
  try {
    const { text } = await generateText({
      model: openrouter.chat(CHAT_MODEL),
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `TICKET TITLE:\n${title}\n\nTICKET BODY:\n${body}\n\n` +
            `Respond with ONLY the JSON object (no code fence, no prose). ` +
            `Follow the schema in the system prompt exactly.`,
        },
      ],
    });
    return parseTriageOutput(text);
  } catch (err) {
    console.error("[support-triage] LLM call failed:", err);
    return fallbackTriage();
  }
}

/**
 * Pure helper — extracts a JSON object from the model's text (handles both
 * bare JSON and JSON wrapped in a ```json fence) and validates it against
 * the schema. Exported so unit tests can pin the parsing behaviour without
 * hitting the LLM.
 */
export function parseTriageOutput(raw: string): TriageResult {
  const trimmed = raw.trim();
  // Strip a code fence if present. Models sometimes ignore "no code fence".
  const jsonText = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonText);
    const validated = triageSchema.safeParse(parsed);
    if (validated.success) return validated.data;
    console.warn("[support-triage] schema mismatch:", validated.error.issues);
    return fallbackTriage();
  } catch {
    console.warn("[support-triage] unparseable JSON:", jsonText.slice(0, 200));
    return fallbackTriage();
  }
}

/**
 * Safe default when triage fails — the admin still gets a routed ticket,
 * just without pre-analysis. Better than blocking the submission on a
 * flaky LLM call.
 */
export function fallbackTriage(): TriageResult {
  return {
    category: "other",
    priority: "p2",
    summary: "Triage failed — admin should read the ticket body directly.",
    suggestedFiles: [],
    draftReply:
      "Thanks for the report — I've logged it and will take a look. I'll reply here once I have news.",
    notes: "AI triage returned an invalid/empty response.",
  };
}
