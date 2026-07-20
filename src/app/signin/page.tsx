// Dedicated sign-in page. Auth.js redirects here when someone hits a
// protected route without a session. Telegram-only sign-in for users.
//
// Why Telegram-only: the previous WhatsApp phone-OTP flow via wasenderapi
// was chronically flaky — WhatsApp's server-side spam classifier silently
// dropped OTPs to a chunk of recipients, and there was nothing we could
// change in code to fix it. The Telegram Login Widget doesn't rely on
// OTP delivery at all — Telegram signs the user in via their app or
// web.telegram.org and hands us a signed payload directly. No message
// drops possible.
//
// (Google + WhatsApp providers are still defined in auth.ts as a backdoor
// so existing sessions keep working — the UI just doesn't surface them.)

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TelegramLoginButton } from "./telegram-login-button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/chat");
  const { error } = await searchParams;

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center font-bold mx-auto">
            P
          </div>
          <h1 className="text-2xl font-semibold">Sign in to Paperloft</h1>
          <p className="text-muted-foreground text-sm">
            One tap to sign in with Telegram. No passwords, no OTPs.
          </p>
        </div>

        {error ? (
          <div className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        {botUsername ? (
          <div className="space-y-3">
            <TelegramLoginButton botUsername={botUsername} />
            <p className="text-xs text-center text-muted-foreground">
              Tap the blue Telegram button above. Telegram will open, ask
              you to confirm, and bring you back signed in.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-500">
            Telegram sign-in isn&apos;t configured on this server
            (TELEGRAM_BOT_USERNAME missing). Contact the admin.
          </div>
        )}

        <div className="border-t border-border/50 pt-5 space-y-3">
          <p className="text-sm font-semibold">
            Never used Telegram before? It&apos;s free — takes 2 minutes.
          </p>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside pl-1">
            <li>
              Download the app — same idea as WhatsApp, just a different
              company.
            </li>
            <li>
              Open it and tap <span className="font-medium text-foreground">Start Messaging</span>.
              Enter your phone number and confirm with the code Telegram
              texts you (that&apos;s an SMS from Telegram, not from us).
            </li>
            <li>
              Come back to this page and tap the blue{" "}
              <span className="font-medium text-foreground">
                Log in with Telegram
              </span>{" "}
              button above.
            </li>
          </ol>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <a
              href="https://apps.apple.com/app/telegram-messenger/id686449807"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5 transition"
            >
              Get for iPhone
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=org.telegram.messenger"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5 transition"
            >
              Get for Android
            </a>
            <a
              href="https://web.telegram.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5 transition"
            >
              Use in browser
            </a>
          </div>

          <p className="text-[11px] text-muted-foreground pt-2">
            Stuck? Message me on WhatsApp:{" "}
            <a
              href="https://wa.me/447404660489"
              className="underline hover:text-foreground"
            >
              +44 7404 660489
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
