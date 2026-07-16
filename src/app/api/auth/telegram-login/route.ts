// Telegram Login Widget callback.
//
// After the user clicks the widget and confirms on Telegram, Telegram redirects
// the browser here with signed query params:
//   ?id=…&first_name=…&last_name=…&username=…&photo_url=…&auth_date=…&hash=…
//
// We verify the HMAC-SHA256 signature against sha256(BOT_TOKEN) — the standard
// Telegram Login Widget check — then hand the user off to a client page that
// completes the NextAuth Credentials sign-in flow (server-side signIn from a
// route handler is fragile in Next.js 16, so we bounce via the client instead).
//
// Docs: https://core.telegram.org/widgets/login#checking-authorization

import { NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";

const AUTH_WINDOW_SECONDS = 24 * 60 * 60; // 1 day

function verify(params: Record<string, string>): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const { hash, ...rest } = params;
  if (!hash) return false;
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(token).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return computed === hash;
}

// Build absolute URLs from AUTH_URL, not req.url — behind Cloudflare tunnel
// req.url reflects the container-internal hostname (something like
// http://80a158d9372a:3000) which the browser can't reach.
const PUBLIC_BASE = (process.env.AUTH_URL ?? "https://paperloft.uk").replace(/\/$/, "");

function signInError(reason: string): Response {
  const url = new URL(`${PUBLIC_BASE}/signin`);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));

  if (!params.id || !params.hash || !params.auth_date) {
    return signInError("telegram_missing_params");
  }
  if (!verify(params)) {
    return signInError("telegram_bad_signature");
  }
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > AUTH_WINDOW_SECONDS) {
    return signInError("telegram_expired");
  }

  // Hand off to a tiny client page that calls signIn("telegram", {…}) with
  // the validated info. NextAuth handles cookie setting from that.
  const handoff = new URL(`${PUBLIC_BASE}/signin/telegram`);
  handoff.searchParams.set("id", params.id);
  handoff.searchParams.set("first_name", params.first_name ?? "");
  handoff.searchParams.set("username", params.username ?? "");
  handoff.searchParams.set("photo_url", params.photo_url ?? "");
  return NextResponse.redirect(handoff);
}
