// Adapter — wires the vendored nova-reminders skill into paperloft-assist.
//
// Nova is host-agnostic: it needs a Prisma client, a "who's the user" string,
// LLM callbacks for prescription extraction, and delivery callbacks for
// firing reminders. This file provides all of that:
//
//   - Prisma: our existing shared client (src/lib/db.ts).
//   - userId: the signed-in user's email (paperloft-assist identifies users
//     by JWT email; nova stores it verbatim in Reminder.userId).
//   - onFire: routes via WhatsApp (real, wasenderapi) or Telegram (stub).
//   - saveUserFile: writes to /data/users/{email}/prescriptions/ (volume-backed).
//   - LLM: OpenRouter multimodal chat for vision + text extraction of prescriptions.

import { promises as fs } from "node:fs";
import path from "node:path";
import { generateText } from "ai";

import { prisma } from "./db";
import { openrouter, CHAT_MODEL } from "./openrouter";
import { sendWhatsApp } from "./wasender";
import { sendTelegramToChatId } from "./telegram-bot";
import { getIntegration } from "./integrations";
import { appendMessage } from "./chat";
import type { SkillContext } from "./skills/nova-reminders/context";
import type { MessageEnvelope } from "./skills/nova-reminders/types";
import { EXTRACTOR_SYSTEM_PROMPT } from "./skills/nova-reminders/prescription/extract";

const USERFILES_ROOT = process.env.USERFILES_ROOT || "/data/users";

/** Build a nova-reminders SkillContext for the acting user. */
export function makeReminderCtx(userEmail: string): SkillContext {
  return {
    // Nova's schema doesn't know about our PrismaClient type identity — we
    // cast because our prisma instance is a superset.
    prisma: prisma as unknown as SkillContext["prisma"],
    userId: userEmail,
    callbacks: {
      onFire: (env) => deliverEnvelope(env),
      saveUserFile: async (userId, kind, fileName, bytes) => {
        const safeName = fileName.replace(/[^\w.\- ]/g, "_");
        const dir = path.join(USERFILES_ROOT, encodeURIComponent(userId), kind);
        await fs.mkdir(dir, { recursive: true });
        const abs = path.join(dir, `${Date.now()}-${safeName}`);
        await fs.writeFile(abs, bytes);
        return abs;
      },
      purgeUserFile: async (abs) => {
        await fs.unlink(abs).catch(() => undefined);
      },
    },
    llm: {
      visionExtract: async ({ imagePath, pdfPath }) => {
        const filePath = imagePath ?? pdfPath;
        if (!filePath) throw new Error("visionExtract needs imagePath or pdfPath");
        const bytes = await fs.readFile(filePath);
        const mimeType = filePath.endsWith(".pdf") ? "application/pdf" : "image/png";
        const { text } = await generateText({
          model: openrouter.chat(CHAT_MODEL),
          system: EXTRACTOR_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the prescription structure as JSON per the schema." },
                { type: "file", data: bytes, mediaType: mimeType },
              ],
            },
          ],
        });
        return text;
      },
      textExtract: async ({ text }) => {
        const { text: reply } = await generateText({
          model: openrouter.chat(CHAT_MODEL),
          system: EXTRACTOR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        });
        return reply;
      },
    },
  };
}

// ---- Delivery ------------------------------------------------------------

async function deliverEnvelope(env: MessageEnvelope): Promise<void> {
  // WhatsApp — real. Look up the number from UserChannelPref first, then
  // fall back to the older Integration row (legacy path).
  if (env.channels.includes("whatsapp")) {
    const number = await resolveWhatsappNumber(env.userId);
    if (!number) {
      throw new Error(
        `No WhatsApp number configured for ${env.userId}. ` +
          "Save it via channel_prefs_update or the Integration row.",
      );
    }
    const buttonLine =
      env.buttons.length > 0
        ? "\n\n" + env.buttons.map((b) => `- ${b.label} (reply "${b.id}")`).join("\n")
        : "";
    const fullText = env.text + buttonLine;
    const send = await sendWhatsApp(number, fullText);
    if (!send.ok) throw new Error(`sendWhatsApp: ${send.reason || "unknown"}`);
    // Append to the WhatsApp conversation history so that when the user
    // later replies with an ack, the LLM turn sees the fired reminder
    // in context and can call reminder_ack on the right instance. The
    // convId scheme matches whatsapp-chat.ts. Only append if the conv
    // already exists — no point creating one for users who never chat.
    const convId = `wa_${number.replace(/[^0-9+]/g, "")}`;
    const conv = await prisma.conversation
      .findUnique({ where: { id: convId }, select: { id: true } })
      .catch(() => null);
    if (conv) {
      await appendMessage(convId, "assistant", fullText).catch((e) =>
        console.warn(`[reminders-adapter] failed to log fire to ${convId}:`, e),
      );
    }
    return;
  }

  // Telegram — send via @PaperloftAssistantBot to the user's linked chatId.
  // Ack buttons are appended as text ("reply 'taken'" style) rather than
  // Telegram inline keyboards to match the WhatsApp path — the webhook
  // routes plain-text acks through the same reminder_ack tool.
  if (env.channels.includes("telegram")) {
    const chatId = await resolveTelegramChatId(env.userId);
    if (!chatId) {
      throw new Error(
        `No Telegram chatId configured for ${env.userId}. ` +
          "Sign in via the Telegram Login Widget or link the bot from Settings.",
      );
    }
    const buttonLine =
      env.buttons.length > 0
        ? "\n\n" + env.buttons.map((b) => `- ${b.label} (reply "${b.id}")`).join("\n")
        : "";
    const fullText = env.text + buttonLine;
    const send = await sendTelegramToChatId(chatId, fullText);
    if (!send.ok) throw new Error(`sendTelegramToChatId: ${send.reason || "unknown"}`);
    // Log the fire into the Telegram conversation so a follow-up ack reply
    // has the same in-context lookup that WhatsApp has via wa_ convId.
    const convId = `tg_${chatId}`;
    const conv = await prisma.conversation
      .findUnique({ where: { id: convId }, select: { id: true } })
      .catch(() => null);
    if (conv) {
      await appendMessage(convId, "assistant", fullText).catch((e) =>
        console.warn(`[reminders-adapter] failed to log fire to ${convId}:`, e),
      );
    }
    return;
  }
}

async function resolveTelegramChatId(userEmail: string): Promise<string | null> {
  const pref = await prisma.userChannelPref.findUnique({
    where: { userId: userEmail },
    select: { telegramChatId: true },
  });
  if (pref?.telegramChatId) return pref.telegramChatId;
  // Fallback: look up via the telegram_links table (populated on OAuth sign-in).
  const link = await prisma.telegramLink.findUnique({
    where: { userEmail },
    select: { chatId: true },
  });
  return link?.chatId ?? null;
}

async function resolveWhatsappNumber(userEmail: string): Promise<string | null> {
  const pref = await prisma.userChannelPref.findUnique({
    where: { userId: userEmail },
    select: { whatsappNumber: true },
  });
  if (pref?.whatsappNumber) return pref.whatsappNumber;
  const legacy = await getIntegration(userEmail, "whatsapp");
  return legacy?.phone ?? null;
}
