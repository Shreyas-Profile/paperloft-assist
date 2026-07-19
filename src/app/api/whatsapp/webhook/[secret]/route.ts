// Inbound WhatsApp webhook — POSTed by wasenderapi when a message arrives
// on our connected session. URL:
//   https://paperloft.uk/api/whatsapp/webhook/<WHATSAPP_WEBHOOK_SECRET>
//
// Handles:
//   1. plain text — routes through handleWhatsAppMessage() → LLM chat with
//      all the user's toggled skills (reminders, browser, docs, tor, BYO).
//      Reply is sent back via wasenderapi.
//   2. images / documents — treated as prescription intake. Downloaded to
//      /data/users/<email>/prescriptions/, then the LLM is nudged to call
//      prescription_ingest with the file path.
//
// Auth: secret in the URL path (fixed, so wasenderapi can be configured
// with a static webhook URL). We return 200 for any unauthorised hit so
// wasenderapi doesn't retry — matching the pattern used by the Telegram
// webhook here already.

import { NextResponse } from "next/server";
import { handleWhatsAppMessage } from "@/lib/whatsapp-chat";
import { sendWhatsApp } from "@/lib/wasender";

export const runtime = "nodejs";
export const maxDuration = 60;

// The wasenderapi payload has changed shape a few times across versions —
// keep this parser loose and log the raw body for the first few requests so
// we can pin the exact fields we're getting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawUpdate = any;

interface ParsedMessage {
  fromPhone: string;       // +919876543210 (E.164, leading +)
  fromMe: boolean;         // true = we sent it (ignore, don't loop)
  text: string;            // conversation body (may be "" for media-only messages)
  mediaUrl?: string;       // signed URL to fetch attachment
  mediaMime?: string;      // e.g. image/jpeg, application/pdf
  mediaKind?: "image" | "document" | "audio";
  messageId?: string;      // wasender's own id, for de-duping if we care
}

function parse(update: RawUpdate): ParsedMessage | null {
  // Common wasenderapi shape: { event, data: { messages: [{key, message, ...}] } }
  const arr =
    update?.data?.messages ??
    update?.messages ??
    (Array.isArray(update) ? update : null);
  const raw = Array.isArray(arr) ? arr[0] : arr ?? update?.data ?? update;
  if (!raw) return null;

  // Extract sender phone. Preference order:
  //   1. key.cleanedSenderPn / key.senderPn — the plain phone digits
  //      wasenderapi extracts from the WhatsApp LID (linked identity).
  //      Present when the account uses the newer LID addressing mode.
  //   2. key.remoteJid — legacy path, only usable when it contains an
  //      actual phone (e.g. "919876543210@s.whatsapp.net"), NOT when it's
  //      an @lid opaque identifier.
  //   3. from / sender / chatId — some older payload shapes.
  const senderPnRaw: string =
    raw?.key?.cleanedSenderPn ??
    raw?.key?.senderPn ??
    "";
  const senderPnDigits = senderPnRaw.replace(/@.*/, "").replace(/[^0-9]/g, "");

  let digits = senderPnDigits;
  if (!digits) {
    const jid: string =
      raw?.key?.remoteJid ?? raw?.from ?? raw?.sender ?? raw?.chatId ?? "";
    if (jid.includes("@lid")) {
      // Opaque LID with no attached phone — we can't route to a paperloft
      // user. Log and drop; the sender needs to be seen via a channel that
      // exposes the number (usually direct DMs do).
      console.warn(`[wa-webhook] LID-only sender, no phone in payload: ${jid}`);
      return null;
    }
    digits = jid.replace(/@.*/, "").replace(/[^0-9]/g, "");
  }
  if (!digits) return null;
  const fromPhone = `+${digits}`;
  const fromMe = raw?.key?.fromMe === true || raw?.fromMe === true;

  const msg = raw?.message ?? raw?.body ?? raw;

  const text: string =
    msg?.conversation ??
    msg?.extendedTextMessage?.text ??
    msg?.text ??
    msg?.body ??
    (typeof msg === "string" ? msg : "");

  let mediaUrl: string | undefined;
  let mediaMime: string | undefined;
  let mediaKind: ParsedMessage["mediaKind"];
  if (msg?.imageMessage) {
    mediaUrl = msg.imageMessage.url ?? msg.imageMessage.fileUrl;
    mediaMime = msg.imageMessage.mimetype ?? "image/jpeg";
    mediaKind = "image";
  } else if (msg?.documentMessage) {
    mediaUrl = msg.documentMessage.url ?? msg.documentMessage.fileUrl;
    mediaMime = msg.documentMessage.mimetype ?? "application/pdf";
    mediaKind = "document";
  } else if (msg?.audioMessage) {
    mediaUrl = msg.audioMessage.url ?? msg.audioMessage.fileUrl;
    mediaMime = msg.audioMessage.mimetype ?? "audio/ogg";
    mediaKind = "audio";
  }

  return {
    fromPhone,
    fromMe,
    text: (text || "").trim(),
    mediaUrl,
    mediaMime,
    mediaKind,
    messageId: raw?.key?.id ?? raw?.id ?? raw?.messageId,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  if (secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    console.warn("[wa-webhook] bad secret hit — ignoring");
    return NextResponse.json({ ok: true });
  }
  const update = (await req.json().catch(() => null)) as RawUpdate;
  if (!update) {
    return NextResponse.json({ ok: true });
  }
  // Diagnostic log — noisy but valuable while we pin down the payload shape.
  // Trim to prevent multi-megabyte spam if wasender includes base64 media.
  const preview = JSON.stringify(update).slice(0, 500);
  console.log(`[wa-webhook] raw: ${preview}`);

  const msg = parse(update);
  if (!msg) return NextResponse.json({ ok: true });
  if (msg.fromMe) return NextResponse.json({ ok: true }); // ignore our own outbound echoes
  if (!msg.text && !msg.mediaUrl) return NextResponse.json({ ok: true });

  // Fire-and-forget so wasender doesn't retry if the LLM turn runs long.
  // 200 immediately.
  handleWhatsAppMessage({
    fromPhone: msg.fromPhone,
    text: msg.text,
    mediaUrl: msg.mediaUrl,
    mediaMime: msg.mediaMime,
    mediaKind: msg.mediaKind,
  })
    .then((reply) => {
      if (reply) sendWhatsApp(msg.fromPhone, reply);
    })
    .catch((err) => {
      console.error("[wa-webhook] handler threw:", err);
      return sendWhatsApp(
        msg.fromPhone,
        "Something broke on my end. Try again in a moment.",
      );
    });

  return NextResponse.json({ ok: true });
}
