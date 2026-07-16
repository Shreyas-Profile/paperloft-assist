// Server-side browser skill backed by globalion/browser-mcp on Hetzner.
//
// The old browser_* set (skills/browser-primitives.ts) is CLIENT-side — the
// tool call streams to the user's Chrome via the chrome-agent extension. That
// works from the /chat page in a browser but is unreachable from the Telegram
// bot (there's no client-side bridge on that surface).
//
// These hosted_browser_* tools call browser-mcp (a hosted Playwright Chrome
// running as a container on the same Hetzner box) over JSON-RPC. They have
// `execute()` fns, so they work from any surface — /chat, Telegram, cron, MCP.
//
// Session model: browser-mcp gives us a per-user Playwright page keyed by
// sessionId. To spare the LLM from juggling ids, we cache one sessionId per
// (paperloft) userEmail in memory. First call opens a fresh session; later
// calls reuse it. Sessions auto-expire on browser-mcp after 15 min idle —
// we detect that and reopen transparently.

import { tool } from "ai";
import { z } from "zod";

const BROWSER_MCP_URL = process.env.BROWSER_MCP_URL ?? "https://browser.regiq.in/api/mcp";
const BROWSER_MCP_KEY = process.env.BROWSER_MCP_KEY;

interface McpResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}
interface McpEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  if (!BROWSER_MCP_KEY) throw new Error("BROWSER_MCP_KEY not set on server");
  const res = await fetch(BROWSER_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${BROWSER_MCP_KEY}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`browser-mcp ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`browser-mcp ${method}: no result`);
  return json.result;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await rpc<McpResult>("tools/call", { name, arguments: args });
  if (result.isError) {
    const msg = result.content?.[0]?.text ?? "unknown browser-mcp error";
    throw new Error(msg);
  }
  return result.structuredContent ?? result.content?.[0]?.text;
}

// (paperloft userEmail) → browser-mcp sessionId
const sessions = new Map<string, string>();

async function newSession(): Promise<string> {
  const out = (await callTool("browser_new_session", {})) as { sessionId?: string };
  if (!out?.sessionId) throw new Error("browser-mcp didn't return a sessionId");
  return out.sessionId;
}

async function getSession(userEmail: string): Promise<string> {
  const cached = sessions.get(userEmail);
  if (cached) return cached;
  const fresh = await newSession();
  sessions.set(userEmail, fresh);
  return fresh;
}

/**
 * Run one action, transparently retrying once with a new session if the
 * existing one has expired on browser-mcp's side.
 */
async function withSession<T>(
  userEmail: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const first = await getSession(userEmail);
  try {
    return await fn(first);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (!/session|expired|not found|not exist/i.test(msg)) throw err;
    sessions.delete(userEmail);
    const fresh = await newSession();
    sessions.set(userEmail, fresh);
    return fn(fresh);
  }
}

/**
 * Build per-user hosted-browser tools. Session management is fully implicit
 * from the LLM's view — the tools just take semantic args (url, uid, text).
 */
export function makeHostedBrowserSkills(userEmail: string) {
  return {
    hosted_browser_navigate: tool({
      description:
        "Open a URL in a hosted Chrome browser that runs on our server. Use this on Telegram or when the user's local browser isn't available — it works everywhere. Sessions persist across your tool calls in the same conversation, so navigating once then snapshotting/clicking works as expected. Waits for the page to load (30s timeout). Returns basic status; call hosted_browser_snapshot next to see the page.",
      inputSchema: z.object({
        url: z.string().describe("Full URL including https://."),
      }),
      execute: async ({ url }) => withSession(userEmail, (s) => callTool("browser_navigate", { sessionId: s, url })),
    }),
    hosted_browser_snapshot: tool({
      description:
        "Return an accessibility-tree snapshot of the current hosted page — every clickable/typeable element gets a stable `uid`. ALWAYS call this after navigate/click before deciding what to click or type next. Uids are more reliable than CSS selectors on modern JS-heavy sites.",
      inputSchema: z.object({}),
      execute: async () => withSession(userEmail, (s) => callTool("browser_snapshot", { sessionId: s })),
    }),
    hosted_browser_click: tool({
      description:
        "Click an element in the hosted browser by its uid (from hosted_browser_snapshot).",
      inputSchema: z.object({
        uid: z.string().describe("uid from a prior hosted_browser_snapshot."),
      }),
      execute: async ({ uid }) => withSession(userEmail, (s) => callTool("browser_click", { sessionId: s, uid })),
    }),
    hosted_browser_type: tool({
      description:
        "Focus a hosted-browser input by uid and type text into it. Doesn't submit — call hosted_browser_press_key with 'Enter' or hosted_browser_click on the submit button after.",
      inputSchema: z.object({
        uid: z.string(),
        text: z.string(),
      }),
      execute: async ({ uid, text }) =>
        withSession(userEmail, (s) => callTool("browser_type", { sessionId: s, uid, text })),
    }),
    hosted_browser_press_key: tool({
      description:
        "Press a keyboard key in the hosted browser (e.g. 'Enter', 'Escape', 'ArrowDown'). Use after typing to submit forms.",
      inputSchema: z.object({
        key: z.string(),
      }),
      execute: async ({ key }) => withSession(userEmail, (s) => callTool("browser_press_key", { sessionId: s, key })),
    }),
    hosted_browser_wait_for: tool({
      description:
        "Wait for a CSS selector to appear on the hosted page (up to timeoutMs, default 5000). Use after navigation/click when the page loads content asynchronously and hosted_browser_snapshot returns before results appear.",
      inputSchema: z.object({
        selector: z.string(),
        timeoutMs: z.number().optional(),
      }),
      execute: async ({ selector, timeoutMs }) =>
        withSession(userEmail, (s) =>
          callTool("browser_wait_for", { sessionId: s, selector, timeoutMs: timeoutMs ?? 5000 }),
        ),
    }),
    hosted_browser_read_page: tool({
      description:
        "Return the visible text content of the hosted page (up to 20 000 chars). Use to extract results after a search/filter completes.",
      inputSchema: z.object({}),
      execute: async () => withSession(userEmail, (s) => callTool("browser_read_page", { sessionId: s })),
    }),
  };
}
