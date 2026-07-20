"use client";

// Renders the official Telegram Login Widget. Telegram serves it as a
// <script> that injects an iframe with a "Log in with Telegram" button. When
// the user clicks it and confirms in Telegram (app or web), Telegram redirects
// the browser to the data-auth-url with signed params — our
// /api/auth/telegram-login route validates the HMAC and finishes sign-in.
//
// Requirements:
//   - Bot must have a domain set via BotFather → /setdomain → paperloft.uk
//   - Bot username exposed to the client via NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
//
// The widget CANNOT be pre-rendered on the server — it needs to inject a
// script that mounts an iframe on the fly.

import { useEffect, useRef } from "react";

export function TelegramLoginButton({
  botUsername,
}: {
  botUsername: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Idempotent: if the iframe already exists (React re-render or fast
    // refresh), don't inject a second copy.
    if (container.querySelector("iframe")) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-auth-url", "/api/auth/telegram-login");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);
  }, [botUsername]);

  return <div ref={containerRef} className="flex justify-center" />;
}
