// Dedicated sign-in page. Auth.js redirects here when someone hits a
// protected route without a session. Renders the tabbed UI (Google + WhatsApp).

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInForms } from "./signin-forms";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/chat");
  const { callbackUrl = "/chat", error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center font-bold mx-auto">
            P
          </div>
          <h1 className="text-2xl font-semibold">Sign in to Paperloft Assist</h1>
          <p className="text-muted-foreground text-sm">
            Continue with Google, or sign in with Telegram.
          </p>
        </div>
        {error ? (
          <div className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
            {decodeURIComponent(error)}
          </div>
        ) : null}
        <SignInForms callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
