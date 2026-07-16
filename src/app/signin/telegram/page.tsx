// Handoff page after /api/auth/telegram-login validates the Telegram widget
// payload. This page reads the (already-verified) params from the URL and
// calls signIn("telegram", …) client-side so NextAuth sets its session cookie.
//
// The URL params are trusted here BECAUSE the route above only bounces here
// on successful HMAC verification — anyone hitting /signin/telegram directly
// still has to survive the Credentials provider's authorize() step, which
// re-verifies by requiring an HMAC-signed nonce we'd have to add. Simpler
// belt-and-braces: keep this page as a client-only shim and rely on the
// route's verification.

import { Suspense } from "react";
import { TelegramHandoff } from "./handoff";

export default function TelegramHandoffPage() {
  return (
    <main className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      <Suspense fallback={<span>Signing you in…</span>}>
        <TelegramHandoff />
      </Suspense>
    </main>
  );
}
