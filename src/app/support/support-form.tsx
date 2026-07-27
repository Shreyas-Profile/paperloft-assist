"use client";

// Client component for the /support form. Handles the POST + success/error
// UX. Kept tiny so it's easy to reason about — the server component next
// door is the page shell.

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; ticketNumber: number }
  | { kind: "error"; message: string };

export function SupportForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, title, body }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ticketNumber?: number;
        error?: string;
      };
      if (!res.ok || !j.ticketNumber) {
        setState({
          kind: "error",
          message: j.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setState({ kind: "ok", ticketNumber: j.ticketNumber });
      setName("");
      setEmail("");
      setTitle("");
      setBody("");
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  if (state.kind === "ok") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-2">
        <div className="text-lg font-semibold">
          ✅ Ticket #{state.ticketNumber} submitted
        </div>
        <p className="text-sm text-muted-foreground">
          Thanks — I'll read it and reply as soon as I can. If you left
          your email, I'll respond there.
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          className="text-sm underline hover:text-foreground"
        >
          Submit another
        </button>
      </div>
    );
  }

  const submitting = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your name</span>
          <input
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="How I should refer to you"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            Email <span className="text-muted-foreground font-normal">(optional)</span>
          </span>
          <input
            type="email"
            maxLength={200}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Where I should reply"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Short title</span>
        <input
          type="text"
          required
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          placeholder='e.g. "Bot forgot my reminder after refresh"'
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">What happened / what do you want</span>
        <textarea
          required
          minLength={5}
          maxLength={4000}
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          placeholder="Include steps, what you expected, what actually happened. Timestamps help."
        />
      </label>

      {state.kind === "error" ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          Couldn't submit: {state.message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full sm:w-auto rounded-lg bg-foreground text-background text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit ticket"}
      </button>
    </form>
  );
}
