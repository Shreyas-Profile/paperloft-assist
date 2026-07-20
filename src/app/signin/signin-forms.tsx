"use client";

// WhatsApp-only sign-in. Flow:
//   1. User enters an E.164 phone → POST /api/auth/otp/send
//      → wasenderapi delivers a 6-digit code to their WhatsApp.
//   2. User enters the code → signIn("whatsapp", {phone, code, callbackUrl})
//      → the WhatsApp Credentials provider in lib/auth.ts verifies the code
//      and mints <phone>@phone.paperloft.local as the synthetic identity.
//
// The Google + Telegram Credentials providers are still defined in
// lib/auth.ts (existing sessions keep working, admin backdoor via Google
// stays alive) but no UI surfaces them anymore.

import { useState } from "react";
import { signIn } from "next-auth/react";

// Default country code shown pre-filled in the phone input. Most users are
// in India; forcing every user to type "+91" was a real drop-off point (and
// caused silent "nothing happens on button click" bugs when older iPhones
// autocorrected the + away). Users outside India just backspace and retype.
const DEFAULT_DIAL_CODE = "+91";

// Keep the input as +<digits> only. Strips spaces, dashes, letters, and any
// stray "+" that isn't at position 0 (some keyboards paste "+91+91...").
function sanitizePhone(raw: string): string {
  let v = raw.replace(/[^\d+]/g, "");
  v = v.replace(/(?!^)\+/g, "");
  if (v && !v.startsWith("+")) v = "+" + v;
  return v;
}

export function SignInForms({ callbackUrl }: { callbackUrl: string }) {
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(DEFAULT_DIAL_CODE);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    const p = phone.trim();
    if (p === "" || p === DEFAULT_DIAL_CODE || !/^\+[1-9]\d{6,14}$/.test(p)) {
      // Explicit empty/default-only check so users get a useful message
      // instead of the generic "international format" one when they hit
      // the button with just "+91" in the field.
      setError(
        p === "" || p === DEFAULT_DIAL_CODE
          ? `Type your phone number after ${DEFAULT_DIAL_CODE}. Example: ${DEFAULT_DIAL_CODE}9876543210.`
          : `That doesn't look like a valid number. Use international format, e.g. ${DEFAULT_DIAL_CODE}9876543210.`,
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "whatsapp", phone: phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setStage("code");
        setInfo(`Code sent to ${phone.trim()} on WhatsApp. Check your chats.`);
      }
    } catch (err) {
      setError((err as Error).message || "network error");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Code must be 6 digits.");
      return;
    }
    setBusy(true);
    try {
      const res = await signIn("whatsapp", {
        phone: phone.trim(),
        code: code.trim(),
        callbackUrl,
        redirect: false,
      });
      if (res?.error) {
        setError("Wrong or expired code. Try again, or send a new one.");
      } else if (res?.ok) {
        window.location.href = res.url ?? callbackUrl;
      } else {
        setError("Sign-in failed. Try again.");
      }
    } catch (err) {
      setError((err as Error).message || "network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {stage === "phone" && (
        <>
          <p className="text-sm text-muted-foreground">
            Enter your WhatsApp number. We&apos;ll send you a 6-digit code
            to sign in.
          </p>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(sanitizePhone(e.target.value))}
            placeholder={`${DEFAULT_DIAL_CODE}9876543210`}
            className={`w-full px-3 py-3 rounded-lg border bg-background font-mono text-base ${
              error ? "border-red-500/60" : "border-border"
            }`}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCode();
            }}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            Pre-filled with <span className="font-mono">{DEFAULT_DIAL_CODE}</span> for India.
            Outside India? Delete it and type your own country code (
            <span className="font-mono">+44</span> UK,{" "}
            <span className="font-mono">+1</span> US, etc.).
          </p>
          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
          {/*
            Intentionally NOT disabling on `!phone`. Users on some mobile
            browsers see a disabled button and assume the site is broken
            before they've even finished typing. Let them click, then
            validate on click.
          */}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="w-full px-4 py-3 rounded-lg bg-foreground text-background font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send code on WhatsApp"}
          </button>
        </>
      )}

      {stage === "code" && (
        <>
          {info && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
              {info}
            </div>
          )}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="123456"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background font-mono text-lg tracking-widest text-center"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") verify();
            }}
            autoFocus
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="button"
            onClick={verify}
            disabled={busy || code.length !== 6}
            className="w-full px-4 py-2.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify + sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("phone");
              setCode("");
              setInfo(null);
              setError(null);
            }}
            disabled={busy}
            className="w-full text-xs text-muted-foreground hover:text-foreground underline"
          >
            ← Use a different number
          </button>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Standard WhatsApp rates apply. Code expires in 10 minutes.
      </p>
    </div>
  );
}
