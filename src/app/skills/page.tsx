// Skills marketplace. Each skill is a per-user toggle: the user chooses
// which skills their assistant can call. Enabled state lives in Postgres
// (EnabledSkill table), keyed by (userEmail, skillId).
//
// Adding a skill: add an entry to SKILLS below AND to KNOWN_SKILLS in
// src/app/api/skills/[skillId]/toggle/route.ts (that check keeps the API
// from writing rows for skill ids the UI doesn't know about).

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { isAdmin } from "@/lib/admin";
import { listEnabledSkills } from "@/lib/enabled-skills";
import { SkillCard } from "./skill-card";
import { prisma } from "@/lib/db";
import { TelegramConnect } from "../settings/telegram-connect";

type SkillEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: string;
  needs?: string;
  publisher?: string;
};

// telegram_mcp (Telegram bridge — BYO-bot MCP marketplace item) removed.
// Redundant now that /skills shows a first-class Telegram delivery card
// backed by @PaperloftAssistantBot at the top of this page.
// browser_agent (client-side Chrome via extension) removed. Replaced by
// always-on hosted browser_* tools backed by globalion/browser-mcp on
// Hetzner — same names, always available, no local machine needed.
const SKILLS: SkillEntry[] = [
  {
    id: "video_render_mcp",
    name: "Video render",
    category: "External MCP · Globalion",
    description:
      "Turns a script into a Hyperplexed-style motion-graphics MP4. Free voice via Microsoft Edge Neural TTS, Remotion-powered animation, no watermark.",
    price: "Free (20/day)",
    needs: "Google sign-in",
    publisher: "Globalion (Pawan)",
  },
  {
    id: "reminders",
    name: "Reminders & Prescriptions",
    category: "Notifications · WhatsApp",
    description:
      "General reminders (meetings, birthdays, deadlines) plus medication schedules with Taken/Snooze/Skip acks and prescription intake — snap a prescription photo or paste text and the assistant auto-schedules the meds and follow-up. Delivered via WhatsApp; Telegram coming.",
    price: "Free",
    needs: "WhatsApp sign-in (or your phone number)",
    publisher: "Globalion (Shreyas, forked from Pakki10/nova-reminders)",
  },
];

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const admin = isAdmin(session.user.email);
  const enabled = await listEnabledSkills(session.user.email);
  const telegramLink = await prisma.telegramLink
    .findUnique({ where: { userEmail: session.user.email } })
    .catch(() => null);

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-10">
            <div className="text-xs uppercase tracking-widest text-accent font-semibold">
              Skills
            </div>
            <h1 className="text-3xl font-semibold tracking-tight mt-2">
              What Paperloft Assist can do.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl">
              Toggle a skill on and your assistant can call it. Off means it
              stays out of the agent's toolbelt entirely. Everything below is
              free during beta
              {admin ? " — and you're an admin, so it stays free" : ""}.
            </p>
          </div>

          {/* Telegram — first-class connect card, not a toggle. Was on Settings; moved
              here because it's a capability, not an account preference. */}
          <section className="mb-6 p-5 rounded-xl border border-border bg-foreground/[0.02]">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-accent font-semibold">
                  Delivery channel
                </div>
                <h2 className="text-lg font-semibold mt-1">Telegram</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Chat with Paperloft on Telegram (@PaperloftAssistantBot) and receive
                  reminders / notifications there. One-time link — same account, both surfaces.
                </p>
              </div>
            </div>
            <TelegramConnect
              linkedUsername={telegramLink?.username ?? null}
              linkedFirstName={telegramLink?.firstName ?? null}
            />
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SKILLS.map((s) => (
              <SkillCard
                key={s.id}
                id={s.id}
                name={s.name}
                category={s.category}
                description={s.description}
                price={admin ? "Free (admin)" : s.price}
                needs={s.needs}
                publisher={s.publisher}
                initiallyEnabled={enabled.has(s.id)}
              />
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
