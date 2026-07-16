// Browser skill backed by globalion/browser-mcp on Hetzner.
//
// One and only browser skill — always runs on our server (real Google Chrome
// via Playwright, per-user persistent state). Works from every surface: web
// /chat, Telegram, cron. No client-side variant, no chrome-agent extension.
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

export function makeBrowserSkills(userEmail: string) {
  return {
    browser_navigate: tool({
      description:
        "Open a URL in a real Chrome browser running on our server. Works everywhere (web /chat, Telegram, cron). Sessions persist across tool calls in the same turn — navigate once, then snapshot/click/type as needed. Waits for page load (30s timeout). Returns basic status; call browser_snapshot next to see the page.",
      inputSchema: z.object({
        url: z.string().describe("Full URL including https://."),
      }),
      execute: async ({ url }) => withSession(userEmail, (s) => callTool("browser_navigate", { sessionId: s, url })),
    }),
    browser_snapshot: tool({
      description:
        "Return an accessibility-tree snapshot of the current page — every clickable/typeable element gets a stable `uid`. ALWAYS call this after navigate/click before deciding what to click or type next. Uids are more reliable than CSS selectors on modern JS-heavy sites.",
      inputSchema: z.object({}),
      execute: async () => withSession(userEmail, (s) => callTool("browser_snapshot", { sessionId: s })),
    }),
    browser_click: tool({
      description:
        "Click an element in the browser by its uid (from browser_snapshot).",
      inputSchema: z.object({
        uid: z.string().describe("uid from a prior browser_snapshot."),
      }),
      execute: async ({ uid }) => withSession(userEmail, (s) => callTool("browser_click", { sessionId: s, uid })),
    }),
    browser_type: tool({
      description:
        "Focus an input by uid and type text. Doesn't submit — call browser_press_key with 'Enter' or browser_click on the submit button after.",
      inputSchema: z.object({
        uid: z.string(),
        text: z.string(),
      }),
      execute: async ({ uid, text }) =>
        withSession(userEmail, (s) => callTool("browser_type", { sessionId: s, uid, text })),
    }),
    browser_press_key: tool({
      description:
        "Press a keyboard key (e.g. 'Enter', 'Escape', 'ArrowDown'). Use after typing to submit forms.",
      inputSchema: z.object({
        key: z.string(),
      }),
      execute: async ({ key }) => withSession(userEmail, (s) => callTool("browser_press_key", { sessionId: s, key })),
    }),
    browser_wait_for: tool({
      description:
        "Wait for a CSS selector to appear on the page (up to timeoutMs, default 5000). Use after navigation/click when the page loads content asynchronously and browser_snapshot returns before results appear.",
      inputSchema: z.object({
        selector: z.string(),
        timeoutMs: z.number().optional(),
      }),
      execute: async ({ selector, timeoutMs }) =>
        withSession(userEmail, (s) =>
          callTool("browser_wait_for", { sessionId: s, selector, timeoutMs: timeoutMs ?? 5000 }),
        ),
    }),
    browser_read_page: tool({
      description:
        "Return the visible text content of the current page (up to 20 000 chars). Use to extract results after a search/filter completes.",
      inputSchema: z.object({}),
      execute: async () => withSession(userEmail, (s) => callTool("browser_read_page", { sessionId: s })),
    }),
  };
}
