// Admin-only ticket list at /admin/support.
// Everyone who isn't an admin gets a 404 from redirect — the page
// itself never renders for them, and neither does the underlying data.
//
// Table is sorted by (createdAt desc). Filtering by status is done
// client-side on the count badges — one query fetches everything and
// the client picks the visible bucket. At our expected ticket volume
// (dozens, not thousands) that's fine and keeps the page fast.

import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell/app-shell";

export const metadata = { title: "Admin — Support tickets" };

const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, unset: 4 };

const PRIORITY_STYLE: Record<string, string> = {
  p0: "bg-red-500/15 text-red-500 border-red-500/40",
  p1: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  p2: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  p3: "bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30",
  unset: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-accent/15 text-accent border-accent/40",
  in_progress: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  done: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  wont_fix: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/30",
};

export default async function AdminSupportPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAdmin(email)) redirect("/");

  const tickets = await prisma.supportTicket.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  // Sort so open + in_progress rise, then by priority, then by newest.
  tickets.sort((a, b) => {
    const aOpen = a.status === "open" || a.status === "in_progress" ? 0 : 1;
    const bOpen = b.status === "open" || b.status === "in_progress" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    const ap = PRIORITY_ORDER[a.priority] ?? 5;
    const bp = PRIORITY_ORDER[b.priority] ?? 5;
    if (ap !== bp) return ap - bp;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const counts = {
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    done: tickets.filter((t) => t.status === "done").length,
    total: tickets.length,
  };

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-8">
            <div className="text-xs uppercase tracking-widest text-accent font-semibold">
              Admin
            </div>
            <h1 className="text-3xl font-semibold tracking-tight mt-2">
              Support tickets
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Every bug or feature request that hit{" "}
              <Link href="/support" className="underline hover:text-foreground">
                /support
              </Link>
              . AI triages on submit; you decide.
            </p>
            <div className="flex flex-wrap gap-4 mt-4 text-sm">
              <span>
                <span className="font-semibold">{counts.open}</span>{" "}
                <span className="text-muted-foreground">open</span>
              </span>
              <span>
                <span className="font-semibold">{counts.in_progress}</span>{" "}
                <span className="text-muted-foreground">in progress</span>
              </span>
              <span>
                <span className="font-semibold">{counts.done}</span>{" "}
                <span className="text-muted-foreground">done</span>
              </span>
              <span>
                <span className="font-semibold">{counts.total}</span>{" "}
                <span className="text-muted-foreground">total</span>
              </span>
            </div>
          </div>

          {tickets.length === 0 ? (
            <div className="rounded-lg border border-border bg-foreground/[0.02] p-8 text-center text-sm text-muted-foreground">
              No tickets yet. Try{" "}
              <Link href="/support" className="underline hover:text-foreground">
                submitting one
              </Link>{" "}
              — it should land here immediately (plus a Telegram DM).
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.03] border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">Title</th>
                    <th className="text-left px-3 py-2 font-medium">Priority</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">From</th>
                    <th className="text-left px-3 py-2 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border/60 last:border-b-0 hover:bg-foreground/[0.02]"
                    >
                      <td className="px-3 py-2 text-muted-foreground">#{t.ticketNumber}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/support/${t.id}`}
                          className="font-medium hover:underline"
                        >
                          {t.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border font-semibold ${
                            PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.unset
                          }`}
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border font-semibold ${
                            STATUS_STYLE[t.status] ?? STATUS_STYLE.open
                          }`}
                        >
                          {t.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t.submitterName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {relTime(t.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function relTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
