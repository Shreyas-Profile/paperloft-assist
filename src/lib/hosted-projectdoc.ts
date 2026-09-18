// Paperloft-side wrapper around globalion/projectdoc-mcp.
//
// projectdoc-mcp is stateless (no DB, no per-user data) — it takes a
// project brief in and returns four Markdown artefacts (plan, user flows,
// architecture, cost report). No provisioning needed. Same shared-endpoint
// pattern as hosted-cron.ts, but simpler because projectdoc-mcp doesn't
// require an auth key at all.
//
// Exposed tools:
//  - projectdoc_generate: given a brief, returns all four artefacts.
//  - projectdoc_generate_one: same but for a single artefact.
//
// If projectdoc-mcp is down, throws a clear error the LLM can surface.

import { tool } from "ai";
import { z } from "zod";

const PROJECTDOC_URL = process.env.PROJECTDOC_MCP_URL ?? "https://projectdoc.globalion.in/api/generate";

interface GenerateResponse {
  ok?: boolean;
  brief?: unknown;
  artefacts?: {
    plan?: string;
    flows?: string;
    architecture?: string;
    cost?: string;
  };
  error?: string;
  detail?: unknown;
}

async function callProjectDoc(
  body: Record<string, unknown>,
): Promise<GenerateResponse> {
  const res = await fetch(PROJECTDOC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `projectdoc-mcp ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }
  return (await res.json()) as GenerateResponse;
}

/**
 * The four artefacts ProjectDoc can generate. Each is a Markdown string
 * suitable for dropping straight into a repo's /docs folder.
 */
const ARTEFACT_ENUM = z.enum(["plan", "flows", "architecture", "cost"]);

export function makeProjectDocSkills(_userEmail: string) {
  return {
    projectdoc_generate: tool({
      description:
        "Turn a project brief into a full documentation pack: project plan (vision, success criteria, milestones, team, risks), user flows (personas + happy/unhappy paths), technical architecture (stack, data model, integrations, ASCII diagram), and a cost report (manual build cost vs Nova+BuildOps in ₹). Returns four Markdown documents. Takes ~30 seconds. Use when the user is starting a new project or wants written docs for an existing one.",
      inputSchema: z.object({
        name: z
          .string()
          .min(2)
          .max(500)
          .describe("Short project name, e.g. 'Payroll app for Bank X'."),
        description: z
          .string()
          .min(10)
          .max(50000)
          .describe(
            "Description of what the project does — the more specific, the better output. Include what it is, who uses it, and any tech preferences.",
          ),
        audience: z
          .string()
          .max(5000)
          .optional()
          .describe(
            "Who will use the finished product (roles, industry, geography). Optional.",
          ),
        goals: z
          .string()
          .max(20000)
          .optional()
          .describe(
            "Measurable goals or success criteria the project should hit. Optional.",
          ),
      }),
      execute: async (args) => {
        const r = await callProjectDoc({ ...args });
        if (!r.ok) throw new Error(r.error ?? "projectdoc: unknown error");
        return r.artefacts;
      },
    }),

    projectdoc_generate_one: tool({
      description:
        "Same as projectdoc_generate but only produces one of the four artefacts. Use when the user asks specifically for the plan / user flows / architecture / cost report on its own — saves ~20 seconds vs the full pack.",
      inputSchema: z.object({
        artefact: ARTEFACT_ENUM.describe(
          "Which single artefact to generate. Choose from: plan (project plan), flows (user flows), architecture (technical architecture), cost (build-cost report).",
        ),
        name: z.string().min(2).max(500),
        description: z.string().min(10).max(50000),
        audience: z.string().max(5000).optional(),
        goals: z.string().max(20000).optional(),
      }),
      execute: async ({ artefact, ...brief }) => {
        const r = await callProjectDoc({ ...brief, artefacts: [artefact] });
        if (!r.ok) throw new Error(r.error ?? "projectdoc: unknown error");
        return { [artefact]: r.artefacts?.[artefact] };
      },
    }),
  };
}
