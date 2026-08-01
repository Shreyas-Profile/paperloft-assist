// Paperloft-side wrapper around globalion/video-render-mcp.
//
// Same shared-service-key pattern as hosted-cron.ts (not hosted-docs's
// per-user provisioning). All paperloft users share one video-render-mcp
// account — jobs are tagged with metadata.userEmail so we can attribute
// usage on our side. video-render doesn't yet expose an
// /api/platform/provision-user endpoint, so per-user isolation would
// require modifying that codebase.
//
// video-render jobs are async (60-300s render time). The tool returns
// a jobId + videoUrl immediately and the LLM tells the user "check
// back in a few minutes at <url>". No polling inside the chat turn —
// that would burn STEP_CAP for nothing.

import { tool } from "ai";
import { z } from "zod";

const VIDEO_RENDER_MCP_URL =
  process.env.VIDEO_RENDER_MCP_URL ?? "https://video-render.regiq.in/api/mcp";
const VIDEO_RENDER_MCP_KEY = process.env.VIDEO_RENDER_MCP_KEY;

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
  if (!VIDEO_RENDER_MCP_KEY) {
    throw new Error("VIDEO_RENDER_MCP_KEY not set on paperloft server");
  }
  const res = await fetch(VIDEO_RENDER_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${VIDEO_RENDER_MCP_KEY}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as McpEnvelope<T>;
  if (json.error) throw new Error(`video-render ${method}: ${json.error.message}`);
  if (!json.result) throw new Error(`video-render ${method}: no result`);
  return json.result;
}

async function callVideoTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Debug: log the payload we're sending so we can see what shape the
  // LLM actually built when tool calls fail upstream. Remove once video-
  // render is stable in prod (leaves are noisy).
  try {
    const preview = JSON.stringify(args).slice(0, 800);
    console.log(`[hosted-video-render] → ${name}: ${preview}`);
  } catch {}
  const r = await rpc<McpToolResult>("tools/call", { name, arguments: args });
  if (r.isError) {
    const msg = r.content?.[0]?.text ?? "unknown video-render error";
    console.warn(`[hosted-video-render] ← ${name} ERROR: ${msg.slice(0, 400)}`);
    throw new Error(msg);
  }
  return r.structuredContent ?? r.content?.[0]?.text;
}

// Scene schema — kept loose (untyped object per scene) so we don't have to
// mirror video-render's evolving ScenePlan schema here. Upstream validates
// the actual shape; if the LLM passes a bad scene it gets a Zod error we
// re-throw. The tool descriptions below spell out the exact fields per
// scene type so the LLM doesn't have to guess.
const sceneSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "One scene object. See tool description for exact shape by 'type'.",
  );

// Reused by both video_plan and video_render descriptions so they stay in
// sync. Concrete example is worth more than any schema docs.
const SCENE_SHAPES_HINT =
  "\n\nSCENE SHAPES (exact field names — get these wrong and the call fails):\n" +
  "  • title: { type:'title', copy:'HEADLINE', subtitle?:'OPTIONAL SUB' }\n" +
  "  • stat:  { type:'stat', big:'BIG WORD', small:'small caption', image?:'data:image/…' }\n" +
  "  • image: { type:'image', src:'data:image/…', caption?:'text', fit?:'cover'|'contain', background?:'#0f172a' }\n" +
  "  • code:  { type:'code', language:'ts', snippet:'const x = 1;', caption?:'text' }\n" +
  "  • cta:   { type:'cta', url:'paperloft.uk', copy:'Try it free.' }\n\n" +
  "CRITICAL — images: the ONLY valid `src` / `image` value is a `data:image/...` inline data URI. " +
  "NEVER guess or fabricate an https URL like 'https://paperloft.uk/assets/foo.png' — those files do not exist and the render will fail with 'couldn't load image'. " +
  "If the user hasn't handed you a real data URI, OMIT the image/src field entirely and use a title/stat/cta/quote/list scene instead. Text-only scenes always work.\n\n" +
  "EXAMPLE full ScenePlan for a 20s intro video (text-only, safe default):\n" +
  '  { title:"Hello world demo", targetDurationSec:20, voice:"male-uk",\n' +
  '    script:"Hello world. This is a Paperloft demo. Try it at paperloft dot uk.",\n' +
  '    scenes:[\n' +
  '      {type:"title", copy:"Hello, world", subtitle:"A tiny demo"},\n' +
  '      {type:"stat", big:"3 skills", small:"live today"},\n' +
  '      {type:"cta", url:"paperloft.uk", copy:"Try it free."}\n' +
  '    ] }';

/**
 * Two-tool set:
 *   • video_plan — draft a scene plan without rendering (cheap, no credits)
 *   • video_render — actually render an MP4 (async, ~60-300s, costs credits)
 *
 * Typical LLM flow: plan → confirm with user → render → tell them the URL.
 */
export function makeVideoRenderSkills(userEmail: string) {
  return {
    video_plan: tool({
      description:
        "Draft a video ScenePlan without rendering. Zero credits — use this to iterate on the concept with the user before spending on a real render. Returns the same object shape video_render accepts. Sizing rule: script text ≈ 150 words per minute × targetDurationSec." +
        SCENE_SHAPES_HINT,
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        targetDurationSec: z.number().int().min(5).max(180).default(30),
        script: z
          .string()
          .describe(
            "Full narration text. Should read for approximately targetDurationSec at 150 wpm.",
          ),
        scenes: z.array(sceneSchema).min(1).max(12),
        voice: z
          .enum([
            "male-uk",
            "female-uk",
            "male-us",
            "female-us",
            "premium-male-uk",
            "premium-female-uk",
            "premium-male-us",
            "premium-female-us",
          ])
          .optional()
          .default("male-uk"),
      }),
      execute: async (args) => callVideoTool("plan_video_scenes", args),
    }),

    video_render: tool({
      description:
        "Kick off an ASYNC video render. Returns { jobId, statusUrl, videoUrl, creditsQuoted } immediately — the actual render takes 60-300 seconds. Do NOT poll from here (it eats step budget); instead tell the user their video will be ready in a few minutes at the SPECIFIC videoUrl returned by this call. " +
        "CRITICAL — URL formatting: PASTE the exact `videoUrl` string as a PLAIN URL on its own line. NEVER wrap it in markdown: no `**bold**`, no `[link](url)`, no backticks. Telegram's link parser will treat `**` as part of the URL and the click 404s. NEVER template it either (`[jobId]`, `<url>`, `{videoUrl}` are all wrong — those are meta-syntax, not real values). If the returned videoUrl is `https://video-render.regiq.in/api/renders/abc123.mp4`, your message should contain that exact string on its own line — nothing before, nothing after, no formatting. " +
        "If they ask later 'is it done?', call video_status({ jobId }) using the exact jobId this call returned." +
        SCENE_SHAPES_HINT,
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        targetDurationSec: z.number().int().min(5).max(180).default(30),
        script: z.string(),
        scenes: z.array(sceneSchema).min(1).max(12),
        voice: z
          .enum([
            "male-uk",
            "female-uk",
            "male-us",
            "female-us",
            "premium-male-uk",
            "premium-female-uk",
            "premium-male-us",
            "premium-female-us",
          ])
          .optional()
          .default("male-uk"),
      }),
      execute: async (args) => {
        // Tag every job with userEmail metadata so we can attribute usage
        // when we look back at the shared video-render account.
        const result = (await callVideoTool("render_video", {
          ...args,
          metadata: { userEmail },
        })) as {
          jobId: string;
          statusUrl?: string;
          videoUrl?: string;
          creditsQuoted?: number;
          creditsRemaining?: number;
        };
        return result;
      },
    }),

    video_status: tool({
      description:
        "Check whether an in-flight video render has finished. Returns { status: 'pending'|'rendering'|'success'|'failed', videoUrl?, durationSec?, sizeBytes? }. Call this ONLY when the user asks 'is my video ready?' — don't poll speculatively. When you tell the user the URL, PASTE the videoUrl as a plain URL on its own line — no `**bold**`, no `[markdown](links)`, no backticks (Telegram parses `**` as part of the URL and clicks 404).",
      inputSchema: z.object({
        jobId: z.string(),
      }),
      execute: async ({ jobId }) => {
        if (!VIDEO_RENDER_MCP_KEY) {
          throw new Error("VIDEO_RENDER_MCP_KEY not set on paperloft server");
        }
        const res = await fetch(
          `https://video-render.regiq.in/api/jobs/${encodeURIComponent(jobId)}`,
          {
            headers: {
              Authorization: `Bearer ${VIDEO_RENDER_MCP_KEY}`,
              Accept: "application/json",
            },
          },
        );
        if (!res.ok) {
          throw new Error(`video-render status: HTTP ${res.status}`);
        }
        return (await res.json()) as Record<string, unknown>;
      },
    }),
  };
}
