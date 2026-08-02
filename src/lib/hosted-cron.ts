// Paperloft-side wrapper around globalion/cron-mcp.
//
// Same pattern as hosted-browser.ts: the cron-mcp service is a separate MCP
// server on Hetzner (cron.globalion.in). Paperloft calls it as an MCP client
// (JSON-RPC over HTTPS with a service Bearer key). All paperloft users
// share one cron-mcp account — their identity is stamped on jobs via the
// `metadata.userEmail` field, and the shared callback URL routes back to
// paperloft's /api/cron/fire endpoint.
//
// When a job fires, cron-mcp POSTs to /api/cron/fire with the job body
// (HMAC-signed via X-Cron-Signature). paperloft looks up userEmail from
// metadata, runs the prompt through the LLM + full tool set, and DMs the
// result to the user via their preferred delivery channel (Telegram
// today; WhatsApp when wasender is unblocked).

import { tool } from "ai";
import { z } from "zod";

const CRON_MCP_URL = process.env.CRON_MCP_URL ?? "https://cron.globalion.in/api/mcp";
const CRON_MCP_KEY = process.env.CRON_MCP_KEY;
const CALLBACK_URL = process.env.CRON_CALLBACK_URL ?? "https://paperloft.uk/api/cron/fire";

interface McpEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  if (!CRON_MCP_KEY) throw new Error("CRON_MCP_KEY not set on paperloft server");
  const res = await fetch(CRON_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${CRON_MCP_KEY}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`cron-mcp ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`cron-mcp ${method}: no result`);
  return json.result;
}

async function callCronTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc<McpToolResult>("tools/call", { name, arguments: args });
  if (r.isError) {
    const msg = r.content?.[0]?.text ?? "unknown cron-mcp error";
    throw new Error(msg);
  }
  return r.structuredContent ?? r.content?.[0]?.text;
}

/**
 * Build the per-user cron tools. Every job scheduled by a paperloft user
 * gets metadata.userEmail set so the callback can route the result back.
 */
export function makeCronSkills(userEmail: string) {
  return {
    cron_schedule: tool({
      description:
        "Schedule a recurring prompt. When the cron expression matches (e.g. '0 8 * * *' = every day at 08:00), Paperloft will run the prompt through the full LLM + tool set and deliver the result to the user's Telegram. Use for daily briefings, hourly polls, weekly digests, anything that repeats on a fixed schedule. Do NOT use for one-shot 'in 3 minutes' notifications — use the reminders skill for that.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(120)
          .describe("Human-readable label the user will see, e.g. 'daily AI news briefing'."),
        cron: z
          .string()
          .describe(
            "5-field cron expression 'min hour day month weekday' — e.g. '0 8 * * *' = daily 08:00 UTC, '0 */2 * * *' = every 2 hours, '30 9 * * MON-FRI' = weekdays 09:30.",
          ),
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "The prompt to run when the job fires. Write it as if speaking to the assistant right now — e.g. 'Give me a 3-bullet summary of the top AI news items from the last 24 hours.'",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone (e.g. 'Europe/London', 'America/New_York'). Cron matches minutes in this zone. Default: UTC.",
          ),
      }),
      execute: async ({ name, cron, prompt, timezone }) =>
        callCronTool("schedule_job", {
          name,
          cron,
          prompt,
          callbackUrl: CALLBACK_URL,
          metadata: { userEmail },
          timezone,
        }),
    }),

    cron_list: tool({
      description:
        "List all recurring cron jobs the user has scheduled. Returns their names, cron expressions, next fire time, and whether they're active or paused.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = (await callCronTool("list_jobs", {})) as {
          jobs: Array<{ id: string; name: string; cron: string; timezone: string; isActive: boolean; nextFireAt: string | null; metadata: { userEmail?: string } }>;
        };
        // Filter to this user's jobs — the service account holds everyone's,
        // but callers only see their own.
        const mine = (all.jobs ?? []).filter(
          (j) => (j.metadata as { userEmail?: string } | null)?.userEmail === userEmail,
        );
        return { jobs: mine, count: mine.length };
      },
    }),

    cron_delete: tool({
      description:
        "Permanently delete a scheduled cron job by id. Prefer cron_pause if you might revive it later.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        // Verify the job belongs to this user before deleting (service key
        // could otherwise delete anyone's).
        const job = (await callCronTool("get_job", { id })) as { metadata?: { userEmail?: string } };
        if (job.metadata?.userEmail !== userEmail) {
          throw new Error(`Job ${id} does not belong to you.`);
        }
        return callCronTool("delete_job", { id });
      },
    }),

    cron_pause: tool({
      description:
        "Pause a cron job — it stays in the list but doesn't fire until resumed. Use when the user wants to stop notifications temporarily.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const job = (await callCronTool("get_job", { id })) as { metadata?: { userEmail?: string } };
        if (job.metadata?.userEmail !== userEmail) {
          throw new Error(`Job ${id} does not belong to you.`);
        }
        return callCronTool("update_job", { id, isActive: false });
      },
    }),

    cron_resume: tool({
      description: "Resume a paused cron job.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const job = (await callCronTool("get_job", { id })) as { metadata?: { userEmail?: string } };
        if (job.metadata?.userEmail !== userEmail) {
          throw new Error(`Job ${id} does not belong to you.`);
        }
        return callCronTool("update_job", { id, isActive: true });
      },
    }),
  };
}
