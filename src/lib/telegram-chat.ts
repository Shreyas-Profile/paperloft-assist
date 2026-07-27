// Handle a plain-text message from a linked Telegram user.
//
// Same LLM pipeline as web /chat — resolves chatId → userEmail via
// telegram_links, loads last N messages of a dedicated Telegram conversation,
// calls the LLM with the user's enabled skills wired as tools, persists both
// sides, returns the reply text so the webhook can DM it back.
//
// Reliability tweaks vs the naive setup:
//   * stopWhen 8 (was 25). Nova uses 5 — Haiku wanders if given too much rope.
//   * Anti-hallucination post-check: if the reply text says a reminder was
//     set / updated / deleted BUT reminder_* wasn't in the tool-call list
//     for this turn, retry with `toolChoice: "required"` to force a real
//     tool call. Real bug we hit: Haiku said "✅ Reminder set" four times
//     for one user; only one actually made it to the DB.

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { prisma } from "./db";
import { CHAT_MODEL, SYSTEM_PROMPT, openrouter } from "./openrouter";
import { appendMessage } from "./chat";
import { skills, makeUserScopedSkills } from "./skills";
import { makeLinkedInSkill } from "./skills/linkedin-post";
import { listEnabledSkills } from "./enabled-skills";
import { toolsForEnabledSkills } from "./skill-tool-map";
import { createReminderSkill } from "./skills/nova-reminders";
import { makeReminderCtx } from "./reminders-adapter";
import { makeUserByoSkills, listByoToolNames } from "./user-skills";

const HISTORY_LIMIT = 30;
const TELEGRAM_MAX_CHARS = 4000; // Telegram's cap is 4096; leave headroom.
const STEP_CAP = 15; // bumped from 8 after a "delete all 8 reminders" turn used up the whole cap and left no step for a summary — Shreyas got a lone ✅. 15 is enough for a batch of ~10 tool calls plus list+summary. Higher hallucination risk stays guarded by the post-hoc REMINDER_CLAIM_RE check below.

const CONNECT_HINT =
  "You're not linked to a Paperloft account yet.\n\n" +
  "Open https://paperloft.uk/settings and hit 'Connect Telegram bot' to link this chat to your account. Then message me here and I'll reply as your assistant.";

// Reply-text patterns that indicate the model CLAIMED to have persisted a
// reminder. Tight-by-design — earlier looser patterns misfired on:
//   • "want me to set up reminders?"   (offer, not claim)
//   • "you're all set with that reminder" (idiom, not verb)
//   • "adjust the appointment reminder" (mention, not claim)
// so we now require an unambiguous first-person past-tense claim or the
// explicit "reminder is/has been ..." construction the M REVATI bug used.
export const REMINDER_CLAIM_RE =
  /(?:✅\s*reminder\s*(?:set|created|scheduled|updated|deleted|cancell?ed)|reminder\s+(?:is|has\s+been)\s+(?:set|created|scheduled|updated|deleted|removed|cancell?ed)|i(?:'?ve| have)\s+(?:set|scheduled|created|updated|deleted|cancell?ed)\s+(?:a\s+|the\s+|your\s+|that\s+)?reminder|done[!.\s]+i(?:'?ve| have)\s+(?:set|scheduled|created)|i'?ll\s+remind\s+you\s+(?:at|in|on|when|tomorrow|today|next|every))/i;

// Guard against firing the hallucination-catch retry when the model is
// OFFERING to do something ("want me to set up reminders?") rather than
// CLAIMING it did — the M REVATI regex would otherwise trigger a wasted
// retry.
export const OFFER_LANGUAGE_RE =
  /\b(want me to|would you like|shall i|should i|do you want me to|can i (?:set|schedule|create|add|update|delete|cancel|remind))\b/i;

/**
 * Pure helper: pick the LAST `limit` messages from a full history array,
 * preserving chronological order. Extracted for unit-testability — the
 * original inline `findMany orderBy asc take N` bug returned the OLDEST
 * N messages, silently invisible until the conversation grew past N.
 * The DB query itself now uses `orderBy desc take N + reverse`; this
 * helper mirrors that shape for other code paths that receive pre-fetched
 * history and want the same slice guarantee.
 */
export function sliceRecentMessages<T>(all: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (all.length <= limit) return all.slice();
  return all.slice(all.length - limit);
}

/**
 * Pure helper: build a factual "Done — cancelled N reminders" summary
 * from the tool-call names + bulk-cancel count when the LLM produced a
 * thin reply (empty or a bare "✅"). Returns null when there's nothing
 * meaningful to summarise so the caller keeps whatever text it had.
 *
 * bulkCancelled = total rows the reminder_delete_many tool reports
 * cancelled (from tool result). reminder_delete individual calls count 1 each.
 */
export function buildThinReplySummary(
  mainToolCalls: string[],
  bulkCancelled: number,
  currentReply: string,
): string | null {
  const counts: Record<string, number> = {};
  for (const t of mainToolCalls) counts[t] = (counts[t] || 0) + 1;
  const deletedCount =
    (counts.reminder_delete ?? 0) + (bulkCancelled || (counts.reminder_delete_many ?? 0));
  const parts: string[] = [];
  if (deletedCount)
    parts.push(`cancelled ${deletedCount} reminder${deletedCount > 1 ? "s" : ""}`);
  if (counts.reminder_create)
    parts.push(
      `created ${counts.reminder_create} reminder${counts.reminder_create > 1 ? "s" : ""}`,
    );
  if (counts.reminder_update)
    parts.push(
      `updated ${counts.reminder_update} reminder${counts.reminder_update > 1 ? "s" : ""}`,
    );
  if (parts.length === 0) return null;
  const summary = `✅ Done — ${parts.join(", ")}.`;
  return currentReply.trim() && currentReply.trim() !== "✅"
    ? `${currentReply.trim()} ${summary}`
    : summary;
}

function filterTools<T extends Record<string, unknown>>(
  allTools: T,
  allow: Set<string>,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (allow.has(name)) out[name] = tool;
  }
  return out as Partial<T>;
}

export async function handleTelegramMessage(
  chatId: string,
  userText: string,
): Promise<string> {
  // Prefer the most recently linked row. Historical rows can pile up here
  // when the same chatId gets re-linked to a different Paperloft account —
  // upsert-on-userEmail leaves the older row behind, and picking arbitrary
  // findFirst order gave Pawan a stale placeholder email with no skills.
  // Belt + braces: bot-webhook now deletes other rows with the same chatId
  // on claim, but keeping the orderBy defends against dupes we didn't catch.
  const link = await prisma.telegramLink.findFirst({
    where: { chatId },
    orderBy: { linkedAt: "desc" },
  });
  if (!link) return CONNECT_HINT;
  const email = link.userEmail;

  const convId = `tg_${chatId}`;
  const existing = await prisma.conversation.findUnique({ where: { id: convId } });
  if (!existing) {
    await prisma.conversation.create({
      data: {
        id: convId,
        userEmail: email,
        title: `Telegram · ${link.firstName ?? link.username ?? chatId}`,
      },
    });
  }

  await appendMessage(convId, "user", userText);

  // Take the MOST RECENT HISTORY_LIMIT messages, then flip back to
  // chronological order. Original `orderBy: asc, take: N` returned the
  // OLDEST N messages, so once the conversation grew past N the LLM
  // stopped seeing anything recent — including the previous turn.
  // Real bug: Shreyas asked "not just new.. everything i have" as a
  // follow-up and the bot had no idea what the previous message was.
  const recent = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });
  const history = recent.reverse();

  const messages: ModelMessage[] = history.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const reminderSkill = createReminderSkill(makeReminderCtx(email));
  const enabled = await listEnabledSkills(email);
  const allowed = toolsForEnabledSkills(enabled);

  const [byoTools, byoNames] = await Promise.all([
    makeUserByoSkills(email),
    listByoToolNames(email),
  ]);
  for (const n of byoNames) allowed.add(n);
  const now = new Date();
  const timeContext =
    `Current UTC time: ${now.toISOString()} (${now.toUTCString()}). ` +
    `When the user says relative times ("tomorrow 9am", "in 2 hours", "tonight 8pm"), ` +
    `resolve them against this timestamp and convert to ISO 8601 UTC before calling any tool.`;

  const systemPrompt =
    timeContext + "\n\n" +
    SYSTEM_PROMPT +
    (enabled.has("reminders") ? "\n\n" + reminderSkill.systemPrompt : "") +
    "\n\nYou are speaking to the user on Telegram. Keep replies short and readable on a phone. Telegram supports basic markdown (**bold**, `code`) but not headings or tables." +
    "\n\nThe user can send you voice notes, photos, and PDFs on Telegram — those arrive here already transcribed / described / summarised by the webhook. Treat the text you see as what they actually said or sent. If the user says they attached something and the message doesn't contain it, ask them to resend — don't guess at the contents." +
    "\n\nTone: be direct. Don't apologise unless a tool actually failed with an error. Don't hedge with 'I'm not certain' or 'I think it went through' — if you don't know the state, CALL A TOOL to check (reminder_list, etc.), then answer definitively. After batch operations always report a one-line factual summary ('Deleted 6 reminders: [titles]. 3 still pending: [titles].'). Skip decorative emojis (🙏 🔧 ✨) — a single ✅ / ❌ for outcome is fine, everything else looks unprofessional." +
    "\n\nWhen the user asks to 'delete all' / 'clear everything' / 'remove them all' and you don't yet have the list of IDs: call reminder_list(status='all') FIRST to get every id, then reminder_delete on each one in sequence, then reply with a single-line summary of what you cancelled. Do NOT ask the user for permission to try again or offer partial options unless a tool call genuinely errored.";

  const toolBundle = filterTools(
    {
      ...skills,
      ...makeUserScopedSkills(email),
      ...reminderSkill.tools,
      ...byoTools,
      linkedin_post: makeLinkedInSkill(email),
    },
    allowed,
  );

  let reply: string;
  let mainToolCalls: string[] = [];
  try {
    const result = await generateText({
      model: openrouter.chat(CHAT_MODEL),
      system: systemPrompt,
      messages,
      tools: toolBundle,
      stopWhen: stepCountIs(STEP_CAP),
      providerOptions: { openai: { parallelToolCalls: false } },
    });
    reply = result.text.trim();
    let bulkCancelled = 0;
    for (const step of result.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        if (call?.toolName) mainToolCalls.push(call.toolName);
      }
      for (const tr of step.toolResults ?? []) {
        if (
          tr?.toolName === "reminder_delete_many" &&
          tr.output &&
          typeof tr.output === "object" &&
          "cancelled" in tr.output &&
          typeof (tr.output as { cancelled: unknown }).cancelled === "number"
        ) {
          bulkCancelled += (tr.output as { cancelled: number }).cancelled;
        }
      }
    }
    console.log(
      `[telegram-chat] chat=${chatId} tools=[${mainToolCalls.join(",")}] reply-len=${reply.length}`,
    );

    // Anti-hallucination: reply claims a reminder was set/updated but no
    // reminder_* tool actually fired this turn → retry forcing a tool call.
    // This is the M REVATI bug — Haiku said "✅ Reminder set" 4 times for
    // one user and only 1 actually persisted.
    //
    // Guard: don't fire the retry when the reply is OFFERING to do something
    // ("want me to set up reminders?", "shall I schedule that?") — the regex
    // otherwise sees "set…reminders" and thinks it's a past claim. The guard
    // keeps the (already correct) answer and skips a wasted retry LLM call.
    const claimedReminder = REMINDER_CLAIM_RE.test(reply);
    const isOfferingAction = OFFER_LANGUAGE_RE.test(reply);
    const calledReminder = mainToolCalls.some((t) => t.startsWith("reminder_"));
    if (claimedReminder && !calledReminder && !isOfferingAction && enabled.has("reminders")) {
      console.warn(
        `[telegram-chat] hallucination caught — claimed reminder without calling tool. Retrying with forced tool call.`,
      );
      try {
        const retry = await generateText({
          model: openrouter.chat(CHAT_MODEL),
          system:
            systemPrompt +
            "\n\nYou MUST call reminder_create EXACTLY ONCE this turn for the single reminder the user just asked for. The previous attempt confirmed without actually calling the tool. Do NOT loop or create duplicates — one reminder_create call, then a short one-line confirmation.",
          // Retry with ONLY the current user message. Stale conversation
          // history contains prior hallucinated "Done! I've set..." replies
          // that make Haiku think the reminder is already there, so it
          // refuses to call the tool again. Latest message only, clean slate.
          messages: [{ role: "user", content: userText }],
          tools: toolBundle,
          // stopWhen: 1 truly caps at one step (one model call, up to one
          // tool call, stop). Anything higher lets Haiku loop reminder_create
          // even with toolChoice:required — seen creating 2-5 dupes.
          // The retry.text will be empty (no summary step); we fall back to
          // the original main-call reply text below, which usually already
          // says "Done, set for X" — now truthful since the retry actually
          // persisted it.
          stopWhen: stepCountIs(1),
          toolChoice: "required",
          providerOptions: { openai: { parallelToolCalls: false } },
        });
        const retryCalls: string[] = [];
        for (const step of retry.steps ?? []) {
          for (const call of step.toolCalls ?? []) {
            if (call?.toolName) retryCalls.push(call.toolName);
          }
        }
        console.log(
          `[telegram-chat] retry-forced tools=[${retryCalls.join(",")}] reply-len=${retry.text.trim().length}`,
        );
        if (retryCalls.some((t) => t.startsWith("reminder_"))) {
          reply = retry.text.trim() || reply;
          mainToolCalls = retryCalls;
        } else {
          // Retry also failed to call the tool — tell the user honestly.
          reply =
            "I couldn't get the reminder saved just now — something on my end. Please tell me the reminder again ('remind me to X at Y') and I'll try once more.";
        }
      } catch (err) {
        console.error("[telegram-chat] forced-retry threw:", err);
        reply =
          "I couldn't get the reminder saved just now — please try again in a moment.";
      }
    }

    // Thin-reply-after-work fallback: LLM did real tool work but didn't
    // produce a summary (e.g. hit STEP_CAP mid-chain, or returned a bare
    // "✅"). Build a deterministic factual line from what actually ran so
    // the user sees something meaningful. Real bug: bulk "delete all
    // reminders" ran 7 deletes then stopped with reply="✅", leaving the
    // user thinking nothing happened. Delegated to buildThinReplySummary
    // (exported for unit tests) so the logic doesn't drift.
    if (reply.trim().length < 15 && mainToolCalls.length > 0) {
      const summarised = buildThinReplySummary(mainToolCalls, bulkCancelled, reply);
      if (summarised) {
        reply = summarised;
        console.warn(
          `[telegram-chat] thin-reply after work — replaced with factual summary: "${reply}"`,
        );
      }
    }

    // Empty-reply recovery (pre-existing bug): Haiku returns empty text when
    // the conversation history has prior refusal/fallback turns and pattern-
    // matches. Retry with clean history + tools intact.
    if (!reply && mainToolCalls.length === 0) {
      console.warn(`[telegram-chat] empty reply — retrying clean-history`);
      try {
        const retry = await generateText({
          model: openrouter.chat(CHAT_MODEL),
          system:
            systemPrompt +
            "\n\nReply warmly and briefly. Never return empty text. If they ask you to do something a tool can do, CALL THE TOOL — don't say you can't.",
          messages: [{ role: "user", content: userText }],
          tools: toolBundle,
          stopWhen: stepCountIs(STEP_CAP),
          providerOptions: { openai: { parallelToolCalls: false } },
        });
        reply = retry.text.trim();
        const retryTools: string[] = [];
        for (const step of retry.steps ?? []) {
          for (const call of step.toolCalls ?? []) if (call?.toolName) retryTools.push(call.toolName);
        }
        console.log(`[telegram-chat] retry reply-len=${reply.length} tools=[${retryTools.join(",")}]`);
      } catch (err) {
        console.error("[telegram-chat] retry threw:", err);
      }
    }
    if (!reply) {
      reply = mainToolCalls.length
        ? `I called ${mainToolCalls.length} tool(s) but got tangled up before I could summarise. Try naming the site or step you want me to try.`
        : `Hey! 👋 I got your message. Try asking me something concrete like "remind me to call mum at 8pm" or "search flights London to Delhi Friday".`;
      console.warn(`[telegram-chat] final fallback fired (toolCalls=${mainToolCalls.length})`);
    }
  } catch (err) {
    console.error("[telegram-chat] generateText threw:", err);
    return "Something broke on my end. Try again in a moment.";
  }

  if (reply.length > TELEGRAM_MAX_CHARS) {
    reply = reply.slice(0, TELEGRAM_MAX_CHARS) + "\n\n(truncated)";
  }
  await appendMessage(convId, "assistant", reply);
  return reply;
}
