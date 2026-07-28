// GET /api/health — public health probe. Two consumers:
//   1. UptimeRobot (or similar) pings this every ~5 min and pages
//      Shreyas if the response isn't 200.
//   2. /status renders the JSON body as ✅/❌ badges for humans.
//
// Response shape is intentionally stable — external monitors are
// harder to migrate than internal callers, so treat this like a
// public API.
//
// Status codes:
//   200 — all subsystems ok (or degraded but site is functionally up)
//   503 — DB is down (site is genuinely broken)
// Never 500 — always render the JSON so /status can show detail.

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

// Skip Next.js's route cache — health must always run fresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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

const APP_VERSION = process.env.npm_package_version ?? "0.2.0";

// Cheap-ish external calls. Both have a small window to respond;
// we don't want /status to hang the page for 30 seconds because
// Telegram is slow.
const PROBE_TIMEOUT_MS = 4000;

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message.slice(0, 200) : "query failed",
    };
  }
}

async function checkTelegramBot(): Promise<Check> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { status: "unconfigured", detail: "TELEGRAM_BOT_TOKEN missing" };
  const started = Date.now();
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
      // We don't want a stale answer from any intermediary.
      cache: "no-store",
    });
    clearTimeout(to);
    if (!res.ok) {
      return {
        status: "down",
        latencyMs: Date.now() - started,
        detail: `HTTP ${res.status}`,
      };
    }
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.name : "fetch failed",
    };
  }
}

// OpenRouter has no free-tier health endpoint — every request costs
// credits — so we check config only. Genuine outages will surface as
// chat replies failing; that's what tests + Telegram acks catch.
function checkOpenRouter(): Check {
  return process.env.OPENROUTER_API_KEY
    ? { status: "ok", detail: "config only — no live ping" }
    : { status: "unconfigured", detail: "OPENROUTER_API_KEY missing" };
}

/**
 * Fold subsystem statuses into an overall status.
 * DB down → whole site down.
 * Anything else down or degraded → site degraded.
 * All ok/unconfigured → ok.
 * Exported for unit testing.
 */
export function foldStatus(checks: HealthResponse["checks"]): CheckStatus {
  if (checks.database.status === "down") return "down";
  const values = Object.values(checks);
  if (values.some((c) => c.status === "down" || c.status === "degraded")) {
    return "degraded";
  }
  return "ok";
}

export async function GET() {
  const [database, telegramBot] = await Promise.all([
    checkDatabase(),
    checkTelegramBot(),
  ]);
  const openrouter = checkOpenRouter();

  const checks = { database, telegramBot, openrouter };
  const overall = foldStatus(checks);

  const body: HealthResponse = {
    status: overall,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    checks,
  };

  // 503 only when DB is down — that's the "site is broken" case
  // UptimeRobot should page on. Degraded still returns 200 because
  // the site itself is reachable.
  const httpCode = overall === "down" ? 503 : 200;
  return NextResponse.json(body, { status: httpCode });
}
