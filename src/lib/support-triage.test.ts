// Unit tests for the AI-triage parser and fallback path.
// Every scenario here is something the LLM has done in the wild (or
// something we know will happen at some point): wrapped its JSON in a
// code fence, added prose around it, returned invalid JSON, returned
// JSON that doesn't match the schema. Each has to degrade gracefully.

import { describe, it, expect } from "vitest";

import {
  parseTriageOutput,
  fallbackTriage,
  triageSchema,
} from "./support-triage";

describe("parseTriageOutput", () => {
  const validObject = {
    category: "bug",
    priority: "p1",
    summary: "User can't sign in with Telegram.",
    suggestedFiles: [
      "src/app/signin/page.tsx",
      "src/app/api/auth/telegram-login/route.ts",
    ],
    draftReply:
      "Thanks — I've reproduced the issue. Sign-in should be back in the next deploy.",
    notes: "Likely same root cause as #23.",
  };

  it("parses bare JSON output", () => {
    const parsed = parseTriageOutput(JSON.stringify(validObject));
    expect(parsed).toEqual(validObject);
  });

  it("strips a ```json fenced block", () => {
    const raw = "```json\n" + JSON.stringify(validObject, null, 2) + "\n```";
    const parsed = parseTriageOutput(raw);
    expect(parsed.category).toBe("bug");
    expect(parsed.suggestedFiles).toHaveLength(2);
  });

  it("strips a bare ``` block (no language tag)", () => {
    const raw = "```\n" + JSON.stringify(validObject) + "\n```";
    expect(parseTriageOutput(raw)).toEqual(validObject);
  });

  it("returns the safe fallback when the model returns prose instead of JSON", () => {
    const raw = "Hey, I think this is probably a bug in the sign-in flow.";
    const out = parseTriageOutput(raw);
    // Fallback shape — matches what the admin sees when triage fails.
    expect(out.category).toBe("other");
    expect(out.priority).toBe("p2");
    expect(out.notes).toContain("invalid");
  });

  it("returns the safe fallback when priority is out of enum", () => {
    const bad = { ...validObject, priority: "URGENT" };
    const out = parseTriageOutput(JSON.stringify(bad));
    expect(out.priority).toBe("p2");
  });

  it("returns the safe fallback when required fields are missing", () => {
    const partial = { category: "bug" };
    const out = parseTriageOutput(JSON.stringify(partial));
    expect(out.category).toBe("other"); // fallback overrides
  });

  it("caps suggestedFiles at 5 via schema enforcement", () => {
    const many = {
      ...validObject,
      suggestedFiles: [
        "a.ts",
        "b.ts",
        "c.ts",
        "d.ts",
        "e.ts",
        "f.ts",
        "g.ts",
      ],
    };
    const out = parseTriageOutput(JSON.stringify(many));
    // Fallback fires because array exceeds the schema's max(5).
    expect(out.category).toBe("other");
    // Sanity: a version with exactly 5 files IS valid.
    const exactlyFive = { ...validObject, suggestedFiles: many.suggestedFiles.slice(0, 5) };
    expect(parseTriageOutput(JSON.stringify(exactlyFive)).suggestedFiles).toHaveLength(5);
  });
});

describe("fallbackTriage", () => {
  it("returns a schema-valid object so the admin page can render it", () => {
    const validated = triageSchema.safeParse(fallbackTriage());
    expect(validated.success).toBe(true);
  });
});
