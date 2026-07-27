"use client";

// Client-side status-transition buttons for a support ticket.
// Simple POSTs to /api/admin/support/:id — the endpoint enforces the
// admin check server-side; this UI just triggers requests and reloads.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const STATUS_BUTTONS: Array<{ target: string; label: string; style: string }> = [
  { target: "in_progress", label: "Mark in progress", style: "bg-sky-500/15 text-sky-500 border-sky-500/40" },
  { target: "done", label: "Mark done", style: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" },
  { target: "wont_fix", label: "Won't fix", style: "bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30" },
  { target: "open", label: "Reopen", style: "bg-accent/15 text-accent border-accent/40" },
];

export function TicketActions({
  ticketId,
  currentStatus,
  hasTriage,
}: {
  ticketId: string;
  currentStatus: string;
  hasTriage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function apply(action: {
    kind: "status";
    status: string;
  } | { kind: "retriage" }) {
    setError(null);
    try {
      const body =
        action.kind === "status" ? { status: action.status } : { retriage: true };
      const res = await fetch(`/api/admin/support/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  const visibleButtons = STATUS_BUTTONS.filter((b) => b.target !== currentStatus);

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {visibleButtons.map((b) => (
        <button
          key={b.target}
          type="button"
          disabled={pending}
          onClick={() => apply({ kind: "status", status: b.target })}
          className={`text-xs uppercase tracking-widest font-semibold px-3 py-1.5 rounded border transition disabled:opacity-50 hover:opacity-90 ${b.style}`}
        >
          {b.label}
        </button>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={() => apply({ kind: "retriage" })}
        className="text-xs uppercase tracking-widest font-semibold px-3 py-1.5 rounded border border-border hover:bg-foreground/5 transition disabled:opacity-50"
      >
        {hasTriage ? "Retriage" : "Triage now"}
      </button>
      {error ? (
        <span className="text-xs text-red-500">Failed: {error}</span>
      ) : null}
    </div>
  );
}
