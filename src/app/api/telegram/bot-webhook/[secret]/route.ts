// Telegram bot webhook for the Paperloft Assist sign-in bot.
//
// URL: /api/telegram/bot-webhook/<TELEGRAM_WEBHOOK_SECRET>
//
// Two incoming events matter:
//
//   1. `/start` — user opened a fresh DM. We reply with a `request_contact`
//      keyboard button. Only the user's real Telegram-account phone number
//      can come back through that button (Telegram enforces this).
//
//   2. `message.contact` — user tapped Share. Telegram sends the phone number
//      alongside chat/from info. We store the mapping in TelegramPhoneMap so
//      /api/auth/otp/send (telegram) can find their chatId later.

import { NextResponse } from "next/server";
import { sendTelegramToChatId } from "@/lib/telegram-bot";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

interface TgContact {
  phone_number: string;
  user_id?: number;
  first_name?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  contact?: TgContact;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const API = "https://api.telegram.org/bot";

async function sendWithKeyboard(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }),
  }).catch(() => undefined);
}

async function ackAndClearKeyboard(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { remove_keyboard: true },
    }),
  }).catch(() => undefined);
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
  if (!msg) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);

  // --- Share Contact flow ------------------------------------------------
  if (msg.contact?.phone_number) {
    // Telegram may or may not include the leading "+" — normalise to E.164.
    const raw = msg.contact.phone_number.trim();
    const phone = raw.startsWith("+") ? raw : `+${raw}`;
    await prisma.telegramPhoneMap
      .upsert({
        where: { phone },
        create: {
          phone,
          chatId,
          firstName: msg.contact.first_name ?? msg.from?.first_name ?? null,
          username: msg.from?.username ?? null,
        },
        update: {
          chatId,
          firstName: msg.contact.first_name ?? msg.from?.first_name ?? null,
          username: msg.from?.username ?? null,
        },
      })
      .catch(() => undefined);
    await ackAndClearKeyboard(
      chatId,
      `✅ Linked ${phone} to your Telegram.\n\nGo back to paperloft.regiq.in/signin, pick the Telegram tab, enter ${phone}, and hit "Send code".`,
    );
    return NextResponse.json({ ok: true });
  }

  // --- /start ------------------------------------------------------------
  if (msg.text?.startsWith("/start")) {
    await sendWithKeyboard(
      chatId,
      "Welcome to Paperloft Assist.\n\nTap the button below to share your phone number so I can send you sign-in codes and reminders.",
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
