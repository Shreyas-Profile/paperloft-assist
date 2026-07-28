// Public /status page. Server-side fetches /api/health and renders
// the JSON as human-readable ✅/❌ badges. No client-side JS needed.
//
// Two audiences:
//   - Real users during an outage: "is this me, or is Paperloft down?"
//   - Reviewers of the project: "look, there's a status page."
//
// Refreshes on every request (dynamic). If someone wants live updates,
// they can hit refresh — no auto-polling to keep the page cheap.

import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckStatus = "ok" | "degraded" | "down" | "unconfigured";

interface Check {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: CheckStatus;
  version: string;
  timestamp: string;
  checks: {
    database: Check;
    telegramBot: Check;
    openrouter: Check;
  };
}

const LABEL: Record<CheckStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unconfigured: "Not configured",
};

const STATUS_STYLE: Record<CheckStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  degraded: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  down: "bg-red-500/15 text-red-500 border-red-500/40",
  unconfigured: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/30",
};

const CHECK_LABEL: Record<string, string> = {
  database: "Database",
  telegramBot: "Telegram bot",
  openrouter: "LLM (OpenRouter)",
};

// Fetching /api/health from inside the server component uses the app's
// own origin. AUTH_URL is set for both dev + prod; falls back to
// localhost for the edge case where it isn't.
async function fetchHealth(): Promise<
  | { ok: true; data: HealthResponse }
  | { ok: false; error: string }
> {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/health`, {
      cache: "no-store",
      // Server-side; small window so the page doesn't hang if the
      // internal loopback misbehaves.
      signal: AbortSignal.timeout(6000),
    });
    // Even 503 means we got a valid JSON response.
    const body = (await res.json()) as HealthResponse;
    return { ok: true, data: body };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export const metadata = {
  title: "Status — Paperloft Assist",
  description: "Live health of paperloft.uk, the Telegram bot, and the LLM.",
};

export default async function StatusPage() {
  const result = await fetchHealth();

  if (!result.ok) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-14 bg-background text-foreground">
        <div className="max-w-lg w-full space-y-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Status check failed
          </h1>
          <p className="text-muted-foreground">
            The status endpoint didn't respond. If you're seeing this,
            the app itself is very likely broken — try refreshing in a
            minute or two, and if it persists,{" "}
            <Link href="/support" className="underline hover:text-foreground">
              file a support ticket
            </Link>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Detail: <code>{result.error}</code>
          </p>
        </div>
      </main>
    );
  }

  const { status, version, timestamp, checks } = result.data;

  return (
    <main className="min-h-screen flex items-start justify-center px-6 py-14 bg-background text-foreground">
      <div className="max-w-xl w-full space-y-8">
        <div className="space-y-3">
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to Paperloft
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            System status
          </h1>
          <div className="flex items-center gap-3 pt-2">
            <span
              className={`inline-block text-xs uppercase tracking-widest px-2.5 py-1 rounded border font-semibold ${STATUS_STYLE[status]}`}
            >
              {LABEL[status]}
            </span>
            <span className="text-sm text-muted-foreground">
              overall
            </span>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            As of {new Date(timestamp).toLocaleString()} · version {version}
          </p>
        </div>

        <ul className="space-y-2">
          {Object.entries(checks).map(([key, check]) => (
            <li
              key={key}
              className="flex items-center justify-between p-4 rounded-lg border border-border/60 bg-foreground/[0.02]"
            >
              <div className="flex flex-col gap-1">
                <div className="font-medium">
                  {CHECK_LABEL[key] ?? key}
                </div>
                {check.detail ? (
                  <div className="text-xs text-muted-foreground">
                    {check.detail}
                    {typeof check.latencyMs === "number" ? (
                      <> · {check.latencyMs} ms</>
                    ) : null}
                  </div>
                ) : typeof check.latencyMs === "number" ? (
                  <div className="text-xs text-muted-foreground">
                    {check.latencyMs} ms
                  </div>
                ) : null}
              </div>
              <span
                className={`inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border font-semibold shrink-0 ${STATUS_STYLE[check.status]}`}
              >
                {LABEL[check.status]}
              </span>
            </li>
          ))}
        </ul>

        <div className="text-xs text-muted-foreground border-t border-border/60 pt-4 space-y-1">
          <p>
            Machine-readable version at{" "}
            <a
              href="/api/health"
              className="underline hover:text-foreground"
            >
              /api/health
            </a>
            .
          </p>
          <p>
            Something looking wrong that this page says is fine?{" "}
            <Link href="/support" className="underline hover:text-foreground">
              File a ticket
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
