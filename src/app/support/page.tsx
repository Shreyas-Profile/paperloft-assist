// Public /support page. Anyone (signed in or not) can submit a ticket.
// Signed-in users get their identity attached server-side; anonymous
// users just fill in name + optional email.
//
// Form UX intentionally minimal — the point is to make reporting easy,
// not to interrogate the user. Long body is fine; short is fine.

import Link from "next/link";
import { SupportForm } from "./support-form";

export const metadata = {
  title: "Report a bug or request a feature — Paperloft Assist",
  description:
    "Tell me what broke, what's missing, or what could be better. Every ticket is triaged and I reply as fast as I can.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen flex items-start justify-center px-6 py-14 bg-background text-foreground">
      <div className="max-w-xl w-full space-y-8">
        <div className="space-y-3">
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to Paperloft
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            Report a bug or request a feature
          </h1>
          <p className="text-muted-foreground">
            Every ticket lands directly in my inbox. I read them all. I
            triage each one and reply as fast as I can — see the SLA below.
          </p>
        </div>

        <SupportForm />

        <div className="rounded-lg border border-border/60 bg-foreground/[0.02] p-4 text-sm space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-accent font-semibold">
            Response times
          </div>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">P0 — site down / data loss:</span>{" "}
              same day, whenever I see it.
            </li>
            <li>
              <span className="font-medium text-foreground">P1 — broken for you specifically:</span>{" "}
              within 3 days.
            </li>
            <li>
              <span className="font-medium text-foreground">P2 — annoying UX, small bug:</span>{" "}
              within a week or two.
            </li>
            <li>
              <span className="font-medium text-foreground">P3 — cosmetic / low-value:</span>{" "}
              when I get to it.
            </li>
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            An AI triages each ticket to guess the category + priority
            before I look at it. I read the AI's take, but I decide.
          </p>
        </div>
      </div>
    </main>
  );
}
