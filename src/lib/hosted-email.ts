// Paperloft-side wrapper around globalion/email-mcp.
// Same aggregator pattern as hosted-docs.ts: per-user provisioned keys stored
// in SkillConnection. First OAuth is a separate step — user must visit
// email.regiq.in and grant Gmail access — but the API key is minted by
// Paperloft on toggle and stored just like docs.

import { tool } from "ai";
import { z } from "zod";
import { getSkillConnection } from "./skill-provisioning";

const EMAIL_MCP_URL = process.env.EMAIL_MCP_URL ?? "https://email.regiq.in/api/mcp";

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
  const res = await fetch(EMAIL_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`email-mcp ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`email-mcp ${method}: no result`);
  return json.result;
}

async function callEmailTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc<McpToolResult>(apiKey, "tools/call", { name, arguments: args });
  if (r.isError) {
    const msg = r.content?.[0]?.text ?? "unknown email-mcp error";
    // Common case: user provisioned but never completed Google OAuth.
    // email-mcp returns a specific "sign in with Google" error; surface it
    // as an actionable hint rather than a raw MCP string.
    if (/sign in|not connected|oauth|gmail api/i.test(msg)) {
      throw new Error(
        "Gmail isn't connected for this account yet. Finish sign-in at https://email.regiq.in — that grants Paperloft permission to send/read on your behalf.",
      );
    }
    throw new Error(msg);
  }
  return r.structuredContent ?? r.content?.[0]?.text;
}

async function getKey(userEmail: string): Promise<string> {
  const conn = await getSkillConnection(userEmail, "email_mcp");
  if (!conn) {
    throw new Error(
      "Email skill isn't connected for this account. Turn it on at https://paperloft.uk/skills.",
    );
  }
  return conn.remoteApiKey;
}

/**
 * Per-user email tools. email-mcp exposes 6 tools; we mirror all of them.
 * `send_email` and `reply_to_email` require the user to confirm before we
 * fire — the LLM prompt should draft-then-confirm, never send silently.
 */
export function makeEmailSkills(userEmail: string) {
  return {
    list_recent_emails: tool({
      description:
        "List the N most recent messages in the user's inbox. Returns id, from, subject, date, snippet. Read-only; free.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "list_recent_emails", args);
      },
    }),

    search_emails: tool({
      description:
        "Search the user's Gmail with Gmail's native query syntax. Supports from:, to:, subject:, is:unread, has:attachment, after:, before:, and body-text. Read-only; free.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "search_emails", args);
      },
    }),

    get_email: tool({
      description:
        "Fetch the full body + headers of one message by id. Use after list_recent_emails / search_emails to read a specific thread. Read-only.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "get_email", { id });
      },
    }),

    send_email: tool({
      description:
        "Send a new email from the user's Gmail account. DRAFT the message and ask the user to confirm the recipient + subject + body BEFORE calling this — never send silently.",
      inputSchema: z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(500),
        body: z.string().min(1),
        cc: z.string().optional(),
        bcc: z.string().optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "send_email", args);
      },
    }),

    reply_to_email: tool({
      description:
        "Reply in the same thread as an existing message. DRAFT the reply and confirm with the user before calling. Preserves the Gmail thread so the reply threads correctly in the recipient's inbox.",
      inputSchema: z.object({
        id: z.string().describe("id of the message being replied to"),
        body: z.string().min(1),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "reply_to_email", args);
      },
    }),

    mark_read: tool({
      description:
        "Remove the UNREAD label from a message. Safe to run without confirmation.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const key = await getKey(userEmail);
        return callEmailTool(key, "mark_read", { id });
      },
    }),
  };
}
