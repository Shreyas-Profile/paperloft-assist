// Unit tests for the recurrence engine — pure functions, no DB needed.
// Every case here is anchored to a real scenario the LLM is expected to hit
// via natural-language reminder requests.

import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  parseRecurrence,
  serializeRecurrence,
  isValidRecurrence,
} from "./recurrence";
import type { Recurrence } from "./types";

describe("nextOccurrence — fixed rules", () => {
  const base = new Date("2026-03-15T09:00:00Z"); // a Sunday

  it("returns null for 'none'", () => {
    expect(nextOccurrence(base, "none")).toBeNull();
  });

  it("adds one hour for 'hourly'", () => {
    const n = nextOccurrence(base, "hourly")!;
    expect(n.toISOString()).toBe("2026-03-15T10:00:00.000Z");
  });

  it("adds one day for 'daily'", () => {
    const n = nextOccurrence(base, "daily")!;
    expect(n.toISOString()).toBe("2026-03-16T09:00:00.000Z");
  });

  it("skips weekend for 'weekdays' from Friday", () => {
    const fri = new Date("2026-03-13T09:00:00Z");
    const n = nextOccurrence(fri, "weekdays")!;
    expect(n.getUTCDay()).toBe(1); // Monday
    expect(n.toISOString()).toBe("2026-03-16T09:00:00.000Z");
  });

  it("adds 7 days for 'weekly'", () => {
    const n = nextOccurrence(base, "weekly")!;
    expect(n.toISOString()).toBe("2026-03-22T09:00:00.000Z");
  });

  it("adds one month for 'monthly'", () => {
    const n = nextOccurrence(base, "monthly")!;
    expect(n.toISOString()).toBe("2026-04-15T09:00:00.000Z");
  });

  it("adds three months for 'quarterly'", () => {
    const n = nextOccurrence(base, "quarterly")!;
    expect(n.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });

  it("adds one year for 'yearly'", () => {
    const n = nextOccurrence(base, "yearly")!;
    expect(n.toISOString()).toBe("2027-03-15T09:00:00.000Z");
  });
});

describe("nextOccurrence — month-end clamping (Jan 31 bug)", () => {
  it("clamps monthly Jan 31 → Feb 28 in non-leap year", () => {
    const jan31 = new Date("2027-01-31T09:00:00Z"); // 2027 not a leap year
    const n = nextOccurrence(jan31, "monthly")!;
    expect(n.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });

  it("clamps monthly Jan 31 → Feb 29 in leap year", () => {
    const jan31 = new Date("2028-01-31T09:00:00Z"); // 2028 is a leap year
    const n = nextOccurrence(jan31, "monthly")!;
    expect(n.toISOString()).toBe("2028-02-29T09:00:00.000Z");
  });

  it("clamps monthly Mar 31 → Apr 30", () => {
    const mar31 = new Date("2026-03-31T09:00:00Z");
    const n = nextOccurrence(mar31, "monthly")!;
    expect(n.toISOString()).toBe("2026-04-30T09:00:00.000Z");
  });

  it("clamps quarterly May 31 → Aug 31 (both have 31 days)", () => {
    const may31 = new Date("2026-05-31T09:00:00Z");
    const n = nextOccurrence(may31, "quarterly")!;
    expect(n.toISOString()).toBe("2026-08-31T09:00:00.000Z");
  });

  it("clamps quarterly Nov 30 → Feb 28 next year", () => {
    const nov30 = new Date("2026-11-30T09:00:00Z");
    const n = nextOccurrence(nov30, "quarterly")!;
    expect(n.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });

  it("clamps yearly Feb 29 → Feb 28 in following non-leap year", () => {
    const feb29 = new Date("2028-02-29T09:00:00Z");
    const n = nextOccurrence(feb29, "yearly")!;
    expect(n.toISOString()).toBe("2029-02-28T09:00:00.000Z");
  });
});

describe("nextOccurrence — every:Nm / every:Nh interval rules", () => {
  const base = new Date("2026-03-15T09:00:00Z");

  it("every:15m adds 15 minutes", () => {
    const n = nextOccurrence(base, "every:15m")!;
    expect(n.toISOString()).toBe("2026-03-15T09:15:00.000Z");
  });

  it("every:30m adds 30 minutes", () => {
    const n = nextOccurrence(base, "every:30m")!;
    expect(n.toISOString()).toBe("2026-03-15T09:30:00.000Z");
  });

  it("every:2h adds 2 hours", () => {
    const n = nextOccurrence(base, "every:2h")!;
    expect(n.toISOString()).toBe("2026-03-15T11:00:00.000Z");
  });

  it("every:6h adds 6 hours", () => {
    const n = nextOccurrence(base, "every:6h")!;
    expect(n.toISOString()).toBe("2026-03-15T15:00:00.000Z");
  });

  it("every:0m is rejected (returns null via nextOccurrence)", () => {
    // isValidRecurrence catches this at the tool boundary, but nextOccurrence
    // must also degrade safely if a bad string somehow reaches the scheduler.
    expect(nextOccurrence(base, "every:0m" as Recurrence)).toBeNull();
  });

  it("malformed every: string returns null", () => {
    expect(nextOccurrence(base, "every:15" as Recurrence)).toBeNull();
    expect(nextOccurrence(base, "every:m" as Recurrence)).toBeNull();
    expect(nextOccurrence(base, "every:abcm" as Recurrence)).toBeNull();
  });
});

describe("nextOccurrence — weekly:days picker", () => {
  // Sunday 2026-03-15 09:00 UTC — from Sunday we can predict every day easily.
  const sun = new Date("2026-03-15T09:00:00Z");

  it("weekly:mon from Sunday → next day (Monday)", () => {
    const n = nextOccurrence(sun, "weekly:mon")!;
    expect(n.getUTCDay()).toBe(1);
    expect(n.toISOString()).toBe("2026-03-16T09:00:00.000Z");
  });

  it("weekly:wed from Sunday → 3 days later (Wednesday)", () => {
    const n = nextOccurrence(sun, "weekly:wed")!;
    expect(n.getUTCDay()).toBe(3);
    expect(n.toISOString()).toBe("2026-03-18T09:00:00.000Z");
  });

  it("weekly:mon,wed,fri from Sunday → Monday (nearest)", () => {
    const n = nextOccurrence(sun, "weekly:mon,wed,fri")!;
    expect(n.getUTCDay()).toBe(1);
  });

  it("weekly:mon,wed,fri from Tuesday → Wednesday", () => {
    const tue = new Date("2026-03-17T09:00:00Z"); // Tuesday
    const n = nextOccurrence(tue, "weekly:mon,wed,fri")!;
    expect(n.getUTCDay()).toBe(3);
  });

  it("weekly:mon,wed,fri from Wednesday → Friday (not same day)", () => {
    const wed = new Date("2026-03-18T09:00:00Z");
    const n = nextOccurrence(wed, "weekly:mon,wed,fri")!;
    expect(n.getUTCDay()).toBe(5);
  });

  it("weekly:mon,wed,fri from Saturday → Monday (wraps week)", () => {
    const sat = new Date("2026-03-21T09:00:00Z");
    const n = nextOccurrence(sat, "weekly:mon,wed,fri")!;
    expect(n.getUTCDay()).toBe(1);
  });

  it("weekly:sat,sun from Wednesday → Saturday", () => {
    const wed = new Date("2026-03-18T09:00:00Z");
    const n = nextOccurrence(wed, "weekly:sat,sun")!;
    expect(n.getUTCDay()).toBe(6);
  });

  it("weekly with no valid days returns null", () => {
    expect(nextOccurrence(sun, "weekly:" as Recurrence)).toBeNull();
    expect(nextOccurrence(sun, "weekly:xxx" as Recurrence)).toBeNull();
  });
});

describe("nextOccurrence — cron object (v1 unsupported)", () => {
  it("returns null for { cron: <expr> }", () => {
    expect(nextOccurrence(new Date(), { cron: "*/5 * * * *" })).toBeNull();
  });
});

describe("parseRecurrence / serializeRecurrence round-trip", () => {
  const cases: Array<[string, Recurrence]> = [
    ["none", "none"],
    ["hourly", "hourly"],
    ["daily", "daily"],
    ["weekdays", "weekdays"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
    ["quarterly", "quarterly"],
    ["yearly", "yearly"],
    ["every:15m", "every:15m"],
    ["every:2h", "every:2h"],
    ["weekly:wed", "weekly:wed"],
    ["weekly:mon,wed,fri", "weekly:mon,wed,fri"],
  ];
  for (const [stored, expected] of cases) {
    it(`round-trips "${stored}"`, () => {
      const parsed = parseRecurrence(stored);
      expect(parsed).toEqual(expected);
      expect(serializeRecurrence(parsed)).toBe(stored);
    });
  }

  it("parses cron:<expr> to object shape", () => {
    expect(parseRecurrence("cron:*/5 * * * *")).toEqual({ cron: "*/5 * * * *" });
    expect(serializeRecurrence({ cron: "*/5 * * * *" })).toBe("cron:*/5 * * * *");
  });

  it("degrades unknown strings to 'none'", () => {
    expect(parseRecurrence("something-weird")).toBe("none");
    expect(parseRecurrence("weekly:notaday")).toBe("none");
    expect(parseRecurrence(null)).toBe("none");
    expect(parseRecurrence(undefined)).toBe("none");
    expect(parseRecurrence("")).toBe("none");
  });
});

describe("isValidRecurrence — tool-boundary validation", () => {
  it("accepts every fixed rule", () => {
    for (const r of [
      "none",
      "hourly",
      "daily",
      "weekdays",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
    ]) {
      expect(isValidRecurrence(r)).toBe(true);
    }
  });

  it("accepts every:Nm where N >= 5", () => {
    expect(isValidRecurrence("every:5m")).toBe(true);
    expect(isValidRecurrence("every:15m")).toBe(true);
    expect(isValidRecurrence("every:60m")).toBe(true);
    expect(isValidRecurrence("every:1440m")).toBe(true);
  });

  it("rejects every:Nm where N < 5 (scheduler floor)", () => {
    expect(isValidRecurrence("every:1m")).toBe(false);
    expect(isValidRecurrence("every:4m")).toBe(false);
    expect(isValidRecurrence("every:0m")).toBe(false);
  });

  it("accepts every:Nh where N >= 1", () => {
    expect(isValidRecurrence("every:1h")).toBe(true);
    expect(isValidRecurrence("every:2h")).toBe(true);
    expect(isValidRecurrence("every:24h")).toBe(true);
  });

  it("rejects malformed every: strings", () => {
    expect(isValidRecurrence("every:5")).toBe(false);
    expect(isValidRecurrence("every:h")).toBe(false);
    expect(isValidRecurrence("every:")).toBe(false);
    expect(isValidRecurrence("every:5d")).toBe(false);
    expect(isValidRecurrence("every:-1h")).toBe(false);
  });

  it("accepts weekly: with valid day tokens", () => {
    expect(isValidRecurrence("weekly:mon")).toBe(true);
    expect(isValidRecurrence("weekly:sat,sun")).toBe(true);
    expect(isValidRecurrence("weekly:mon,tue,wed,thu,fri,sat,sun")).toBe(true);
  });

  it("rejects weekly: with invalid tokens", () => {
    expect(isValidRecurrence("weekly:")).toBe(false);
    expect(isValidRecurrence("weekly:xxx")).toBe(false);
    expect(isValidRecurrence("weekly:mon,xxx")).toBe(false);
    expect(isValidRecurrence("weekly:monday")).toBe(false); // must be 3-letter form
  });

  it("rejects arbitrary strings", () => {
    expect(isValidRecurrence("bi-weekly")).toBe(false);
    expect(isValidRecurrence("every-other-day")).toBe(false);
    expect(isValidRecurrence("")).toBe(false);
    expect(isValidRecurrence("cron:*/5 * * * *")).toBe(false); // cron not exposed
  });
});
