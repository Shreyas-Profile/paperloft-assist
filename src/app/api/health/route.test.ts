// Unit test for the pure folding logic in /api/health.
// The actual GET handler does IO (Prisma + fetch) so we don't cover
// that here — the point is to pin the DECISION about how subsystem
// statuses roll up into the overall status. Bad rollup → page shows
// green when it shouldn't, or vice versa.

import { describe, it, expect } from "vitest";

import { foldStatus } from "./route";

const ok = { status: "ok" as const };
const down = { status: "down" as const };
const degraded = { status: "degraded" as const };
const unconfigured = { status: "unconfigured" as const };

describe("foldStatus — subsystem rollup", () => {
  it("all ok → ok", () => {
    expect(
      foldStatus({ database: ok, telegramBot: ok, openrouter: ok }),
    ).toBe("ok");
  });

  it("DB down → whole site down (any other status ignored)", () => {
    expect(
      foldStatus({ database: down, telegramBot: ok, openrouter: ok }),
    ).toBe("down");
    expect(
      foldStatus({ database: down, telegramBot: down, openrouter: down }),
    ).toBe("down");
  });

  it("Telegram down but DB ok → degraded (site is up but bot broken)", () => {
    expect(
      foldStatus({ database: ok, telegramBot: down, openrouter: ok }),
    ).toBe("degraded");
  });

  it("Any single degraded → whole overall degraded", () => {
    expect(
      foldStatus({ database: ok, telegramBot: degraded, openrouter: ok }),
    ).toBe("degraded");
  });

  it("unconfigured doesn't count as bad", () => {
    // A subsystem being unconfigured (e.g. Telegram key not set in dev)
    // shouldn't make the whole site look degraded — it's a real state
    // for local dev, not an outage.
    expect(
      foldStatus({ database: ok, telegramBot: unconfigured, openrouter: ok }),
    ).toBe("ok");
  });
});
