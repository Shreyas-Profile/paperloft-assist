// Public landing page for Paperloft Assist. Anyone visiting the root URL
// sees this; signed-in users are redirected straight to /chat.
//
// Design intent: plain language, big buttons, no jargon, no pricing.
// Optimised for someone who's never used an "AI assistant" before —
// grandparents, parents, first-time-online people. Older-user friendly
// means: text at least 18px in body, single primary CTA, one action per
// screen height, high-contrast, phone number of a real human at the bottom.
//
// Sections (top → bottom):
//   1. Nav — logo left, single Get-started CTA right
//   2. Hero — big welcoming headline, one CTA, one line of subcopy
//   3. What I can do for you — 6 capabilities in plain English
//   4. Two ways to use it — web chat OR WhatsApp
//   5. Coming soon — a short list of what's on the way
//   6. Questions? — Shreyas's real phone + WhatsApp click-to-chat
//   7. Footer

import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

const OWNER_PHONE = "+447404660489";
const OWNER_PHONE_DISPLAY = "+44 7404 660489";
const OWNER_WA_LINK = `https://wa.me/${OWNER_PHONE.replace(/[^0-9]/g, "")}`;

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
            Sign in
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
        Your friendly helper, on your phone.
      </h1>
      <p className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto">
        Set reminders, ask questions, read your documents, and take a photo of a
        prescription to schedule your meds. All in plain English, over WhatsApp
        or here in your browser.
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
        Free to try. No credit card. No app to download.
      </p>
    </section>
  );
}

// ---- What I can do for you ------------------------------------------------

function Capabilities() {
  const items: Array<{ emoji: string; title: string; body: string }> = [
    {
      emoji: "⏰",
      title: "Set reminders",
      body: "Tell me anything you want to remember — birthdays, appointments, medications. I'll ping you on WhatsApp when it's time.",
    },
    {
      emoji: "💊",
      title: "Read a prescription",
      body: "Snap a photo of a prescription and send it to me. I'll pick out the medications, times, and duration, and schedule the reminders for you.",
    },
    {
      emoji: "📎",
      title: "Read your documents",
      body: "Send me a PDF or Word file and ask me questions about it. Great for bills, insurance, contracts, or a doctor's report.",
    },
    {
      emoji: "🌐",
      title: "Look things up online",
      body: "Prices, flights, jobs, opening hours, forms — ask in plain English, I'll go find it.",
    },
    {
      emoji: "🕒",
      title: "Repeat things on a schedule",
      body: "\"Every Monday morning, remind me to take out the bins.\" Done.",
    },
    {
      emoji: "🔒",
      title: "Anonymous browsing",
      body: "For when you want to look something up without leaving a trail. Optional.",
    },
  ];
  return (
    <section className="border-t border-border/50 bg-foreground/[0.02]">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold">What I can do for you</h2>
          <p className="mt-3 text-muted-foreground text-lg">
            Simple things, done for you. No settings to configure.
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
            Pick whichever feels easier. Both use the same account.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-border bg-background p-6 sm:p-7">
            <div className="text-3xl mb-3">💬</div>
            <h3 className="text-xl font-semibold mb-2">Chat in your browser</h3>
            <p className="text-muted-foreground mb-5">
              Open paperloft.uk on your phone or laptop and just type. Best for
              longer conversations or when you want to attach a document.
            </p>
            <Link
              href="/signin?callbackUrl=/chat"
              className="inline-block rounded-lg bg-foreground text-background font-medium px-5 py-2.5 hover:opacity-90 transition"
            >
              Open the chat
            </Link>
          </div>

          <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 sm:p-7">
            <div className="text-3xl mb-3">📱</div>
            <h3 className="text-xl font-semibold mb-2">Message on WhatsApp</h3>
            <p className="text-muted-foreground mb-5">
              After you sign up, just reply to me on WhatsApp from{" "}
              <span className="font-mono text-foreground">+91 8660149805</span>.
              Set reminders, ack them, or send a prescription photo — same
              answers, no app to install.
            </p>
            <Link
              href="/signin?callbackUrl=/chat"
              className="inline-block rounded-lg bg-foreground text-background font-medium px-5 py-2.5 hover:opacity-90 transition"
            >
              Sign up to unlock WhatsApp
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Coming soon ----------------------------------------------------------

function ComingSoon() {
  const items = [
    "Voice notes — send a voice message on WhatsApp instead of typing",
    "Family sharing — one account, reminders for the whole household",
    "Calendar sync — reminders show up in Google Calendar / iCal",
    "Automatic prescription refills — I'll remind you before you run out",
    "Local business helpers — book a table, get a taxi, order the groceries",
  ];
  return (
    <section className="border-t border-border/50 bg-foreground/[0.02]">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <div className="text-center mb-10">
          <div className="inline-block text-xs font-semibold uppercase tracking-widest text-accent mb-2">
            Coming soon
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold">What&apos;s next</h2>
          <p className="mt-3 text-muted-foreground text-lg">
            Building things people actually asked for. Tell me what&apos;s
            missing and I&apos;ll add it.
          </p>
        </div>
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it}
              className="flex items-start gap-3 p-4 rounded-lg border border-border/60 bg-background"
            >
              <span className="text-accent font-bold text-lg leading-tight mt-0.5">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
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
          Ask me directly — I&apos;m a real person, not a company. Happy to
          help, especially if you&apos;re just getting started.
        </p>

        <div className="mt-8 inline-flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <a
            href={OWNER_WA_LINK}
            target="_blank"
            rel="noopener"
            className="rounded-xl bg-[#25D366] text-white font-semibold px-6 py-4 text-base hover:opacity-90 transition inline-flex items-center justify-center gap-2"
          >
            <WhatsAppIcon className="w-5 h-5" />
            Message me on WhatsApp
          </a>
          <a
            href={`tel:${OWNER_PHONE}`}
            className="rounded-xl border border-border font-medium px-6 py-4 text-base hover:bg-foreground/5 transition inline-flex items-center justify-center gap-2"
          >
            <PhoneIcon className="w-5 h-5" />
            {OWNER_PHONE_DISPLAY}
          </a>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          I usually reply within a few hours during UK daytime.
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
        <div className="flex items-center gap-5">
          <a href={OWNER_WA_LINK} target="_blank" rel="noopener" className="hover:text-foreground transition">
            WhatsApp
          </a>
          <a href={`tel:${OWNER_PHONE}`} className="hover:text-foreground transition">
            {OWNER_PHONE_DISPLAY}
          </a>
          <Link href="/signin?callbackUrl=/chat" className="hover:text-foreground transition">
            Sign in
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

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.52 3.48A11.94 11.94 0 0 0 12 0C5.37 0 0 5.37 0 12a11.9 11.9 0 0 0 1.72 6.17L0 24l6-1.6A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52ZM12 22a9.94 9.94 0 0 1-5.06-1.38l-.36-.21-3.56.95.95-3.47-.24-.36A9.94 9.94 0 1 1 12 22Zm5.47-7.47c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.94 1.17-.17.2-.35.22-.65.08-.3-.15-1.25-.46-2.38-1.47a8.9 8.9 0 0 1-1.64-2.03c-.17-.3-.02-.46.13-.6.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.5h-.57c-.2 0-.5.07-.77.37-.27.3-1.03 1-1.03 2.45s1.05 2.83 1.2 3.03c.15.2 2.07 3.16 5 4.43.7.3 1.25.48 1.68.62.7.22 1.34.19 1.84.11.56-.08 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
    </svg>
  );
}
