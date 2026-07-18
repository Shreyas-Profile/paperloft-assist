// Bring-your-own-skill (BYO) library.
//
// A UserSkill is a private, per-user MCP endpoint. Users add URL + headers
// on /skills; we verify the endpoint speaks MCP (initialize + tools/list),
// cache its tool descriptors, and encrypt the headers at rest.
//
// At chat time we build ai-sdk `tool()` objects on the fly, one per cached
// tool. Executing a tool forwards a JSON-RPC `tools/call` to the user's
// MCP with their decrypted headers, and returns the structured content or
// text back to the LLM.
//
// Namespacing:
//   Tool names surfaced to the LLM are `byo_<skillSlug>__<toolName>`.
//   `skillSlug` is [a-z0-9_-]+ enforced on save. This prevents collisions
//   with marketplace tool names (docs_search, tor_fetch, ...) AND lets the
//   chat route reverse-map a call back to its skill via the prefix.

import { tool, jsonSchema } from "ai";
import { z } from "zod";
import { prisma } from "./db";
import { decrypt } from "./crypto";

export const MAX_SKILLS_PER_USER = 20;
export const TOOL_PREFIX = "byo_";
const NAME_SEPARATOR = "__";
const REQUEST_TIMEOUT_MS = 30_000;
const SKILL_NAME_RE = /^[a-z0-9_-]{2,32}$/;

export interface CachedTool {
  name: string;
  description?: string;
  // Kept as the raw JSON schema the MCP returned; ai-sdk's jsonSchema()
  // wraps it for the LLM without a zod round-trip.
  inputSchema?: Record<string, unknown>;
}

export interface McpEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

/** Sanitize a user-chosen skill name into our slug shape. */
export function validateSkillName(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!SKILL_NAME_RE.test(trimmed)) {
    throw new Error(
      "name must be 2-32 chars, lowercase letters/digits/`-`/`_` only",
    );
  }
  return trimmed;
}

export function buildToolName(skillSlug: string, toolName: string): string {
  return `${TOOL_PREFIX}${skillSlug}${NAME_SEPARATOR}${toolName}`;
}

/** Reverse of buildToolName. Returns null if `full` isn't a BYO tool name. */
export function parseToolName(
  full: string,
): { skillSlug: string; toolName: string } | null {
  if (!full.startsWith(TOOL_PREFIX)) return null;
  const rest = full.slice(TOOL_PREFIX.length);
  const sep = rest.indexOf(NAME_SEPARATOR);
  if (sep < 0) return null;
  return { skillSlug: rest.slice(0, sep), toolName: rest.slice(sep + NAME_SEPARATOR.length) };
}

/**
 * MCP JSON-RPC round-trip. `initialize` first, then whatever the caller
 * wanted. Some MCPs (including our own) accept tools/list without
 * initialize; some don't — always doing initialize is the safer path.
 */
async function mcpRpc<T>(
  url: string,
  headers: Record<string, string>,
  method: string,
  params?: unknown,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) {
      throw new Error(`${method}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as McpEnvelope<T>;
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    if (!json.result) throw new Error(`${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the endpoint speaks MCP + list its tools. Returns the sanitized
 * cached-tool descriptors ready to store. Throws with a user-friendly
 * message on any failure — the API route surfaces that verbatim.
 */
export async function discoverTools(
  mcpUrl: string,
  headers: Record<string, string>,
): Promise<CachedTool[]> {
  try {
    new URL(mcpUrl);
  } catch {
    throw new Error("invalid URL");
  }
  await mcpRpc(mcpUrl, headers, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "paperloft-assist", version: "0.1.0" },
  });
  const listed = await mcpRpc<{ tools?: unknown[] }>(
    mcpUrl,
    headers,
    "tools/list",
  );
  const raw = Array.isArray(listed.tools) ? listed.tools : [];
  const out: CachedTool[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const obj = t as Record<string, unknown>;
    if (typeof obj.name !== "string" || !obj.name) continue;
    out.push({
      name: obj.name,
      description: typeof obj.description === "string" ? obj.description : undefined,
      inputSchema:
        obj.inputSchema && typeof obj.inputSchema === "object"
          ? (obj.inputSchema as Record<string, unknown>)
          : undefined,
    });
  }
  if (out.length === 0) {
    throw new Error("endpoint returned no tools");
  }
  return out;
}

/** Parse the encrypted headers blob back into a plain object. */
export function decryptHeaders(payload: string | null): Record<string, string> {
  if (!payload) return {};
  const decoded = decrypt(payload);
  const parsed = JSON.parse(decoded) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Build the ai-sdk tool bag for every enabled BYO skill a user has. Empty
 * object if they have none. Each tool forwards to its remote MCP with the
 * decrypted headers on invocation.
 */
// Return type deliberately loose: each `tool()` call has its own
// strongly-typed input schema, so a homogeneous record forces TS to LUB
// them to `never`. The chat route treats the returned map as opaque and
// spreads it into the tools bag alongside marketplace tools.
export async function makeUserByoSkills(
  userEmail: string,
): Promise<Record<string, unknown>> {
  const rows = await prisma.userSkill.findMany({
    where: { userEmail, enabled: true },
    select: {
      name: true,
      mcpUrl: true,
      headersEncrypted: true,
      tools: true,
    },
  });

  const bag: Record<string, unknown> = {};
  for (const row of rows) {
    const tools = Array.isArray(row.tools) ? (row.tools as unknown as CachedTool[]) : [];
    // Decrypt lazily on the first call for a given row — cheap enough per
    // request, avoids doing it if the LLM doesn't invoke this skill.
    let cachedHeaders: Record<string, string> | null = null;
    const headers = () => {
      if (!cachedHeaders) cachedHeaders = decryptHeaders(row.headersEncrypted);
      return cachedHeaders;
    };

    for (const t of tools) {
      const nsName = buildToolName(row.name, t.name);
      bag[nsName] = tool({
        description:
          `[${row.name}] ${t.description ?? "(no description)"}`.slice(0, 1024),
        inputSchema: t.inputSchema
          ? jsonSchema(t.inputSchema as never)
          : z.object({}).passthrough(),
        execute: async (args: unknown) => {
          try {
            const result = await mcpRpc<{
              content?: Array<{ type: string; text?: string }>;
              structuredContent?: unknown;
              isError?: boolean;
            }>(row.mcpUrl, headers(), "tools/call", {
              name: t.name,
              arguments: args,
            });
            if (result.isError) {
              const msg = result.content?.[0]?.text ?? "unknown error";
              throw new Error(msg);
            }
            return result.structuredContent ?? result.content?.[0]?.text ?? null;
          } catch (err) {
            return { error: (err as Error).message };
          }
        },
      });
    }
  }
  return bag;
}

/** The name set to allow through the chat route's tool filter. */
export async function listByoToolNames(userEmail: string): Promise<Set<string>> {
  const rows = await prisma.userSkill.findMany({
    where: { userEmail, enabled: true },
    select: { name: true, tools: true },
  });
  const names = new Set<string>();
  for (const row of rows) {
    const tools = Array.isArray(row.tools) ? (row.tools as unknown as CachedTool[]) : [];
    for (const t of tools) names.add(buildToolName(row.name, t.name));
  }
  return names;
}
