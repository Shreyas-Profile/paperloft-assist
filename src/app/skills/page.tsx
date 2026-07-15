// Skills marketplace. Every skill Alpha Assist can run OR that you can plug
// into any MCP-compatible client (Claude Desktop, Cursor, this app) is
// listed here as a card with pricing. Native skills run inside Alpha Assist;
// external skills live on separate hosted URLs (all under regiq.in) and are
// linked out. Later this becomes the Hetchnar marketplace with per-skill
// subscriptions.

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { isAdmin } from "@/lib/admin";
import { Check, ExternalLink } from "lucide-react";

type SkillEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: string;
  status: "available" | "beta" | "soon";
  needs?: string;
  // External MCP skills (live at their own URL, plug into any MCP client)
  // rather than running inside Alpha Assist itself.
  external?: {
    url: string;
    publisher: string;
  };
};

const SKILLS: SkillEntry[] = [
  {
    id: "telegram_mcp",
    name: "Telegram bridge",
    category: "External MCP · Globalion",
    description:
      "Bidirectional Telegram ⇆ agent bridge. Message your Telegram bot; your MCP-connected agent pulls the message, thinks, and pushes a reply back. No LLM in the platform.",
    price: "Free",
    status: "available",
    needs: "Google or GitHub sign-in + a BotFather token",
    external: {
      url: "https://telegram.regiq.in",
      publisher: "Globalion (Shreyas)",
    },
  },
  {
    id: "video_render_mcp",
    name: "Video render",
    category: "External MCP · Globalion",
    description:
      "Turns a script into a Hyperplexed-style motion-graphics MP4. Free voice via Microsoft Edge Neural TTS, Remotion-powered animation, no watermark.",
    price: "Free (20/day)",
    status: "available",
    needs: "Google sign-in",
    external: {
      url: "https://video-render.regiq.in",
      publisher: "Globalion (Pawan)",
    },
  },
];

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const admin = isAdmin(session.user.email);

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-10">
            <div className="text-xs uppercase tracking-widest text-accent font-semibold">
              Skills
            </div>
            <h1 className="text-3xl font-semibold tracking-tight mt-2">
              What Alpha Assist can do.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl">
              Native skills run inside Alpha Assist. External skills are
              hosted MCP servers you can plug into Claude Desktop, Cursor, or
              any other MCP client. Everything below is free during beta
              {admin ? " — and you're an admin, so it stays free" : ""}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SKILLS.map((s) => (
              <SkillCard key={s.id} skill={s} admin={admin} />
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function SkillCard({ skill, admin }: { skill: SkillEntry; admin: boolean }) {
  const enabled = skill.status !== "soon";
  const external = skill.external;
  return (
    <div
      className={`p-5 rounded-xl border transition ${
        enabled
          ? "border-border bg-foreground/[0.02] hover:bg-foreground/[0.04]"
          : "border-border/60 bg-foreground/[0.01] opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          {skill.category}
        </div>
        <StatusPill status={skill.status} />
      </div>
      <h3 className="font-semibold text-lg">{skill.name}</h3>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        {skill.description}
      </p>
      {skill.needs ? (
        <div className="text-xs text-muted-foreground mt-3">
          Requires: <span className="text-foreground">{skill.needs}</span>
        </div>
      ) : null}
      {external ? (
        <div className="text-xs text-muted-foreground mt-1">
          Published by <span className="text-foreground">{external.publisher}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between mt-5">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold">
            {admin ? "Free (admin)" : skill.price}
          </span>
        </div>
        {external && enabled ? (
          <a
            href={external.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-accent flex items-center gap-1.5 hover:underline"
          >
            Open <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : enabled ? (
          <div className="text-xs font-medium text-accent flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Enabled
          </div>
        ) : (
          <button
            type="button"
            disabled
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground cursor-not-allowed"
          >
            Coming soon
          </button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: SkillEntry["status"] }) {
  const map = {
    available: { label: "Available", cls: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
    beta: { label: "Beta", cls: "text-accent border-accent/40 bg-accent/10" },
    soon: { label: "Coming soon", cls: "text-muted-foreground border-border/60 bg-foreground/[0.03]" },
  } as const;
  const { label, cls } = map[status];
  return (
    <div className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </div>
  );
}
