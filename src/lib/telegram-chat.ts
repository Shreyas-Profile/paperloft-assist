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
import { makeUserByoSkills, listByoToolNames } from "./user-skills";

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

  // BYO skills — same wiring as the web /chat route. Fetch the tool
  // factory + the allowed-name set in parallel and merge both into the
  // filter. Namespacing (`byo_<slug>__<tool>`) is done inside
  // makeUserByoSkills so BYO tool names can never collide with built-ins.
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
          ...byoTools,
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
    if (!reply && toolCalls.length === 0) {
      // Haiku returns empty when the conversation history contains prior
      // "I couldn't come up with anything useful" assistant turns —
      // pattern-matches and mimics. Retry with ONLY the current user
      // message, no history, minimal system.
      console.warn(`[telegram-chat] empty reply — retrying clean`);
      try {
        const retry = await generateText({
          model: openrouter.chat(CHAT_MODEL),
          system: "You are Paperloft Assistant, a friendly AI. Reply warmly and briefly. Never return empty text. If greeted, greet back and offer one concrete example (reminders, browsing, docs).",
          messages: [{ role: "user", content: userText }],
        });
        reply = retry.text.trim();
        console.log(`[telegram-chat] retry reply-len=${reply.length}`);
      } catch (err) {
        console.error("[telegram-chat] retry threw:", err);
      }
    }
    if (!reply) {
      reply = toolCalls.length
        ? `I called ${toolCalls.length} tool(s) but got tangled up before I could summarise. Try naming the site or step you want me to try.`
        : `Hey! 👋 I got your message. Try asking me something concrete like "remind me to call mum at 8pm" or "search flights London to Delhi Friday".`;
      console.warn(`[telegram-chat] final fallback fired (toolCalls=${toolCalls.length})`);
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
