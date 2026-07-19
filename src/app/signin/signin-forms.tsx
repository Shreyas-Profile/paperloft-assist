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

export function SignInForms({ callbackUrl }: { callbackUrl: string }) {
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    if (!/^\+[1-9]\d{6,14}$/.test(phone.trim())) {
      setError("Phone must be in international format, e.g. +447700900123.");
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
          <p className="text-xs text-muted-foreground">
            Enter your phone number in international format. We&apos;ll send a
            6-digit code to your WhatsApp.
          </p>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+447700900123"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background font-mono text-sm"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCode();
            }}
            autoFocus
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy || !phone}
            className="w-full px-4 py-2.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-50"
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
