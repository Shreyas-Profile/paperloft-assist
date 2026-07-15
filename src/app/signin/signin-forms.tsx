"use client";

// Tabbed sign-in — Google, WhatsApp OTP, Telegram OTP.
// Both OTP flows use the user's phone number in E.164 format. Telegram
// requires a one-time link step: user opens @shreyasassistantbot, hits
// /start, taps Share Contact — the bot stores phone→chatId, then we can
// DM their code. If they hit "Send code" before linking, the API returns
// HTTP 428 and we show a deep-link to the bot.

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";

type Tab = "google" | "whatsapp" | "telegram";

export function SignInForms({ callbackUrl }: { callbackUrl: string }) {
  const [tab, setTab] = useState<Tab>("google");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-foreground/[0.05] border border-border">
        <TabBtn active={tab === "google"} onClick={() => setTab("google")}>Google</TabBtn>
        <TabBtn active={tab === "whatsapp"} onClick={() => setTab("whatsapp")}>WhatsApp</TabBtn>
        <TabBtn active={tab === "telegram"} onClick={() => setTab("telegram")}>Telegram</TabBtn>
      </div>
      {tab === "google" && <GoogleForm callbackUrl={callbackUrl} />}
      {tab === "whatsapp" && <OtpForm provider="whatsapp" callbackUrl={callbackUrl} />}
      {tab === "telegram" && <OtpForm provider="telegram" callbackUrl={callbackUrl} />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function GoogleForm({ callbackUrl }: { callbackUrl: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      className="w-full px-4 py-2.5 rounded-lg border border-border bg-foreground text-background font-medium hover:opacity-90 transition"
    >
      Continue with Google
    </button>
  );
}

function OtpForm({
  provider,
  callbackUrl,
}: {
  provider: "whatsapp" | "telegram";
  callbackUrl: string;
}) {
  const [step, setStep] = useState<"phone" | "link-telegram" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, phone: phone.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 428) {
        setStep("link-telegram");
        return;
      }
      if (!res.ok) {
        setError(j.error ?? "Failed to send code.");
        return;
      }
      setStep("code");
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signIn(provider, {
        identifier: phone.trim(),
        code: code.trim(),
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError("Wrong or expired code. Try requesting a new one.");
        return;
      }
      window.location.href = callbackUrl;
    });
  };

  if (step === "link-telegram") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm space-y-2">
          <p className="font-medium">Link your Telegram first</p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
            <li>
              Open{" "}
              <a
                href="https://t.me/shreyasassistantbot"
                target="_blank"
                className="text-accent underline"
                rel="noreferrer"
              >
                @shreyasassistantbot
              </a>
            </li>
            <li>Send <code className="rounded bg-foreground/10 px-1">/start</code></li>
            <li>Tap <b>📱 Share my phone number</b></li>
            <li>Come back here and hit Retry</li>
          </ol>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep("phone")}
            className="px-3 py-2 rounded-md border border-border text-sm hover:bg-foreground/5"
          >
            Back
          </button>
          <button
            type="button"
            onClick={sendCode}
            disabled={pending}
            className="flex-1 px-4 py-2.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Retrying…" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {provider === "telegram" ? (
            <>
              Enter the phone number connected to your Telegram account (international format,
              e.g. +447700900123). First time only, you&apos;ll be asked to link Telegram to
              this number.
            </>
          ) : (
            <>Enter your WhatsApp number in international format (e.g. +447700900123). We&apos;ll message you a 6-digit code.</>
          )}
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+447700900123"
          className="w-full px-3 py-2 rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={pending || !phone.trim()}
          className="w-full px-4 py-2.5 rounded-lg border border-border bg-foreground text-background font-medium hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Enter the 6-digit code we just sent to <b>{phone}</b>.
      </p>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        inputMode="numeric"
        maxLength={6}
        className="w-full px-3 py-2 rounded-md border border-border bg-transparent text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setCode("");
          }}
          className="px-3 py-2 rounded-md border border-border text-sm hover:bg-foreground/5 transition"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={pending || code.length < 4}
          className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-foreground text-background font-medium hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Verifying…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
