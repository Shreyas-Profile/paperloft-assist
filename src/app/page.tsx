// Public landing page for Paperloft Assist. Anyone visiting the root URL
// sees this; signed-in users are redirected straight to /chat.
//
// Design intent: plain language, big buttons, no jargon, no pricing.
// Optimised for someone who's never used an "AI assistant" before —
// grandparents, parents, first-time-online people. Older-user friendly
// means: text at least 18px in body, single primary CTA, one action per
// screen height, high-contrast.
//
// Positioning: Reminders is the flagship, working-today feature. Everything
// else (calls, email, PowerPoint, etc.) is honestly labelled as coming soon.
// We do NOT advertise generic web browsing — that capability was pulled.

import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

const OWNER_EMAIL = "shreyas.pavuluri@gmail.com";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/chat");

  return (
    <main className="min-h-screen bg-background text-foreground text-[17px] leading-relaxed">
      <Nav />
      <Hero />
      <Capabilities />
      <TwoWays />
      <ComingSoon />
      <Questions />
      <Footer />
    </main>
  );
}

// ---- Nav -------------------------------------------------------------------

function Nav() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-background/80 border-b border-border/50">
      <div className="mx-auto max-w-5xl px-5 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-base">
          <LogoMark />
          <span>Paperloft Assist</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/signin?callbackUrl=/chat"
            className="rounded-lg border border-border text-sm font-medium px-3.5 py-2 hover:bg-foreground/5 transition"
          >
            Log in
          </Link>
          <Link
            href="/signin?callbackUrl=/chat"
            className="rounded-lg bg-foreground text-background text-sm font-medium px-4 py-2 hover:opacity-90 transition"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ---- Hero ------------------------------------------------------------------

function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-5 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
        Your reminders, on Telegram. Everything else, soon.
      </h1>
      <p className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto">
        Rock-solid reminders you can set in plain English, delivered on Telegram
        so nothing gets missed. The rest of your personal assistant — email,
        calls, presentations — is on the way.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/signin?callbackUrl=/chat"
          className="w-full sm:w-auto rounded-xl bg-foreground text-background text-base font-semibold px-7 py-4 hover:opacity-90 transition"
        >
          Start now — takes 30 seconds
        </Link>
        <a
          href="#two-ways"
          className="w-full sm:w-auto rounded-xl border border-border text-base font-medium px-7 py-4 hover:bg-foreground/5 transition"
        >
          See how it works
        </a>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Free during beta. No credit card. No app to download.
      </p>
    </section>
  );
}

// ---- What I can do for you ------------------------------------------------

function Capabilities() {
  const items: Array<{ emoji: string; title: string; body: string }> = [
    {
      emoji: "⏰",
      title: "Set reminders in plain English",
      body: "\"Remind me to call mum at 8pm\" or \"every Monday morning, take out the bins.\" I'll ping you on Telegram right on time.",
    },
    {
      emoji: "🔁",
      title: "Repeating schedules",
      body: "Daily, weekdays, weekly, monthly — say it however feels natural. Skip or mark done from Telegram in one tap.",
    },
    {
      emoji: "💊",
      title: "Medication timings",
      body: "Say what to take and when, and I keep the schedule. Great for family members who need a nudge and a Taken/Skip check-in.",
    },
    {
      emoji: "📱",
      title: "Voice, photos, and PDFs",
      body: "Send me a voice note, a photo, or a PDF on Telegram and I'll read it and act on it. No typing needed.",
    },
    {
      emoji: "💬",
      title: "Chat back and forth",
      body: "Ask questions, tweak a reminder, cancel one, or just talk. Same account works in your browser at paperloft.uk too.",
    },
    {
      emoji: "🧩",
      title: "Add your own skills",
      body: "Bring your own MCP server — the assistant will use it. Docs, calendars, whatever your team runs.",
    },
  ];
  return (
    <section className="border-t border-border/50 bg-foreground/[0.02]">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold">What I can do today</h2>
          <p className="mt-3 text-muted-foreground text-lg">
            Focused on reminders and getting them right. More coming — see below.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-xl border border-border/60 bg-background p-5"
            >
              <div className="text-3xl leading-none mb-3">{it.emoji}</div>
              <div className="font-semibold text-lg mb-1">{it.title}</div>
              <p className="text-muted-foreground">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Two ways to use it ---------------------------------------------------

function TwoWays() {
  return (
    <section id="two-ways" className="border-t border-border/50">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold">Two ways to use it</h2>
          <p className="mt-3 text-muted-foreground text-lg">
            Same account, same brain. Pick whichever&apos;s easier.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 sm:p-7">
            <div className="text-3xl mb-3">📱</div>
            <h3 className="text-xl font-semibold mb-2">Message on Telegram</h3>
            <p className="text-muted-foreground mb-5">
              Once you sign in, chat with{" "}
              <span className="font-mono text-foreground">@PaperloftAssistantBot</span>{" "}
              on Telegram. Type, record a voice note, snap a photo, drop a PDF —
              whatever&apos;s quickest. Reminders land as Telegram notifications.
            </p>
            <Link
              href="/signin?callbackUrl=/chat"
              className="inline-block rounded-lg bg-foreground text-background font-medium px-5 py-2.5 hover:opacity-90 transition"
            >
              Sign in with Telegram
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-background p-6 sm:p-7">
            <div className="text-3xl mb-3">💻</div>
            <h3 className="text-xl font-semibold mb-2">Chat in your browser</h3>
            <p className="text-muted-foreground mb-5">
              Open paperloft.uk on your phone or laptop and just type. Best for
              longer conversations or when you want to see everything in one place.
            </p>
            <Link
              href="/signin?callbackUrl=/chat"
              className="inline-block rounded-lg border border-border font-medium px-5 py-2.5 hover:bg-foreground/5 transition"
            >
              Open the chat
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Coming soon ----------------------------------------------------------
//
// Honest roadmap. We only list things we've actually started or scoped —
// no vapourware. The bigger message is "this is becoming a full personal
// assistant, reminders is where it starts."

function ComingSoon() {
  const items: Array<{ title: string; body: string }> = [
    {
      title: "Email management",
      body: "Read, triage, draft, reply — Gmail and Outlook. You approve every send.",
    },
    {
      title: "Phone calls",
      body: "Ask me to call the dentist to reschedule, and I'll ring, wait on hold, and text you the outcome.",
    },
    {
      title: "PowerPoint & slides",
      body: "\"Turn this into a 10-slide deck\" — I'll draft, style, and hand back a .pptx you can edit.",
    },
    {
      title: "Calendar sync",
      body: "Reminders and events flow into Google Calendar / iCal automatically.",
    },
    {
      title: "Family sharing",
      body: "One account, reminders for the whole household. Grandparents, parents, kids.",
    },
    {
      title: "More skills, on demand",
      body: "You can already bring your own MCP skills. Marketplace of first-party skills growing every month.",
    },
  ];
  return (
    <section className="border-t border-border/50 bg-foreground/[0.02]">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <div className="text-center mb-10">
          <div className="inline-block text-xs font-semibold uppercase tracking-widest text-accent mb-2">
            Coming soon
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold">
            Becoming a full personal assistant
          </h2>
          <p className="mt-3 text-muted-foreground text-lg">
            Reminders is where we start. Here&apos;s what&apos;s next.
          </p>
        </div>
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.title}
              className="p-4 rounded-lg border border-border/60 bg-background"
            >
              <div className="font-semibold text-lg">{it.title}</div>
              <p className="text-muted-foreground mt-1">{it.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-center text-sm text-muted-foreground mt-6">
          Missing something you&apos;d actually use? Email me and I&apos;ll
          build it.
        </p>
      </div>
    </section>
  );
}

// ---- Questions? -----------------------------------------------------------

function Questions() {
  return (
    <section id="questions" className="border-t border-border/50">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold">Got a question?</h2>
        <p className="mt-3 text-muted-foreground text-lg">
          Email me directly — I&apos;m a real person, not a company. Happy to
          help, especially if you&apos;re just getting started.
        </p>

        <div className="mt-8">
          <a
            href={`mailto:${OWNER_EMAIL}`}
            className="rounded-xl bg-foreground text-background font-semibold px-6 py-4 text-base hover:opacity-90 transition inline-flex items-center justify-center gap-2"
          >
            <EmailIcon className="w-5 h-5" />
            Email me
          </a>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          <span className="font-mono">{OWNER_EMAIL}</span> — usually reply within
          a few hours during UK daytime.
        </p>
      </div>
    </section>
  );
}

// ---- Footer ---------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-border/50 bg-foreground/[0.02]">
      <div className="mx-auto max-w-5xl px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="font-medium text-foreground">Paperloft Assist</span>
          <span>· by Shreyas Pavuluri</span>
        </div>
        <div className="flex items-center gap-5 flex-wrap justify-center">
          <a href={`mailto:${OWNER_EMAIL}`} className="hover:text-foreground transition">
            Email
          </a>
          <Link href="/status" className="hover:text-foreground transition">
            Status
          </Link>
          <Link href="/support" className="hover:text-foreground transition">
            Support
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition">
            Privacy
          </Link>
          <Link href="/signin?callbackUrl=/chat" className="hover:text-foreground transition">
            Log in
          </Link>
        </div>
      </div>
    </footer>
  );
}

// ---- Marks ----------------------------------------------------------------

function LogoMark() {
  return (
    <span className="inline-flex w-8 h-8 rounded-lg bg-foreground text-background items-center justify-center text-sm font-bold">
      P
    </span>
  );
}

function EmailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
