import type { Recurrence } from "./types";

const DAY_TOKENS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const FIXED_RULES = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

const EVERY_RE = /^every:(\d+)([mh])$/;

/**
 * Add `months` to `d`, clamping the day to the target month's last day if the
 * source day doesn't exist there. Fixes the JS `setMonth` overflow bug
 * (Jan 31 + 1 month → Mar 3 instead of Feb 28/29).
 *
 * All arithmetic is in UTC — using local setters caused a 1-hour drift on
 * hosts that cross a DST boundary between `d` and the target month.
 */
function addMonthsClamped(d: Date, months: number): Date {
  const target = new Date(d);
  const originalDay = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(originalDay, lastDay));
  return target;
}

/** Compute the next scheduled time given a current one and a recurrence rule. */
export function nextOccurrence(from: Date, rule: Recurrence): Date | null {
  if (rule === "none") return null;
  const d = new Date(from);

  // Interval forms: "every:15m", "every:2h"
  if (typeof rule === "string" && rule.startsWith("every:")) {
    const m = EVERY_RE.exec(rule);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (n <= 0) return null;
    if (m[2] === "m") return new Date(d.getTime() + n * 60_000);
    return new Date(d.getTime() + n * 3_600_000);
  }

  // Weekly with explicit day picker: "weekly:mon,wed,fri"
  if (typeof rule === "string" && rule.startsWith("weekly:")) {
    const days = rule
      .slice(7)
      .split(",")
      .map((s) => DAY_TOKENS[s.trim().toLowerCase()])
      .filter((n): n is number => typeof n === "number");
    if (days.length === 0) return null;
    for (let i = 1; i <= 7; i++) {
      const cand = new Date(d);
      cand.setUTCDate(cand.getUTCDate() + i);
      if (days.includes(cand.getUTCDay())) return cand;
    }
    return null;
  }

  if (typeof rule === "string") {
    switch (rule) {
      case "hourly":
        d.setUTCHours(d.getUTCHours() + 1);
        return d;
      case "daily":
        d.setUTCDate(d.getUTCDate() + 1);
        return d;
      case "weekdays": {
        d.setUTCDate(d.getUTCDate() + 1);
        while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return d;
      }
      case "weekly":
        d.setUTCDate(d.getUTCDate() + 7);
        return d;
      case "monthly":
        return addMonthsClamped(d, 1);
      case "quarterly":
        return addMonthsClamped(d, 3);
      case "yearly":
        return addMonthsClamped(d, 12);
    }
  }

  // cron object — v1 not supported; return null so host can log and skip
  if (typeof rule === "object" && rule && "cron" in rule) return null;
  return null;
}

/** Parse a recurrence value from the DB (string) into the union type. */
export function parseRecurrence(s: string | null | undefined): Recurrence {
  if (!s || s === "none") return "none";
  if (s.startsWith("cron:")) return { cron: s.slice(5) };
  if (s.startsWith("every:") && EVERY_RE.test(s)) return s as Recurrence;
  if (s.startsWith("weekly:")) {
    const days = s
      .slice(7)
      .split(",")
      .map((x) => x.trim().toLowerCase());
    if (days.length > 0 && days.every((d) => d in DAY_TOKENS)) return s as Recurrence;
    return "none";
  }
  if ((FIXED_RULES as readonly string[]).includes(s)) {
    return s as Recurrence;
  }
  return "none";
}

/** Serialize a recurrence for DB storage. */
export function serializeRecurrence(r: Recurrence): string {
  if (typeof r === "object" && r && "cron" in r) return `cron:${r.cron}`;
  return r as string;
}

/**
 * True iff `s` is a recurrence rule the scheduler can actually roll forward.
 * Used by tool-input validation so we reject unknown strings at the LLM boundary.
 *
 * Rules:
 *   - Fixed: none | hourly | daily | weekdays | weekly | monthly | quarterly | yearly
 *   - Interval: every:<N>m (N >= 5) | every:<N>h (N >= 1)
 *   - Weekly by day: weekly:<day>[,<day>...] where day ∈ sun/mon/tue/wed/thu/fri/sat
 */
export function isValidRecurrence(s: string): boolean {
  if (s === "none") return true;
  if ((FIXED_RULES as readonly string[]).includes(s)) return true;
  const m = EVERY_RE.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    if (m[2] === "m") return n >= 5;
    return n >= 1;
  }
  if (s.startsWith("weekly:")) {
    const days = s
      .slice(7)
      .split(",")
      .map((x) => x.trim().toLowerCase());
    return days.length > 0 && days.every((d) => d in DAY_TOKENS);
  }
  return false;
}
