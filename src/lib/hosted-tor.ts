// Paperloft-side wrapper around globalion/tor-mcp.
//
// Per-user provisioned keys, same shape as hosted-docs.ts. Each user gets
// their own tor-mcp User row + API key stored in SkillConnection — request
// logs and rate limits are scoped to them.
//
// Flow:
//   1. Skill toggled on /skills → provisionSkillConnection("tor_mcp") mints
//      a sub-account and stores the raw key in SkillConnection
//   2. LLM calls tor_* → we grab the row and forward the Bearer request
//   3. tor-mcp routes through its shared Tor daemon; logs get scoped by userId
//
// Honest scope reminder for the LLM's prompt: tor_fetch works on non-CF
// sites and .onion services but NOT on Cloudflare-guarded ones. When the
// LLM hits a Cloudflare-blocked site, it should fall back to browser_*.

import { tool } from "ai";
import { z } from "zod";
import { getSkillConnection } from "./skill-provisioning";

const TOR_MCP_URL = process.env.TOR_MCP_URL ?? "https://tor.regiq.in/api/mcp";

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

async function rpc<T>(apiKey: string, method: string, params?: unknown): Promise<T> {
  const res = await fetch(TOR_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`tor-mcp ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`tor-mcp ${method}: no result`);
  return json.result;
}

async function callTorTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc<McpToolResult>(apiKey, "tools/call", { name, arguments: args });
  if (r.isError) {
    const msg = r.content?.[0]?.text ?? "unknown tor-mcp error";
    throw new Error(msg);
  }
  return r.structuredContent ?? r.content?.[0]?.text;
}

async function getKey(userEmail: string): Promise<string> {
  const conn = await getSkillConnection(userEmail, "tor_mcp");
  if (!conn) {
    throw new Error(
      "Tor skill isn't connected for this account. Turn it on at https://paperloft.uk/skills.",
    );
  }
  return conn.remoteApiKey;
}

export function makeTorSkills(userEmail: string) {
  return {
    tor_fetch: tool({
      description:
        "Fetch a URL through the Tor network (anonymous, rotating exit IP). Use for: non-Cloudflare sites the user wants hit anonymously, .onion services, geo-hidden fetches, APIs with per-IP rate limits. DO NOT use for Cloudflare-guarded sites (Indeed, Google, LinkedIn, most big brands) — they block Tor exits; use browser_* tools instead. Methods: GET/POST/HEAD only. 30s timeout, 10MB body cap. Returns { status, headers, body, exitIp, durationMs }.",
      inputSchema: z.object({
        url: z.string().url(),
        method: z.enum(["GET", "POST", "HEAD"]).optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().max(1_000_000).optional(),
        followRedirects: z.boolean().optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callTorTool(key, "tor_fetch", args);
      },
    }),

    tor_get_exit_ip: tool({
      description:
        "Return the current Tor exit node's IP + country. Confirms traffic is routing through Tor. Use before a sensitive fetch if the user asked to verify anonymity.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = await getKey(userEmail);
        return callTorTool(key, "tor_get_exit_ip", {});
      },
    }),

    tor_new_circuit: tool({
      description:
        "Force Tor to select a new exit circuit. Rate-limited by Tor itself to once per ~10s. Call between requests when the user needs to appear as a different exit IP each time.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = await getKey(userEmail);
        return callTorTool(key, "tor_new_circuit", {});
      },
    }),

    tor_check: tool({
      description:
        "Quick HEAD probe through Tor. Returns { reachable, status, hint }. Use to filter a list of URLs before doing expensive tor_fetch calls — especially useful when the user wants to check which of N sites accept Tor traffic. Common hint 'site is likely blocking Tor exit nodes' means switch to browser_*.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }) => {
        const key = await getKey(userEmail);
        return callTorTool(key, "tor_check", { url });
      },
    }),
  };
}
