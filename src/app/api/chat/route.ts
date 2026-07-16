// POST /api/chat — streaming endpoint.
//
// Flow per request:
//   1. Verify session (email required).
//   2. If no conversationId in the body → create a new Conversation row, using the
//      first user message as the title.
//   3. Extract the *last* user message from the body's UI messages, persist it.
//   4. Load the last N messages of that conversation (context window cap).
//   5. Stream from OpenRouter.
//   6. In onFinish, persist the assistant's full reply.
//   7. Send the UIMessageStream back with x-conversation-id set so the client
//      knows what to navigate to on first send.

import { NextResponse } from "next/server";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { auth } from "@/lib/auth";
import { appendMessage, createConversation } from "@/lib/chat";
import { CHAT_MODEL, SYSTEM_PROMPT, openrouter } from "@/lib/openrouter";
import { skills, makeUserScopedSkills } from "@/lib/skills";
import { makeLinkedInSkill } from "@/lib/skills/linkedin-post";
import { listEnabledSkills } from "@/lib/enabled-skills";
import { toolsForEnabledSkills } from "@/lib/skill-tool-map";
import { createReminderSkill } from "@/lib/skills/nova-reminders";
import { makeReminderCtx } from "@/lib/reminders-adapter";

export const runtime = "nodejs"; // Prisma + better-sqlite3 need Node runtime, not Edge.
export const maxDuration = 60;

function extractText(message: UIMessage): string {
  // UIMessage.parts is an array; grab the concatenated text of any text parts.
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Keep only tools whose names are in the allowlist. Used to hide tools for
// skills the user hasn't toggled on. Preserves the tool objects unchanged —
// each still carries its own schema, description, execute fn, etc.
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

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    conversationId?: string;
    messages: UIMessage[];
  };
  const uiMessages = body.messages ?? [];
  const lastMessage = uiMessages[uiMessages.length - 1];
  if (!lastMessage) {
    return NextResponse.json({ error: "no messages" }, { status: 400 });
  }
  const lastUserMessage = [...uiMessages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return NextResponse.json({ error: "no user message" }, { status: 400 });
  }
  const lastUserText = extractText(lastUserMessage);

  // Ensure we have a conversation to attach messages to.
  let conversationId = body.conversationId;
  if (!conversationId) {
    const created = await createConversation(email, lastUserText);
    conversationId = created.id;
  }

  // Persist the user message ONLY on the initial send of a turn — i.e., when
  // the last message in the client's state is a fresh user message. On
  // auto-resends triggered by client-side tool results, the last message is
  // an assistant tool-call or a tool result, and we must not re-persist.
  if (lastMessage.role === "user") {
    await appendMessage(conversationId, "user", lastUserText);
  }

  // Send the client's full UIMessage stream to the LLM. This includes prior
  // assistant tool calls and their results, which is critical for the LLM to
  // "remember" what it already did in this turn (e.g., it already opened a
  // workit tab — don't open another). We can't rebuild that from the DB
  // because tool state isn't persisted.
  // Build the nova-reminders skill per-request so it captures the user's
  // email. Its 13 tools flow into the same filter as everything else.
  const reminderSkill = createReminderSkill(makeReminderCtx(email));
  const enabled = await listEnabledSkills(email);
  const allowed = toolsForEnabledSkills(enabled);

  // Today's date/time. Without this, models like DeepSeek reply "what's today's
  // date?" whenever the user says "tomorrow", "tonight", "next Monday" etc.
  const now = new Date();
  const timeContext =
    `Current UTC time: ${now.toISOString()} (${now.toUTCString()}). ` +
    `When the user says relative times ("tomorrow 9am", "in 2 hours", "tonight 8pm"), ` +
    `resolve them against this timestamp and convert to ISO 8601 UTC before calling any tool.`;

  const result = streamText({
    // .chat() forces the classic /v1/chat/completions endpoint. Without it,
    // @ai-sdk/openai defaults to OpenAI's newer /v1/responses API, which
    // OpenRouter doesn't implement for most models (including DeepSeek).
    model: openrouter.chat(CHAT_MODEL),
    system:
      timeContext + "\n\n" +
      SYSTEM_PROMPT +
      (enabled.has("reminders") ? "\n\n" + reminderSkill.systemPrompt : ""),
    messages: await convertToModelMessages(uiMessages),
    // Skills the LLM can invoke via tool-calling. The full tool set is
    // filtered by which skills the user has toggled on in /skills — a
    // disabled skill's tools are simply not passed to the model, so it
    // can't call them. linkedin_post is legacy per-user code, kept until
    // it becomes a real toggleable skill.
    tools: filterTools(
      {
        ...skills,
        ...makeUserScopedSkills(email),
        ...reminderSkill.tools,
        linkedin_post: makeLinkedInSkill(email),
      },
      allowed,
    ),
    // Cap per-server-round steps. Bumped from 5 → 25 because hosted browser
    // workflows (navigate → snapshot → click through consent → snapshot →
    // type search → snapshot → click → read) legitimately need >5 steps;
    // the old cap made the model return empty text mid-flow. Full loop is
    // still bounded by the client's sendAutomaticallyWhen guard (15
    // assistant turns total).
    stopWhen: stepCountIs(25),
    // Disable parallel tool calls — the browser tools are stateful (opening
    // a tab affects the next snapshot). Without this, the LLM cheerfully
    // issues 5 identical browser_new_tab calls in one step, spawning 5 tabs.
    providerOptions: {
      openai: {
        parallelToolCalls: false,
      },
    },
    onFinish: async ({ text }) => {
      // Only the final assistant text is persisted. Tool calls and their
      // results are transient — they're visible during streaming but not
      // stored, so refreshing shows the answer, not the plumbing.
      if (text) await appendMessage(conversationId!, "assistant", text);
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "x-conversation-id": conversationId,
    },
  });
}
