// Public /privacy page. Renders the PRIVACY.md contents.
//
// Kept as a single hand-authored page rather than pulling from the
// markdown file at runtime — the copy rarely changes and the
// dependency on a markdown pipeline (remark etc.) would drag the
// build. If the source of truth in PRIVACY.md diverges from this
// page, this page is the canonical one users see; edit both together
// (there's a lint reminder note at the top of PRIVACY.md).

import Link from "next/link";

export const metadata = {
  title: "Privacy — Paperloft Assist",
  description:
    "What Paperloft knows about you, why, how long it's kept, and how to have it deleted.",
};

const LAST_UPDATED = "2026-07-28";

const COLLECT = [
  {
    category: "Identity",
    data: "Google email + name, or Telegram username + first name + chat id",
    why: "So we know which reminders / chats belong to you",
  },
  {
    category: "Chat history",
    data: "Messages you send Paperloft + Paperloft's replies",
    why: "Loaded as context on your next message so the bot remembers what you were talking about",
  },
  {
    category: "Reminders",
    data: "Title, due time, recurrence, medication metadata, ack state",
    why: "The reminder itself + the fire schedule",
  },
  {
    category: "Prescription uploads",
    data: "PDFs / images you send + extracted medications and dosages",
    why: "Input for the reminder scheduler",
  },
  {
    category: "Support tickets",
    data: "Name, optional email, ticket body, AI triage output",
    why: "So you can raise bugs / requests and I can reply",
  },
  {
    category: "Skill connections",
    data: "Per-user API keys for hosted skills, AES-256-GCM encrypted",
    why: "So Paperloft can call those skills as you",
  },
  {
    category: "Operational logs",
    data: "Timestamps, tool-call names, LLM latency, error messages",
    why: "Debugging; auto-rotated at 14 days",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-14 bg-background text-foreground">
      <article className="max-w-2xl mx-auto space-y-8 text-[15px] leading-relaxed">
        <div className="space-y-2">
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to Paperloft
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
          <p className="text-xs text-muted-foreground">
            Last updated {LAST_UPDATED}
          </p>
        </div>

        <p className="text-muted-foreground">
          Paperloft Assist is a small personal-assistant service run by
          Shreyas Pavuluri from the UK. This page explains what the service
          knows about you, why, how long it&apos;s kept, and how to make it
          forget. If anything here is unclear,{" "}
          <Link href="/support" className="underline hover:text-foreground">
            file a support ticket
          </Link>{" "}
          and I&apos;ll rewrite it.
        </p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">What we collect</h2>
          <p className="text-muted-foreground text-sm">
            Only what the service needs. No analytics beacons, no third-party
            trackers.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-foreground/[0.03] border-b border-border">
                <tr>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium">Data</th>
                  <th className="text-left p-3 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {COLLECT.map((row) => (
                  <tr key={row.category} className="border-b border-border/40 last:border-b-0">
                    <td className="p-3 font-medium align-top">{row.category}</td>
                    <td className="p-3 text-muted-foreground align-top">{row.data}</td>
                    <td className="p-3 text-muted-foreground align-top">{row.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What we don&apos;t collect</h2>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>No IP address logging beyond what Cloudflare&apos;s edge does by default.</li>
            <li>No cross-site tracking cookies. Session cookies are for auth only.</li>
            <li>
              No selling or sharing of any of the above data to third parties.
              Period.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Who else sees your data</h2>
          <p className="text-muted-foreground">
            Paperloft calls a few third-party services to work. They see:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">OpenRouter</strong> — every
              chat message + reply flows through OpenRouter to the underlying
              LLM. Their{" "}
              <a
                href="https://openrouter.ai/privacy"
                target="_blank"
                rel="noopener"
                className="underline hover:text-foreground"
              >
                privacy policy
              </a>{" "}
              applies to that leg.
            </li>
            <li>
              <strong className="text-foreground">Telegram</strong> — relays
              bot messages. Their{" "}
              <a
                href="https://telegram.org/privacy"
                target="_blank"
                rel="noopener"
                className="underline hover:text-foreground"
              >
                privacy policy
              </a>{" "}
              applies.
            </li>
            <li>
              <strong className="text-foreground">Google</strong> — sees only
              that you authenticated at paperloft.uk (standard OAuth).
            </li>
            <li>
              <strong className="text-foreground">Cloudflare</strong> — request
              metadata (IP, path, headers). Standard tunnel provider.
            </li>
            <li>
              <strong className="text-foreground">Hetzner</strong> — hosts the
              server. No operational access to the app database.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How long we keep it</h2>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Chat messages: until you delete them or delete your account.</li>
            <li>Reminders: kept until you delete them; auto-purged after 1 year.</li>
            <li>Prescription uploads: until you delete them.</li>
            <li>Support tickets: 2 years, then anonymised.</li>
            <li>Operational logs: auto-rotated at 14 days.</li>
            <li>Encrypted skill keys: until you disable the skill.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How to delete your data</h2>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Individual items:</strong>{" "}
            message the bot or use the web chat; toggle skills off in{" "}
            <Link href="/skills" className="underline hover:text-foreground">
              /skills
            </Link>
            .
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Everything:</strong>{" "}
            <Link href="/support" className="underline hover:text-foreground">
              file a support ticket
            </Link>{" "}
            asking to delete your account. I&apos;ll manually run a purge
            within 30 days and confirm when it&apos;s done.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Children</h2>
          <p className="text-muted-foreground">
            Paperloft isn&apos;t marketed to under-13s. If you&apos;re a
            parent and think a child under 13 created an account,{" "}
            <Link href="/support" className="underline hover:text-foreground">
              file a ticket
            </Link>{" "}
            and I&apos;ll delete it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-muted-foreground">
            Anything not covered here —{" "}
            <Link href="/support" className="underline hover:text-foreground">
              file a support ticket
            </Link>{" "}
            or email{" "}
            <a
              href="mailto:shreyas.pavuluri@gmail.com"
              className="underline hover:text-foreground"
            >
              shreyas.pavuluri@gmail.com
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
