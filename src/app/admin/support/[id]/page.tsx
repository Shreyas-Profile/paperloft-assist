// Ticket detail — /admin/support/:id. Admin-only.
//
// Shows the raw ticket body, the AI triage output, and status-transition
// buttons (open → in_progress → done / wont_fix). Retriage button asks
// the LLM to look at the ticket again — useful if the first pass was
// bad or if the ticket body has been edited.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell/app-shell";
import { TicketActions } from "./ticket-actions";

export const metadata = { title: "Admin — Ticket detail" };

interface TriageShape {
  category?: string;
  priority?: string;
  summary?: string;
  suggestedFiles?: string[];
  draftReply?: string;
  notes?: string;
}

export default async function AdminSupportDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) redirect("/");
  const { id } = await params;

  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) notFound();

  const triage = (ticket.aiTriage as TriageShape | null) ?? null;

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
          <div>
            <Link
              href="/admin/support"
              className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              ← All tickets
            </Link>
            <div className="flex items-baseline gap-3 mt-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                #{ticket.ticketNumber} — {ticket.title}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              From <span className="font-medium text-foreground">{ticket.submitterName}</span>
              {ticket.submitterEmail ? (
                <>
                  {" · "}
                  <a
                    href={`mailto:${ticket.submitterEmail}`}
                    className="underline hover:text-foreground"
                  >
                    {ticket.submitterEmail}
                  </a>
                </>
              ) : null}
              {" · "}
              {ticket.createdAt.toLocaleString()}
            </p>
          </div>

          <TicketActions
            ticketId={ticket.id}
            currentStatus={ticket.status}
            hasTriage={triage !== null}
          />

          <section className="rounded-lg border border-border bg-foreground/[0.02] p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Ticket body
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.body}
            </p>
          </section>

          <section className="rounded-lg border border-accent/30 bg-accent/[0.04] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest font-semibold text-accent">
                AI triage
              </span>
              <span className="text-xs text-muted-foreground">
                (suggestions — you decide)
              </span>
            </div>
            {triage === null ? (
              <p className="text-sm text-muted-foreground">
                Not triaged yet. Use the <em>Retriage</em> button above.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded border border-border">
                    category: <span className="font-medium">{triage.category}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded border border-border">
                    priority: <span className="font-medium">{triage.priority}</span>
                  </span>
                </div>
                {triage.summary ? (
                  <p className="italic">"{triage.summary}"</p>
                ) : null}
                {triage.suggestedFiles && triage.suggestedFiles.length > 0 ? (
                  <div>
                    <div className="font-medium mb-1">Suggested files:</div>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                      {triage.suggestedFiles.map((f) => (
                        <li key={f}>
                          <code className="text-xs bg-foreground/5 px-1 py-0.5 rounded">
                            {f}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {triage.draftReply ? (
                  <div>
                    <div className="font-medium mb-1">Draft reply:</div>
                    <p className="text-muted-foreground bg-background/50 border border-border/60 rounded p-3 text-sm whitespace-pre-wrap">
                      {triage.draftReply}
                    </p>
                  </div>
                ) : null}
                {triage.notes ? (
                  <div>
                    <div className="font-medium mb-1">Notes:</div>
                    <p className="text-muted-foreground">{triage.notes}</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
