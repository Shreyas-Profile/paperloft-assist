// Handle an inbound WhatsApp message. Mirrors telegram-chat.ts:
//   - resolve phone → userEmail (via UserChannelPref.whatsappNumber first,
//     then WhatsApp sign-in synthetic email as fallback)
//   - build a conversation (id = "wa_<phone>") if one doesn't exist
//   - route text through the LLM with all the user's toggled skills
//   - if an image/PDF/audio is attached, download it, save under
//     /data/users/<email>/prescriptions/, and inject a system nudge so the
//     LLM knows to call prescription_ingest on it
//
// Returns the reply text so the webhook can send it back via wasenderapi.
// Return "" (empty string) to skip sending anything.

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { promises as fs } from "node:fs";
import path from "node:path";
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
const WHATSAPP_MAX_CHARS = 3500; // WhatsApp caps around 4096 — leave headroom
const USERFILES_ROOT = process.env.USERFILES_ROOT || "/data/users";

const CONNECT_HINT =
  "You're not linked to a Paperloft account yet.\n\n" +
  "Open https://paperloft.uk/signin, sign in with your WhatsApp number, and I'll be able to talk to you here.";

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

export interface WhatsAppMessage {
  fromPhone: string; // +E164
  text: string;
  mediaUrl?: string;
  mediaMime?: string;
  mediaKind?: "image" | "document" | "audio";
}

// Ack shortcuts — match these first, before the LLM turn, so a plain
// "ack" / "done" / "taken" / "snooze 10" reply just works without the
// model needing to know instance IDs.
const ACK_PATTERNS: Array<{
  re: RegExp;
  state: "acked" | "skipped" | "snoozed";
  snoozeIndex?: number;
}> = [
  { re: /^(ack|done|taken|✅|👍|ok|okay|got it)$/i, state: "acked" },
  { re: /^(skip|skipped)$/i, state: "skipped" },
  { re: /^snooze\s+(\d+)$/i, state: "snoozed", snoozeIndex: 1 },
  { re: /^snooze$/i, state: "snoozed" }, // default 10 min
];

async function tryAckShortcut(
  userEmail: string,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim();
  let matchedState: "acked" | "skipped" | "snoozed" | null = null;
  let snoozeMinutes: number | undefined;
  for (const p of ACK_PATTERNS) {
    const m = p.re.exec(trimmed);
    if (m) {
      matchedState = p.state;
      if (p.snoozeIndex !== undefined) snoozeMinutes = Number(m[p.snoozeIndex]);
      else if (p.state === "snoozed") snoozeMinutes = 10;
      break;
    }
  }
  if (!matchedState) return null;

  // Find the most recent pending fire for this user across all their reminders.
  const instance = await prisma.reminderInstance.findFirst({
    where: { userId: userEmail, ackState: "pending" },
    orderBy: { firedAt: "desc" },
    select: { id: true, reminderId: true },
  });
  if (!instance) {
    return "No pending reminder to ack right now. Next one that fires, just reply here and I'll log it.";
  }

  const updates: {
    ackState: "acked" | "skipped" | "snoozed";
    ackAt: Date;
    ackButtonId: string;
    snoozedToInstanceId?: string;
  } = {
    ackState: matchedState,
    ackAt: new Date(),
    ackButtonId: matchedState,
  };
  // Snooze needs a child reminder-instance created for the new fire time — the
  // scheduler tick will pick it up. Rather than duplicate that logic here,
  // just mark the ack; the scheduler's re-fire path handles snoozes on its
  // next tick if the reminder is still active. For now, treat snooze as an
  // ack + let the LLM know to reschedule if the user wanted a specific offset.
  await prisma.reminderInstance.update({
    where: { id: instance.id },
    data: updates,
  });

  if (matchedState === "acked") return "✅ Logged. Nice work.";
  if (matchedState === "skipped") return "⏭️ Skipped. No worries.";
  return `⏰ Snoozed for ${snoozeMinutes ?? 10} min. (Note: snooze re-fire is on the roadmap — for now this just marks the original as acknowledged.)`;
}

/**
 * Look up the paperloft user for a given phone number via
 * UserChannelPref.whatsappNumber. Paperloft uses JWT-only sessions with no
 * persisted User table, so the channel-pref row is the single source of
 * truth for "which paperloft account owns this phone."
 *
 * The WhatsApp sign-in flow auto-creates a channel-pref row in auth.ts
 * events.signIn — if a phone signs in but never actually saves a message,
 * the pref still exists so their inbound WhatsApp lands here.
 */
async function resolveUserEmail(phone: string): Promise<string | null> {
  const pref = await prisma.userChannelPref.findFirst({
    where: { whatsappNumber: phone },
    select: { userId: true },
  });
  return pref?.userId ?? null;
}

/**
 * Download media referenced by wasenderapi URL to /data/users/<email>/<kind>/.
 * Returns the absolute path on disk. Throws on download failure — the caller
 * turns that into a user-facing "couldn't fetch your attachment" reply.
 */
async function saveMedia(
  userEmail: string,
  mediaUrl: string,
  mimeType: string,
  hintKind: WhatsAppMessage["mediaKind"],
): Promise<{ absPath: string; kind: string }> {
  // Prescriptions are the main intake; other media goes to "attachments"
  // so it isn't confused with a real prescription download later.
  const kind = hintKind === "image" || hintKind === "document" ? "prescriptions" : "attachments";
  const dir = path.join(USERFILES_ROOT, encodeURIComponent(userEmail), kind);
  await fs.mkdir(dir, { recursive: true });
  const ext = extForMime(mimeType);
  const abs = path.join(dir, `${Date.now()}${ext}`);
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`media fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(abs, buf);
  return { absPath: abs, kind };
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mp3")) return ".mp3";
  return ".bin";
}

export async function handleWhatsAppMessage(
  msg: WhatsAppMessage,
): Promise<string> {
  const email = await resolveUserEmail(msg.fromPhone);
  if (!email) return CONNECT_HINT;

  // Shortcut: plain "ack"/"done"/"snooze"/etc — ack the most recent
  // pending fire directly, don't waste an LLM turn on it. Runs BEFORE
  // history append so a stray "ack" doesn't pollute future context.
  if (msg.text && !msg.mediaUrl) {
    const shortcut = await tryAckShortcut(email, msg.text);
    if (shortcut) return shortcut;
  }

  // Every inbound WhatsApp gets its own conversation id per phone so history
  // isn't tangled with the user's web-chat threads.
  const convId = `wa_${msg.fromPhone.replace(/[^0-9+]/g, "")}`;
  const existing = await prisma.conversation.findUnique({ where: { id: convId } });
  if (!existing) {
    await prisma.conversation.create({
      data: { id: convId, userEmail: email, title: `WhatsApp · ${msg.fromPhone}` },
    });
  }

  // If media arrived, save it and construct a system-visible nudge so the
  // LLM knows it's there — cheaper than trying to smuggle bytes through the
  // conversation history.
  let mediaNote = "";
  if (msg.mediaUrl && msg.mediaMime) {
    try {
      const saved = await saveMedia(email, msg.mediaUrl, msg.mediaMime, msg.mediaKind);
      mediaNote =
        `\n\n[system: user attached a ${msg.mediaKind ?? "file"} at path ${saved.absPath}. ` +
        `If it looks like a prescription, call prescription_ingest with imagePath=<that path> ` +
        `(or pdfPath if it's a PDF). Otherwise ignore the file and continue normally.]`;
    } catch (err) {
      mediaNote = `\n\n[system: user attached a file but I couldn't download it (${(err as Error).message}). Tell them to resend.]`;
    }
  }

  const userText = (msg.text || "") + mediaNote;
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

  const surfaceNote =
    "\n\nYou are speaking to the user on WhatsApp. Keep replies short and readable on a phone. " +
    "WhatsApp supports *bold*, _italic_, ~strike~, and ```code``` but NOT markdown headings/tables. " +
    "For reminder acks, you can also expect the user to just say 'done', 'taken', 'skip', or 'snooze N' — " +
    "map those directly to reminder_ack without asking follow-up questions when the intent is obvious.";

  let reply: string;
  try {
    const result = await generateText({
      model: openrouter.chat(CHAT_MODEL),
      system:
        timeContext + "\n\n" +
        SYSTEM_PROMPT +
        (enabled.has("reminders") ? "\n\n" + reminderSkill.systemPrompt : "") +
        surfaceNote,
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
      stopWhen: stepCountIs(25),
      providerOptions: {
        openai: { parallelToolCalls: false },
      },
    });
    reply = result.text.trim();
    const toolCalls: string[] = [];
    for (const step of result.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        if (call?.toolName) toolCalls.push(call.toolName);
      }
    }
    console.log(
      `[whatsapp-chat] from=${msg.fromPhone} tools=[${toolCalls.join(",")}] reply-len=${reply.length}`,
    );
    if (!reply) {
      reply = toolCalls.length
        ? `Done — I called ${[...new Set(toolCalls)].join(", ")}.`
        : "I couldn't come up with anything useful. Try rephrasing?";
    }
  } catch (err) {
    console.error("[whatsapp-chat] generateText threw:", err);
    return "Something broke on my end. Try again in a moment.";
  }

  if (reply.length > WHATSAPP_MAX_CHARS) {
    reply = reply.slice(0, WHATSAPP_MAX_CHARS) + "\n\n(truncated)";
  }
  await appendMessage(convId, "assistant", reply);
  return reply;
}
