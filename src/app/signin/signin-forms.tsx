"use client";

// Two-provider sign-in — Google (OAuth) or Telegram (Login Widget).
// Telegram widget is a first-party script from telegram.org that renders a
// button; on click, Telegram authenticates the user and redirects the
// browser to `data-auth-url` with signed query params. Our server route at
// /api/auth/telegram-login verifies the HMAC before completing sign-in.

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type Tab = "google" | "telegram";

const BOT_USERNAME = "PaperloftAssistantBot";

export function SignInForms({ callbackUrl }: { callbackUrl: string }) {
  const [tab, setTab] = useState<Tab>("google");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-foreground/[0.05] border border-border">
        <TabBtn active={tab === "google"} onClick={() => setTab("google")}>Google</TabBtn>
        <TabBtn active={tab === "telegram"} onClick={() => setTab("telegram")}>Telegram</TabBtn>
      </div>
      {tab === "google" && <GoogleForm callbackUrl={callbackUrl} />}
      {tab === "telegram" && <TelegramForm />}
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

function TelegramForm() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Clear any prior widget iframe (e.g. React StrictMode re-mount).
    containerRef.current.innerHTML = "";
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "10");
    s.setAttribute("data-auth-url", "/api/auth/telegram-login");
    s.setAttribute("data-request-access", "write");
    containerRef.current.appendChild(s);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Click the button to sign in with your Telegram account. Telegram will show a confirmation popup — approve it and you&apos;re in.
      </p>
      <div ref={containerRef} className="flex justify-center min-h-[46px]" />
      <p className="text-[11px] text-muted-foreground">
        We only receive your Telegram id, name, and (if set) username & photo. No phone number, no message history.
      </p>
    </div>
  );
}
