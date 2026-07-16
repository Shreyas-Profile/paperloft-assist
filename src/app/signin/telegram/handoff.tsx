"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export function TelegramHandoff() {
  const params = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const id = params.get("id");
    if (!id) {
      window.location.href = "/signin?error=telegram_missing_id";
      return;
    }
    signIn("telegram", {
      telegramId: id,
      firstName: params.get("first_name") ?? "",
      username: params.get("username") ?? "",
      photoUrl: params.get("photo_url") ?? "",
      callbackUrl: "/chat",
    });
  }, [params]);

  return <span>Signing you in…</span>;
}
