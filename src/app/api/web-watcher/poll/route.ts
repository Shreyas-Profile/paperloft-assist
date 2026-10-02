// POST or GET /api/web-watcher/poll
//
// Runs one poll cycle: fetches every active WebWatcher whose next scheduled
// check is due, diffs each against its last snapshot, and DMs the owner on
// Telegram if anything changed.
//
// Auth: a shared bearer secret (WEB_WATCHER_POLL_SECRET). Pass it as
//   Authorization: Bearer <secret>
// — matched by any trigger: a hosted cron-mcp job (recommended, 15-minute
// cadence), an internal paperloft cron, or an on-demand admin test.
//
// Returns { ok, scanned, results: PollResult[] } with up to ~100 result rows.

import { NextRequest, NextResponse } from "next/server";
import { pollDue } from "@/lib/hosted-web-watcher";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.WEB_WATCHER_POLL_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function runPoll(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const t0 = Date.now();
  const results = await pollDue();
  return NextResponse.json({
    ok: true,
    scanned: results.length,
    ms: Date.now() - t0,
    results,
  });
}

export async function GET(req: NextRequest) {
  return runPoll(req);
}

export async function POST(req: NextRequest) {
  return runPoll(req);
}
