// Telegram bot webhook for @PaperloftAssistantBot.
//
// URL: /api/telegram/bot-webhook/<TELEGRAM_WEBHOOK_SECRET>
//
// Handles TWO things:
//
//   1. `/start <nonce>` — deep-link from Settings → Connect Telegram. We look
//      up the nonce, mark the sender's chat_id linked to that user's email,
//      then reply "✅ Linked".
//
//   2. `/start` (no arg) — user found the bot organically. Reply with a
//      short intro telling them to link from the Paperloft settings page.
//
// Every other inbound message is currently ignored — future work: forward
// to the chat backend so users can talk to Paperloft over Telegram.

import { NextResponse } from "next/server";
import { sendTelegramToChatId } from "@/lib/telegram-bot";
import { prisma } from "@/lib/db";
import { handleTelegramMessage } from "@/lib/telegram-chat";

export const runtime = "nodejs";

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    // Return 200 anyway so Telegram doesn't disable the webhook on bad hits.
    return NextResponse.json({ ok: true });
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const nonce = parts[1];
    if (nonce) {
      await handleLinkNonce(chatId, nonce, msg).catch((err) =>
        console.error("[tg-webhook] handleLinkNonce threw:", err),
      );
    } else {
      await sendTelegramToChatId(
        chatId,
        "👋 This is the Paperloft Assist bot.\n\nTo connect this Telegram to your Paperloft account, open Settings → Connect Telegram on paperloft.uk and follow the button.\n\nAlready connected? Just ask me anything.",
      ).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  }

  // Any other text → route to the AI. Fire-and-forget so we return 200 to
  // Telegram immediately (they retry on non-200 within a short window,
  // which would duplicate the reply).
  handleTelegramMessage(chatId, text)
    .then((reply) => sendTelegramToChatId(chatId, reply))
    .catch((err) => {
      console.error("[tg-webhook] chat handler threw:", err);
      return sendTelegramToChatId(chatId, "Something broke. Try again in a moment.");
    });

  return NextResponse.json({ ok: true });
}

async function handleLinkNonce(chatId: string, nonce: string, msg: TgMessage) {
  const row = await prisma.telegramLinkNonce.findUnique({ where: { nonce } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    await sendTelegramToChatId(
      chatId,
      "❌ That link expired. Go back to paperloft.uk → Settings → Connect Telegram and click the button again.",
    ).catch(() => undefined);
    return;
  }
  // Delete any other rows still holding this chatId under a different
  // email — a Telegram chat should map to exactly one Paperloft account.
  // Without this, a user who re-links from a different account leaves the
  // old row behind and the chat handler (which reads by chatId) can pick
  // the wrong email — that's the bug Pawan hit that made BYO tools invisible.
  await prisma.telegramLink.deleteMany({
    where: { chatId, userEmail: { not: row.userEmail } },
  });
  await prisma.telegramLink.upsert({
    where: { userEmail: row.userEmail },
    create: {
      userEmail: row.userEmail,
      chatId,
      username: msg.from?.username ?? null,
      firstName: msg.from?.first_name ?? null,
    },
    update: {
      chatId,
      username: msg.from?.username ?? null,
      firstName: msg.from?.first_name ?? null,
    },
  });
  // Mirror the chatId onto UserChannelPref — the nova-reminders scheduler
  // reads *that* row when picking a delivery channel. Without this the link
  // is visible in Settings but reminders keep firing to WhatsApp only.
  await prisma.userChannelPref
    .upsert({
      where: { userId: row.userEmail },
      create: {
        userId: row.userEmail,
        telegramChatId: chatId,
        defaultChannel: "telegram",
      },
      update: { telegramChatId: chatId },
    })
    .catch(() => undefined);
  await prisma.telegramLinkNonce.update({
    where: { nonce },
    data: { usedAt: new Date() },
  });
  await sendTelegramToChatId(
    chatId,
    `✅ Linked to ${row.userEmail}.\n\nYou're all set. Notifications and reminders from Paperloft will land in this chat.`,
  ).catch(() => undefined);
}
