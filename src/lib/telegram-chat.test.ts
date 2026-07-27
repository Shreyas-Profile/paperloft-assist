// Unit tests for the pure helpers extracted from telegram-chat.ts.
// Every test here is anchored to a real bug we've hit in production —
// this file exists specifically so those bugs cannot regress silently.

import { describe, it, expect } from "vitest";

import {
  REMINDER_CLAIM_RE,
  OFFER_LANGUAGE_RE,
  sliceRecentMessages,
  buildThinReplySummary,
} from "./telegram-chat";

describe("REMINDER_CLAIM_RE — hallucination detector", () => {
  // Positive matches — these are the M REVATI-style bad turns where the
  // model CLAIMS a reminder is set/created/etc. without actually calling
  // the tool. Detector MUST fire so the retry kicks in.
  it("matches unambiguous first-person past-tense claims", () => {
    expect(REMINDER_CLAIM_RE.test("I've set the reminder for 8pm")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("I have scheduled a reminder for tomorrow")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("Done! I've created a reminder")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("I've cancelled that reminder for you")).toBe(true);
  });

  it("matches 'reminder is set / has been scheduled' style claims", () => {
    expect(REMINDER_CLAIM_RE.test("Reminder is set for tomorrow at 9am")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("Reminder has been scheduled")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("Reminder is cancelled — you're all clear")).toBe(true);
  });

  it("matches the ✅-prefixed emoji claim (the exact M REVATI phrasing)", () => {
    expect(REMINDER_CLAIM_RE.test("✅ Reminder set")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("✅ Reminder created — see you at 9")).toBe(true);
  });

  it("matches 'I'll remind you at/in/on ...' phrasing", () => {
    expect(REMINDER_CLAIM_RE.test("I'll remind you at 8pm tomorrow")).toBe(true);
    expect(REMINDER_CLAIM_RE.test("I'll remind you every Monday")).toBe(true);
  });

  // Negative matches — earlier looser patterns misfired on these three
  // shapes and produced pointless retry calls. Detector MUST NOT fire.
  it("does NOT match offers ('want me to set...?')", () => {
    expect(
      REMINDER_CLAIM_RE.test(
        "Want me to set up reminders for the medications from that prescription?",
      ),
    ).toBe(false);
    expect(REMINDER_CLAIM_RE.test("Would you like me to schedule that reminder?")).toBe(
      false,
    );
  });

  it("does NOT match 'you're all set with that reminder' (idiom, not verb)", () => {
    expect(
      REMINDER_CLAIM_RE.test(
        "Great! So you're all set with that appointment reminder for 12 August.",
      ),
    ).toBe(false);
  });

  it("does NOT match mentions of a reminder in passing", () => {
    expect(REMINDER_CLAIM_RE.test("adjust the appointment reminder if you want")).toBe(
      false,
    );
    expect(REMINDER_CLAIM_RE.test("Your reminders are: X, Y, Z.")).toBe(false);
    expect(
      REMINDER_CLAIM_RE.test("The furthest one is your Dr Sharma appointment."),
    ).toBe(false);
  });
});

describe("OFFER_LANGUAGE_RE — offer/question guard", () => {
  it("matches the common offer phrasings the model uses", () => {
    expect(OFFER_LANGUAGE_RE.test("Want me to set a reminder for 8pm?")).toBe(true);
    expect(OFFER_LANGUAGE_RE.test("Would you like me to schedule that?")).toBe(true);
    expect(OFFER_LANGUAGE_RE.test("Shall I create a daily reminder?")).toBe(true);
    expect(OFFER_LANGUAGE_RE.test("Should I add one for tomorrow?")).toBe(true);
    expect(OFFER_LANGUAGE_RE.test("Do you want me to cancel the old one?")).toBe(true);
    expect(OFFER_LANGUAGE_RE.test("Can I schedule that for you?")).toBe(true);
  });

  it("does NOT match plain statements", () => {
    expect(OFFER_LANGUAGE_RE.test("I've set the reminder for 8pm.")).toBe(false);
    expect(OFFER_LANGUAGE_RE.test("Your reminder is set.")).toBe(false);
  });
});

describe("sliceRecentMessages — history slice", () => {
  // The real bug: `findMany orderBy asc take 20` returned the OLDEST 20
  // messages, so any conversation past 20 lost recent context. This helper
  // mirrors what the fixed query does; keeping it as a pure function so a
  // similar mistake can't drift back in.
  const msgs = Array.from({ length: 30 }, (_, i) => `msg-${i}`);

  it("returns the last N in original order when history exceeds limit", () => {
    const out = sliceRecentMessages(msgs, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe("msg-20");
    expect(out[9]).toBe("msg-29");
  });

  it("returns everything (unchanged order) when history is <= limit", () => {
    const short = msgs.slice(0, 5);
    expect(sliceRecentMessages(short, 10)).toEqual(short);
  });

  it("returns [] for a non-positive limit", () => {
    expect(sliceRecentMessages(msgs, 0)).toEqual([]);
    expect(sliceRecentMessages(msgs, -3)).toEqual([]);
  });
});

describe("buildThinReplySummary — factual fallback after tool work", () => {
  // Real bug: model deleted 8 reminders, hit STEP_CAP, emitted a bare "✅".
  // The user saw the tick and thought nothing happened. This fallback
  // builds a factual line the user actually understands.

  it("summarises N reminder_delete calls with correct pluralisation", () => {
    expect(
      buildThinReplySummary(["reminder_delete", "reminder_delete", "reminder_delete"], 0, ""),
    ).toBe("✅ Done — cancelled 3 reminders.");
    expect(buildThinReplySummary(["reminder_delete"], 0, "")).toBe(
      "✅ Done — cancelled 1 reminder.",
    );
  });

  it("prefers the bulkCancelled count over just counting delete_many calls", () => {
    // reminder_delete_many is one call but can cancel any number of rows.
    // The tool result's `{cancelled: N}` is authoritative.
    expect(buildThinReplySummary(["reminder_delete_many"], 8, "")).toBe(
      "✅ Done — cancelled 8 reminders.",
    );
  });

  it("combines create + delete + update in one line", () => {
    expect(
      buildThinReplySummary(
        ["reminder_create", "reminder_create", "reminder_delete", "reminder_update"],
        0,
        "",
      ),
    ).toBe("✅ Done — cancelled 1 reminder, created 2 reminders, updated 1 reminder.");
  });

  it("returns null when no relevant tools ran (nothing to summarise)", () => {
    expect(buildThinReplySummary([], 0, "")).toBeNull();
    expect(buildThinReplySummary(["reminder_list"], 0, "")).toBeNull();
  });

  it("keeps existing text when reply is meaningful (not just ✅)", () => {
    const out = buildThinReplySummary(
      ["reminder_delete", "reminder_delete"],
      0,
      "Cool.",
    );
    expect(out).toBe("Cool. ✅ Done — cancelled 2 reminders.");
  });

  it("replaces a lone ✅ rather than appending to it", () => {
    expect(
      buildThinReplySummary(["reminder_delete"], 0, "✅"),
    ).toBe("✅ Done — cancelled 1 reminder.");
  });
});
