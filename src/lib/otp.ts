// OTP generation + delivery for WhatsApp / Telegram sign-in.
//
// 6-digit numeric codes. 10-minute TTL. Single-use.
// BOTH providers key on the user's phone number (E.164). WhatsApp delivery =
// wasenderapi. Telegram delivery = look up the user's chatId in
// TelegramPhoneMap (populated when they tap Share Contact in the bot), then
// send via Bot API. Same phone across WhatsApp + Telegram = same account.

import { randomInt } from "node:crypto";
import { prisma } from "./db";
import { sendWhatsApp } from "./wasender";
import { sendTelegramToChatId } from "./telegram-bot";

const CODE_TTL_MS = 10 * 60 * 1000;

export type OtpProvider = "whatsapp" | "telegram";

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Generate + store a fresh code. Returns the code so the caller can send it.
 * Any prior unused codes for the same (provider, phone) are invalidated.
 */
export async function createSignInCode(
  provider: OtpProvider,
  phone: string,
): Promise<string> {
  const code = newCode();
  await prisma.signInCode.updateMany({
    where: { provider, identifier: phone, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.signInCode.create({
    data: {
      provider,
      identifier: phone,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: string; needsBotStart?: true };

/**
 * Send an OTP to the user via the chosen channel. Both providers use the
 * user's phone number; Telegram needs a prior TelegramPhoneMap row (created
 * when the user taps "Share my phone number" in the bot).
 */
export async function sendOtp(
  provider: OtpProvider,
  phone: string,
  code: string,
): Promise<SendResult> {
  const body = `Your Paperloft Assist sign-in code is ${code}. It expires in 10 minutes.`;
  if (provider === "whatsapp") {
    const res = await sendWhatsApp(phone, body);
    return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "wasender failed" };
  }
  // Telegram: resolve chatId from the verified phone map.
  const map = await prisma.telegramPhoneMap.findUnique({ where: { phone } });
  if (!map) {
    return {
      ok: false,
      needsBotStart: true,
      reason:
        "We don't have your Telegram linked to this phone yet. Open @shreyasassistantbot, hit /start, then tap 'Share my phone number'. Then try again.",
    };
  }
  const res = await sendTelegramToChatId(map.chatId, body);
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "telegram failed" };
}

/**
 * Consume a code. Returns true if the (provider, phone, code) matches a live
 * row; marks the row used on success. False for wrong code, expired,
 * or already-used codes.
 */
export async function verifySignInCode(
  provider: OtpProvider,
  phone: string,
  code: string,
): Promise<boolean> {
  const row = await prisma.signInCode.findFirst({
    where: {
      provider,
      identifier: phone,
      code,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!row) return false;
  await prisma.signInCode.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return true;
}

/**
 * Build the synthetic email used to key OTP-authenticated users. Auth.js
 * expects an email; we mint a stable per-phone string. Deliberately provider-
 * agnostic: same phone across WhatsApp + Telegram = same account.
 */
export function syntheticEmail(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  return `${cleaned}@phone.paperloft.local`;
}
