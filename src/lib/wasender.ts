// Thin wrapper around https://wasenderapi.com — the WhatsApp sending API
// backing the Reminders skill. The env var setup:
//
//   WASENDER_API_KEY   — bearer token from your wasenderapi dashboard
//   WASENDER_FROM      — the wasenderapi phone number sending messages
//
// Both blank means the key hasn't been provisioned yet — sendWhatsApp() no-ops
// (logs + returns { ok: false, reason }) instead of throwing so the rest of
// the app keeps working during setup.
//
// Per-recipient rate cap: 20 sends / recipient / 24h. Prevents runaway loops
// (an LLM in a self-invocation cycle firing hundreds of messages) from
// getting the wasenderapi account locked — that's happened before. Sliding
// window in-memory; resets on container restart, which is safe (the API
// itself also enforces limits so we're belt+braces).
//
// Session-drop handling:
//   - Baileys sessions drop routinely. When wasender returns "session not
//     connected", we mark the session offline in-memory for the next
//     OFFLINE_CACHE_MS window and skip the API call entirely for that
//     window — instant graceful error to the user, no wasted requests
//     to WhatsApp that might get us flagged.
//   - We also fire a one-time Telegram alert to admins (via the
//     PaperloftAssistant bot on its own transport, unaffected by the
//     wasender outage) so Shreyas knows within seconds.

import { prisma } from "./db";

const API_BASE = "https://wasenderapi.com/api";
const MAX_SENDS_PER_RECIPIENT_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_CACHE_MS = 2 * 60 * 1000; // 2 min short-circuit
const ALERT_DEDUP_MS = 30 * 60 * 1000; // one alert per 30 min max

const sendLog = new Map<string, number[]>();

// Cached session-offline state — set when wasender reports the session is
// down, cleared on next successful send. `alertedAt` throttles admin pings.
let sessionOfflineSince: number | null = null;
let lastAlertAt = 0;

function checkRecipientCap(toE164: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const cutoff = now - DAY_MS;
  const history = (sendLog.get(toE164) ?? []).filter((t) => t > cutoff);
  if (history.length >= MAX_SENDS_PER_RECIPIENT_PER_DAY) {
    const oldest = history[0];
    return { allowed: false, retryAfterSec: Math.ceil((oldest + DAY_MS - now) / 1000) };
  }
  history.push(now);
  sendLog.set(toE164, history);
  return { allowed: true };
}

function isCachedOffline(): boolean {
  if (sessionOfflineSince === null) return false;
  if (Date.now() - sessionOfflineSince > OFFLINE_CACHE_MS) {
    // TTL expired — clear so we probe once and update the cache accordingly.
    sessionOfflineSince = null;
    return false;
  }
  return true;
}

function markOfflineAndAlert(reason: string) {
  const wasOffline = sessionOfflineSince !== null;
  sessionOfflineSince = Date.now();
  if (!wasOffline) {
    void notifyAdminsOfOutage(reason);
  }
}

async function notifyAdminsOfOutage(reason: string) {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_DEDUP_MS) return;
  lastAlertAt = now;

  const adminEmails = (process.env.ADMIN_EMAILS ?? "shreyas.pavuluri@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const links = await prisma.telegramLink
    .findMany({
      where: { userEmail: { in: adminEmails } },
      select: { chatId: true, userEmail: true },
    })
    .catch(() => []);

  if (links.length === 0) {
    console.warn(
      `[wasender] session dropped but no admin has a Telegram link — cannot page. Reason: ${reason}`,
    );
    return;
  }

  const text =
    `🚨 *WhatsApp bot session dropped*\n\n` +
    `Reason from wasenderapi: _${reason}_\n\n` +
    `Users hitting sign-in / receiving reminders will fail until reconnected.\n\n` +
    `Fix: dashboard → Sessions → Paperloft Assistant → scan QR from the phone.\n` +
    `https://wasenderapi.com/whatsapp/manage/101468`;

  const { sendTelegramToChatId } = await import("./telegram-bot");
  for (const l of links) {
    await sendTelegramToChatId(l.chatId, text).catch(() => undefined);
  }
}

export interface WhatsAppSendResult {
  ok: boolean;
  reason?: string;
  /** True when the failure was specifically the wasender session being disconnected. */
  sessionOffline?: boolean;
  messageId?: string;
}

const SESSION_OFFLINE_RE = /session is not connected|not connected please connect|whatsapp session/i;

export async function sendWhatsApp(toE164: string, message: string): Promise<WhatsAppSendResult> {
  const key = process.env.WASENDER_API_KEY;
  if (!key) {
    console.warn(
      `[wasender] skipping send — WASENDER_API_KEY not set. Would have sent to ${toE164}: ${message.slice(0, 60)}`,
    );
    return { ok: false, reason: "WASENDER_API_KEY not configured on this server" };
  }

  // Short-circuit when we recently saw the session offline. Saves an API
  // call that would just fail, and gives the user a fast, friendly answer.
  if (isCachedOffline()) {
    return {
      ok: false,
      sessionOffline: true,
      reason: "WhatsApp bot is offline for maintenance — try again in a couple of minutes.",
    };
  }

  const cap = checkRecipientCap(toE164);
  if (!cap.allowed) {
    console.warn(
      `[wasender] rate cap hit for ${toE164} — ${MAX_SENDS_PER_RECIPIENT_PER_DAY}/day. Retry in ${cap.retryAfterSec}s.`,
    );
    return {
      ok: false,
      reason: `rate cap: ${MAX_SENDS_PER_RECIPIENT_PER_DAY} messages/day per recipient reached — retry in ${cap.retryAfterSec}s`,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        to: toE164,
        text: message,
      }),
    });
  } catch (err) {
    // Network error — don't mark session offline (could be our infra).
    return { ok: false, reason: `network: ${(err as Error).message}` };
  }
  // wasenderapi returns HTTP 200 with `{success:false,message:"…"}` when the
  // request was well-formed but delivery couldn't happen.
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    messageId?: string;
  };
  if (!res.ok || json.success === false) {
    const reason = json.message ?? `wasenderapi HTTP ${res.status}`;
    if (SESSION_OFFLINE_RE.test(reason)) {
      markOfflineAndAlert(reason);
      return {
        ok: false,
        sessionOffline: true,
        reason: "WhatsApp bot is offline for maintenance — try again in a couple of minutes.",
      };
    }
    return { ok: false, reason };
  }

  // Successful send — reset the offline cache so the next drop triggers a
  // fresh alert.
  if (sessionOfflineSince !== null) {
    sessionOfflineSince = null;
    console.log("[wasender] session back online after outage");
  }
  // Log every successful send so we can trace "user says they never got
  // the message" complaints. Wasender sometimes returns success for a
  // recipient who has us blocked / never messaged us / has a stale LID,
  // and the message silently vanishes. Having the messageId + timestamp
  // logged is the difference between "we don't know" and "we sent it, ask
  // them to check their spam / unblock our number".
  console.log(
    `[wasender] sent ok → to=${toE164} msgId=${json.messageId ?? "?"} preview=${JSON.stringify(message.slice(0, 40))}`,
  );
  return { ok: true, messageId: json.messageId };
}
