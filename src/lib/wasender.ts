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

const API_BASE = "https://wasenderapi.com/api";
const MAX_SENDS_PER_RECIPIENT_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const sendLog = new Map<string, number[]>();

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

export interface WhatsAppSendResult {
  ok: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendWhatsApp(toE164: string, message: string): Promise<WhatsAppSendResult> {
  const key = process.env.WASENDER_API_KEY;
  if (!key) {
    console.warn(
      `[wasender] skipping send — WASENDER_API_KEY not set. Would have sent to ${toE164}: ${message.slice(0, 60)}`,
    );
    return { ok: false, reason: "WASENDER_API_KEY not configured on this server" };
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

  const res = await fetch(`${API_BASE}/send-message`, {
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
  // wasenderapi returns HTTP 200 with `{success:false,message:"…"}` when the
  // request was well-formed but delivery couldn't happen (e.g. the WhatsApp
  // session on their dashboard isn't linked, subscription lapsed, etc.).
  // Treat that as failure — otherwise we silently drop OTPs.
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    messageId?: string;
  };
  if (!res.ok || json.success === false) {
    const reason =
      json.message ??
      `wasenderapi HTTP ${res.status}`;
    return { ok: false, reason };
  }
  return { ok: true, messageId: json.messageId };
}
