// Handle a plain-text message from a linked Telegram user.
//
// Same LLM pipeline as web /chat — resolves chatId → userEmail via
// telegram_links, loads last N messages of a dedicated Telegram conversation,
// calls the LLM with the user's enabled skills wired as tools, persists both
// sides, returns the reply text so the webhook can DM it back.
//
// Tools are gated by the user's /skills toggles (same as web). Multi-step
// tool loops are capped by stopWhen so we don't hang the webhook.

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

const HISTORY_LIMIT = 20;
const TELEGRAM_MAX_CHARS = 4000; // Telegram's cap is 4096; leave headroom.

const CONNECT_HINT =
  "You're not linked to a Paperloft account yet.\n\n" +
  "Open https://paperloft.uk/settings and hit 'Connect Telegram bot' to link this chat to your account. Then message me here and I'll reply as your assistant.";

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
  const link = await prisma.telegramLink.findFirst({ where: { chatId } });
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

  const history = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  const messages: ModelMessage[] = history.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const reminderSkill = createReminderSkill(makeReminderCtx(email));
  const enabled = await listEnabledSkills(email);
  const allowed = toolsForEnabledSkills(enabled);
  const now = new Date();
  const timeContext =
    `Current UTC time: ${now.toISOString()} (${now.toUTCString()}). ` +
    `When the user says relative times ("tomorrow 9am", "in 2 hours", "tonight 8pm"), ` +
    `resolve them against this timestamp and convert to ISO 8601 UTC before calling any tool.`;

  let reply: string;
  try {
    const result = await generateText({
      model: openrouter.chat(CHAT_MODEL),
      system:
        timeContext + "\n\n" +
        SYSTEM_PROMPT +
        (enabled.has("reminders") ? "\n\n" + reminderSkill.systemPrompt : "") +
        "\n\nYou are speaking to the user on Telegram. Keep replies short and readable on a phone. Telegram supports basic markdown (**bold**, `code`) but not headings or tables." +
        "\n\nWhen you need to interact with a live web page (search flights, check prices, click through anything JS-rendered), call `browser_navigate` first, then `browser_snapshot`, then act on the uids. Do NOT tell the user you 'tried a search' unless you actually called those tools." +
        "\n\nSite hints for flights: our browser runs from a Hetzner IP in Germany, so google.com puts a cookie consent wall in front of Google Flights. Prefer `https://www.skyscanner.net/`, `https://www.kayak.co.uk/flights`, or `https://www.momondo.co.uk/` — same data, no consent wall. Momondo often shows headline 'from £X' prices even in the initial HTML, so `fetch_url` on it can work as a fast fallback if the browser gets stuck.",
      messages,
      tools: filterTools(
        {
          ...skills,
          ...makeUserScopedSkills(email),
          ...reminderSkill.tools,
          linkedin_post: makeLinkedInSkill(email),
        },
        allowed,
      ),
      // 5 was the old cap and it wasn't enough — a browser workflow (new tab,
      // snapshot, click, snapshot, type, snapshot, click, read) burns ~8
      // steps easily, then the model returned empty text and users saw
      // "(no reply)". 25 gives real headroom without letting a runaway loop
      // hammer the LLM budget.
      stopWhen: stepCountIs(25),
      providerOptions: {
        openai: { parallelToolCalls: false },
      },
    });
    reply = result.text.trim();
    // Always log which tools were actually called this turn — diagnostic for
    // "did the model fabricate a success?" bugs.
    const toolCalls: string[] = [];
    for (const step of result.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        if (call?.toolName) toolCalls.push(call.toolName);
      }
    }
    console.log(`[telegram-chat] chat=${chatId} tools=[${toolCalls.join(",")}] reply-len=${reply.length}`);
    // If the model returned no text but DID call tools, don't drop them on
    // the floor with "(no reply)" — surface what actually happened.
    if (!reply) {
      const summary = toolCalls.length
        ? `I called ${toolCalls.length} tools (${[...new Set(toolCalls)].join(", ")}) but didn't have anything final to say — the flow probably got stuck partway. Try being more specific about the site or step you want me to try.`
        : "I couldn't come up with anything useful. Try rephrasing?";
      console.warn(`[telegram-chat] empty reply after ${toolCalls.length} tool calls`);
      reply = summary;
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
