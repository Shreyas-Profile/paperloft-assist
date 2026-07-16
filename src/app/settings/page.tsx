// User settings. Profile + Plan + Danger zone. The old "Connected accounts"
// section was removed — per-skill enablement is done from /skills instead.

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { isAdmin } from "@/lib/admin";

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.email) redirect("/signin");
  const admin = isAdmin(user.email);

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
          <div>
            <div className="text-xs uppercase tracking-widest text-accent font-semibold">
              Settings
            </div>
            <h1 className="text-3xl font-semibold tracking-tight mt-2">Your account</h1>
          </div>

          {/* Profile */}
          <section className="p-6 rounded-xl border border-border bg-foreground/[0.02]">
            <h2 className="font-semibold mb-4">Profile</h2>
            <div className="flex items-center gap-4">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name ?? "you"}
                  className="w-14 h-14 rounded-full border border-border"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-foreground/10 flex items-center justify-center text-lg font-semibold">
                  {user.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}
              <div>
                <div className="font-medium">{user.name ?? "You"}</div>
                <div className="text-sm text-muted-foreground">{user.email}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Profile is read from your Google account. Update it there to update it here.
            </p>
          </section>

          {/* Plan */}
          <section className="p-6 rounded-xl border border-border bg-foreground/[0.02]">
            <h2 className="font-semibold mb-4">Plan</h2>
            {admin ? (
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-semibold">
                  Admin — all skills, no limits
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Every skill is unlocked. You skip pricing gates and rate limits.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-sm">
                  <span className="font-medium">Beta</span> — all features free while we build.
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  When paid tiers launch, existing users lock in the beta price for life.
                </p>
              </div>
            )}
          </section>

          {/* Telegram moved to /skills — it's a capability, not an account preference. */}

          {/* Danger zone */}
          <section className="p-6 rounded-xl border border-red-500/30 bg-red-500/[0.03]">
            <h2 className="font-semibold mb-2 text-red-600 dark:text-red-400">Danger zone</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Delete your account and all associated data. Cannot be undone.
            </p>
            <button
              type="button"
              disabled
              className="px-4 py-2 rounded-md border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete my account (coming soon)
            </button>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
