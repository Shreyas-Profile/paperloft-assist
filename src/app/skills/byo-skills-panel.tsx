"use client";

// BYO-skill panel — lives above the marketplace cards on /skills.
//
// UX:
//   - Add button opens a small inline form (name, url, headers JSON)
//   - On submit: POST /api/user-skills; toast success (with tool count) or error
//   - Existing skills listed with toggle + delete
//   - "Refresh" isn't shipped in v1 — user can delete + re-add to re-scan
//
// Headers input is a raw textarea. Users paste the JSON body of the
// `headers` field from a Claude Desktop config verbatim, e.g.
//   { "Authorization": "Bearer abc123" }

import { useState, useTransition } from "react";

interface Skill {
  id: string;
  name: string;
  mcpUrl: string;
  enabled: boolean;
  addedAt: string;
  toolCount: number;
}

export function ByoSkillsPanel({
  initial,
  max,
}: {
  initial: Skill[];
  max: number;
}) {
  const [skills, setSkills] = useState<Skill[]>(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState('{ "Authorization": "Bearer …" }');
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const atCap = skills.length >= max;

  const reset = () => {
    setName("");
    setUrl("");
    setHeaders('{ "Authorization": "Bearer …" }');
    setError(null);
    setSuccess(null);
  };

  const submit = () => {
    setError(null);
    setSuccess(null);
    let parsedHeaders: Record<string, string> = {};
    if (headers.trim()) {
      try {
        const j = JSON.parse(headers);
        if (!j || typeof j !== "object" || Array.isArray(j)) {
          throw new Error("headers must be a JSON object");
        }
        parsedHeaders = j as Record<string, string>;
      } catch (err) {
        setError(`headers isn't valid JSON: ${(err as Error).message}`);
        return;
      }
    }
    startTransition(async () => {
      const res = await fetch("/api/user-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mcpUrl: url, headers: parsedHeaders }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        skill?: Skill;
        error?: string;
        tools?: Array<{ name: string; description?: string }>;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.skill) {
        setSkills((s) => [data.skill!, ...s]);
        setSuccess(
          `Connected — ${data.tools?.length ?? 0} tool${data.tools?.length === 1 ? "" : "s"} discovered`,
        );
        reset();
        setOpen(false);
      }
    });
  };

  const toggle = (id: string, enabled: boolean) => {
    startTransition(async () => {
      const res = await fetch(`/api/user-skills/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setSkills((s) => s.map((x) => (x.id === id ? { ...x, enabled } : x)));
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Remove this skill? Its tools will disappear from your chats.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/user-skills/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSkills((s) => s.filter((x) => x.id !== id));
      }
    });
  };

  return (
    <section className="mb-8 p-5 rounded-xl border border-border bg-foreground/[0.02]">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-accent font-semibold">
            Your custom skills
          </div>
          <h2 className="text-lg font-semibold mt-1">
            Bring your own skill{" "}
            <span className="text-xs text-muted-foreground font-normal">
              ({skills.length}/{max})
            </span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Plug in any MCP server you have access to. Only you can see or use
            them. Whatever tool calls the assistant makes get forwarded to your
            server with your auth headers — only add servers you trust.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={atCap}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            + Add skill
          </button>
        )}
      </div>

      {success && (
        <div className="mb-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
          {success}
        </div>
      )}

      {open && (
        <div className="mb-4 p-4 rounded-lg border border-border bg-background/50 space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Name (lowercase, no spaces)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-jira"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              MCP URL
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/api/mcp"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Headers (JSON)
            </label>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
              disabled={busy}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Encrypted at rest. Never shown back in the UI. Leave <code>{"{}"}</code> if no auth needed.
            </p>
          </div>
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !name || !url}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect + save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={busy}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-foreground/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        !open && (
          <p className="text-sm text-muted-foreground italic">
            No custom skills yet.
          </p>
        )
      ) : (
        <ul className="space-y-2">
          {skills.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold truncate">
                    {s.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {s.toolCount} tool{s.toolCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate font-mono">
                  {s.mcpUrl}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                  disabled={busy}
                />
                {s.enabled ? "enabled" : "off"}
              </label>
              <button
                type="button"
                onClick={() => remove(s.id)}
                disabled={busy}
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-red-500 hover:border-red-500/40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
