// POST /api/auth/otp/send
//
// Body: { provider: "whatsapp" | "telegram", phone: string }
//   - phone: E.164, e.g. "+447700900123" (SAME format for both providers)
//
// Generates a 6-digit code, stores it, and delivers via the chosen channel.
// Returns { ok: true } on success. Returns 428 (Precondition Required) if the
// Telegram user hasn't linked their phone to the bot yet — the UI shows a
// deep-link to the bot in that case.

import { NextResponse } from "next/server";
import { createSignInCode, sendOtp, type OtpProvider } from "@/lib/otp";

const PROVIDERS = new Set<OtpProvider>(["whatsapp", "telegram"]);
// E.164: leading +, then 1-15 digits. Not a full validator — just a shape
// check to reject obvious garbage before we hit the delivery APIs.
const E164 = /^\+[1-9]\d{6,14}$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    provider?: string;
    // "identifier" kept as alias for backwards compat with the client.
    phone?: string;
    identifier?: string;
  } | null;
  const provider = body?.provider as OtpProvider | undefined;
  const phone = (body?.phone ?? body?.identifier)?.trim();
  if (!provider || !PROVIDERS.has(provider) || !phone) {
    return NextResponse.json(
      { error: "Provider (whatsapp|telegram) and phone required." },
      { status: 400 },
    );
  }
  if (!E164.test(phone)) {
    return NextResponse.json(
      { error: "Phone must be in international format, e.g. +447700900123." },
      { status: 400 },
    );
  }
  const code = await createSignInCode(provider, phone);
  const send = await sendOtp(provider, phone, code);
  if (!send.ok) {
    console.warn(`[otp/send] delivery failed for ${provider} → ${phone}: ${send.reason}`);
    // 428 = "you need to do something first" — the UI catches this and shows
    // the bot deep-link instead of a plain error. 422 for everything else so
    // Cloudflare doesn't eat the body (5xx does).
    const status = send.needsBotStart ? 428 : 422;
    return NextResponse.json({ error: send.reason }, { status });
  }
  return NextResponse.json({ ok: true });
}
