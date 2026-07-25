// Telegram bot webhook for @PaperloftAssistantBot.
//
// URL: /api/telegram/bot-webhook/<TELEGRAM_WEBHOOK_SECRET>
//
// Handles:
//
//   1. `/start <nonce>` — deep-link from Settings → Connect Telegram. Mark
//      the sender's chat_id linked to that user's email, reply "✅ Linked".
//
//   2. `/start` (no arg / with `welcome`) — user either found the bot
//      organically or hit the sign-in deep link. If the chat is already
//      linked, send the welcome DM the sign-in flow couldn't (bot-chat
//      privacy blocks bot-initiated DMs until the user messages the bot).
//      Otherwise send a "sign in first" nudge.
//
//   3. Plain text messages — route through handleTelegramMessage.
//
//   4. Voice notes, photos, PDFs — download from Telegram, run through
//      transcribe/describe/summarise, then hand the resulting text to
//      handleTelegramMessage as if the user had typed it.
//
//   5. Word docs (.doc / .docx) — friendly "save as PDF for now" reply;
//      no npm parser wired yet.

import { NextResponse } from "next/server";
import { sendTelegramToChatId } from "@/lib/telegram-bot";
import { prisma } from "@/lib/db";
import { handleTelegramMessage } from "@/lib/telegram-chat";
import {
  transcribeVoice,
  describeImage,
  summarisePdf,
  isPdf,
  isImage,
  isWordDoc,
  type TelegramFileRef,
} from "@/lib/telegram-media";

export const runtime = "nodejs";

interface TgVoice {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  duration: number;
}

interface TgAudio {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  duration: number;
}

interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TgDocument {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  voice?: TgVoice;
  audio?: TgAudio;
  photo?: TgPhotoSize[];
  document?: TgDocument;
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
  if (!msg) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);

  // ---- /start handling (text-only) ----------------------------------------
  if (msg.text?.trim().startsWith("/start")) {
    const text = msg.text.trim();
    const parts = text.split(/\s+/);
    const nonce = parts[1] && parts[1] !== "welcome" ? parts[1] : undefined;
    if (nonce) {
      await handleLinkNonce(chatId, nonce, msg).catch((err) =>
        console.error("[tg-webhook] handleLinkNonce threw:", err),
      );
    } else {
      const link = await prisma.telegramLink
        .findFirst({ where: { chatId } })
        .catch(() => null);
      if (link) {
        const firstName = link.firstName ?? msg.from?.first_name ?? "there";
        const welcome =
          `👋 Hi ${firstName}! You're all set up.\n\n` +
          `I'm your Paperloft Assistant. You can chat with me here on Telegram OR on paperloft.uk — same brain, same memory.\n\n` +
          `Try one of these to get started:\n\n` +
          `• "Remind me to call mum at 8pm"\n` +
          `• "Every Monday at 9am, remind me to take the bins out"\n` +
          `• Send a voice note, a photo, or a PDF and I'll read it\n\n` +
          `Or just tell me what you want done.`;
        await sendTelegramToChatId(chatId, welcome).catch(() => undefined);
      } else {
        await sendTelegramToChatId(
          chatId,
          "👋 This is the Paperloft Assist bot.\n\nYou're not signed in yet. Open https://paperloft.uk/signin and tap 'Log in with Telegram' first, then come back here.",
        ).catch(() => undefined);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Text messages ------------------------------------------------------
  if (msg.text) {
    routeToChat(chatId, msg.text);
    return NextResponse.json({ ok: true });
  }

  // ---- Media messages -----------------------------------------------------
  //
  // All media handlers are fire-and-forget: we ack the webhook immediately
  // so Telegram doesn't retry (which would double-process the file). Errors
  // in the media pipeline are reported back to the user as a Telegram DM.

  if (msg.voice || msg.audio) {
    const ref = toRef(msg.voice ?? msg.audio!);
    handleVoice(chatId, ref).catch((err) => {
      console.error("[tg-webhook] handleVoice threw:", err);
      sendTelegramToChatId(
        chatId,
        "Sorry — I couldn't process that voice note. Could you try typing it?",
      ).catch(() => undefined);
    });
    return NextResponse.json({ ok: true });
  }

  if (msg.photo && msg.photo.length > 0) {
    // Telegram sends multiple resolutions; pick the largest for best OCR.
    const largest = [...msg.photo].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    const ref: TelegramFileRef = { file_id: largest.file_id, file_size: largest.file_size };
    handlePhoto(chatId, ref, msg.caption).catch((err) => {
      console.error("[tg-webhook] handlePhoto threw:", err);
      sendTelegramToChatId(
        chatId,
        "Sorry — I couldn't process that photo. Could you try again?",
      ).catch(() => undefined);
    });
    return NextResponse.json({ ok: true });
  }

  if (msg.document) {
    const doc = msg.document;
    if (isWordDoc(doc.mime_type, doc.file_name)) {
      sendTelegramToChatId(
        chatId,
        "📄 Word docs aren't supported yet — save it as a PDF and send that. I read PDFs, images, and voice notes.",
      ).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (isPdf(doc.mime_type, doc.file_name)) {
      handleDocumentPdf(chatId, toRef(doc), msg.caption).catch((err) => {
        console.error("[tg-webhook] handleDocumentPdf threw:", err);
        sendTelegramToChatId(
          chatId,
          "Sorry — I couldn't read that PDF. Could you try re-sending it?",
        ).catch(() => undefined);
      });
      return NextResponse.json({ ok: true });
    }
    if (isImage(doc.mime_type, doc.file_name)) {
      // User attached an image as a "file" instead of a photo (keeps original
      // resolution). Same code path as photo, different arrival shape.
      handlePhoto(chatId, toRef(doc), msg.caption).catch((err) => {
        console.error("[tg-webhook] handlePhoto (as doc) threw:", err);
        sendTelegramToChatId(
          chatId,
          "Sorry — I couldn't process that image. Could you try again?",
        ).catch(() => undefined);
      });
      return NextResponse.json({ ok: true });
    }
    sendTelegramToChatId(
      chatId,
      `📎 I got "${doc.file_name ?? "the file"}", but I can only read PDFs, images, and voice notes for now. Word support is on the way.`,
    ).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  // Nothing we know how to handle — silent ack (avoids replying to stickers,
  // location pings, group service events, etc.).
  return NextResponse.json({ ok: true });
}

function toRef(x: {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}): TelegramFileRef {
  return {
    file_id: x.file_id,
    file_size: x.file_size,
    mime_type: x.mime_type,
    file_name: x.file_name,
  };
}

// Route plain text through the chat handler and DM the reply back. Errors
// surface as a generic reply so the user is never left silent.
function routeToChat(chatId: string, text: string) {
  handleTelegramMessage(chatId, text)
    .then((reply) => sendTelegramToChatId(chatId, reply))
    .catch((err) => {
      console.error("[tg-webhook] chat handler threw:", err);
      return sendTelegramToChatId(chatId, "Something broke. Try again in a moment.");
    });
}

async function handleVoice(chatId: string, ref: TelegramFileRef) {
  const transcript = await transcribeVoice(ref);
  // Wrap so the LLM knows the source. Prevents "you said X" style
  // hallucination when the transcript is short or ambiguous.
  const wrapped = `[voice note] ${transcript}`;
  routeToChat(chatId, wrapped);
}

async function handlePhoto(
  chatId: string,
  ref: TelegramFileRef,
  caption?: string,
) {
  const description = await describeImage(ref, caption);
  const captionPart = caption?.trim() ? ` (caption: "${caption.trim()}")` : "";
  const wrapped =
    `[user sent a photo${captionPart} — here's what I saw]\n\n${description}` +
    (caption?.trim()
      ? ""
      : "\n\n[Please respond to the user based on the photo and let them know if you need more context.]");
  routeToChat(chatId, wrapped);
}

async function handleDocumentPdf(
  chatId: string,
  ref: TelegramFileRef,
  caption?: string,
) {
  const summary = await summarisePdf(ref, caption);
  const captionPart = caption?.trim() ? ` (caption: "${caption.trim()}")` : "";
  const wrapped =
    `[user sent a PDF${captionPart} — here's a summary]\n\n${summary}` +
    (caption?.trim()
      ? ""
      : "\n\n[Please respond helpfully. Ask what they want you to do with it if it's not obvious.]");
  routeToChat(chatId, wrapped);
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
