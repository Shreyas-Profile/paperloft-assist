// Paperloft-side wrapper around globalion/docs-mcp.
//
// Unlike hosted-cron.ts / hosted-browser.ts (which share ONE paperloft
// service key across all users), docs-mcp uses per-user provisioned keys.
// Each paperloft user has their own docs-mcp User row + API key stored in
// SkillConnection, so docs live in that user's own tenant — a true
// sub-account, DB-isolated on docs-mcp's side.
//
// Flow on first use:
//   1. User toggles "Docs" on /skills → we call provisionSkillConnection()
//   2. SkillConnection row created with the returned remoteApiKey
//   3. LLM calls a docs_* tool → we grab the row, use its remoteApiKey
//   4. docs-mcp sees a normal Bearer request, queries WHERE userId = <them>
//
// If provisioning failed at toggle time (skill server down, no shared
// secret), tools throw a clear "docs skill not connected — re-toggle on
// /skills" error on first call.

import { tool } from "ai";
import { z } from "zod";
import { getSkillConnection } from "./skill-provisioning";

const DOCS_MCP_URL = process.env.DOCS_MCP_URL ?? "https://docs.globalion.in/api/mcp";

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
  const res = await fetch(DOCS_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`docs-mcp ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`docs-mcp ${method}: no result`);
  return json.result;
}

async function callDocsTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc<McpToolResult>(apiKey, "tools/call", { name, arguments: args });
  if (r.isError) {
    const msg = r.content?.[0]?.text ?? "unknown docs-mcp error";
    throw new Error(msg);
  }
  return r.structuredContent ?? r.content?.[0]?.text;
}

/**
 * Resolve the user's docs-mcp API key, throwing a friendly error if they
 * haven't enabled the skill (or provisioning failed silently).
 */
async function getKey(userEmail: string): Promise<string> {
  const conn = await getSkillConnection(userEmail, "docs_mcp");
  if (!conn) {
    throw new Error(
      "Docs skill isn't connected for this account. Turn it on at https://paperloft.uk/skills.",
    );
  }
  return conn.remoteApiKey;
}

/**
 * Build the per-user docs tools. Every call resolves the user's key from
 * SkillConnection just-in-time — no in-process cache — so a rotation on
 * docs-mcp's side (rare) takes effect on the next chat turn.
 */
export function makeDocsSkills(userEmail: string) {
  return {
    docs_upload: tool({
      description:
        "Upload a document (PDF / .docx / .xlsx / .pptx / .doc / .xls / .ppt) into the user's private docs corpus. Costs 1 credit per page ingested. For files larger than ~7 MB tell the user to attach via the paperclip icon in chat instead — the base64 path can't handle bigger. Poll docs_get({id}) until status='ready' before running docs_search on it (usually 10-60s for a 10-page doc).",
      inputSchema: z.object({
        filename: z.string().min(1).max(300),
        contentBase64: z.string().min(10),
        mimeType: z.string().optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_upload", args);
      },
    }),

    docs_list: tool({
      description:
        "List every document the user has uploaded. Returns id, filename, status ('pending'|'processing'|'ready'|'failed'|'needs_credits'), pageCount, creditsSpent, createdAt.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_list", {});
      },
    }),

    docs_get: tool({
      description:
        "Fetch one document's metadata + status by id. Poll after docs_upload until status='ready'.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_get", { id });
      },
    }),

    docs_search: tool({
      description:
        "Semantic search across the user's document corpus. Returns the top-k most-relevant chunks with { chunkId, documentId, filename, pageNumber, content, similarity }. Free — queries cost 0 credits. Prefer specific queries ('what did we agree the launch date is?') over vague ones ('launch info'). ALWAYS cite page numbers in your reply from the returned chunks.",
      inputSchema: z.object({
        query: z.string().min(1).max(2000),
        k: z.number().int().min(1).max(32).optional(),
        documentIds: z.array(z.string()).optional(),
      }),
      execute: async (args) => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_search", args);
      },
    }),

    docs_delete: tool({
      description:
        "Permanently delete a document (row + all chunks + raw file). Spent credits are not refunded. Confirm with the user before calling — they can't get it back.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_delete", { id });
      },
    }),

    docs_balance: tool({
      description:
        "Return the user's remaining page credits on docs-mcp + last 10 transactions. Use before big uploads so you can warn them if they'll run out.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = await getKey(userEmail);
        return callDocsTool(key, "docs_balance", {});
      },
    }),
  };
}
