// GET  /api/user-skills           → list current user's BYO skills (safe fields)
// POST /api/user-skills           → add one: verify endpoint, cache tools, encrypt headers
//
// Headers arrive plaintext in the POST body. They are encrypted with the
// paperloft-side USER_SKILL_ENCRYPTION_KEY before persistence and are
// never returned in any GET response — the UI only shows name/URL/tool
// count/enabled state.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  MAX_SKILLS_PER_USER,
  discoverTools,
  validateSkillName,
  type CachedTool,
} from "@/lib/user-skills";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.userSkill.findMany({
    where: { userEmail: email },
    orderBy: { addedAt: "desc" },
    select: {
      id: true,
      name: true,
      mcpUrl: true,
      enabled: true,
      addedAt: true,
      lastVerifiedAt: true,
      tools: true,
    },
  });
  return NextResponse.json({
    skills: rows.map((r) => ({
      ...r,
      toolCount: Array.isArray(r.tools) ? r.tools.length : 0,
      tools: undefined,
    })),
    max: MAX_SKILLS_PER_USER,
  });
}

interface AddBody {
  name?: string;
  mcpUrl?: string;
  headers?: Record<string, string>;
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as AddBody;
  if (!body.mcpUrl || typeof body.mcpUrl !== "string") {
    return NextResponse.json({ error: "mcpUrl is required" }, { status: 400 });
  }

  let name: string;
  try {
    name = validateSkillName(body.name ?? "");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Sanitize headers: string→string only, cap at 32 headers, 4KB total.
  const rawHeaders = body.headers ?? {};
  const headers: Record<string, string> = {};
  let totalBytes = 0;
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof v !== "string" || !k) continue;
    headers[k] = v;
    totalBytes += k.length + v.length;
  }
  if (Object.keys(headers).length > 32 || totalBytes > 4096) {
    return NextResponse.json(
      { error: "headers too large (max 32 entries / 4KB combined)" },
      { status: 400 },
    );
  }

  // Cap total skills per user.
  const count = await prisma.userSkill.count({ where: { userEmail: email } });
  if (count >= MAX_SKILLS_PER_USER) {
    return NextResponse.json(
      { error: `you already have ${MAX_SKILLS_PER_USER} skills — delete one before adding another` },
      { status: 400 },
    );
  }

  // Enforce unique slug per user before we spend time hitting the MCP.
  const existing = await prisma.userSkill.findUnique({
    where: { userEmail_name: { userEmail: email, name } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `you already have a skill named "${name}"` },
      { status: 400 },
    );
  }

  // Discover tools — this is the "does this URL actually speak MCP?" check.
  let discovered: CachedTool[];
  try {
    discovered = await discoverTools(body.mcpUrl, headers);
  } catch (err) {
    return NextResponse.json(
      { error: `couldn't connect: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const headersEncrypted = Object.keys(headers).length
    ? encrypt(JSON.stringify(headers))
    : null;

  const created = await prisma.userSkill.create({
    data: {
      userEmail: email,
      name,
      mcpUrl: body.mcpUrl,
      headersEncrypted,
      tools: discovered as unknown as object,
      lastVerifiedAt: new Date(),
    },
    select: { id: true, name: true, mcpUrl: true, enabled: true, addedAt: true },
  });

  return NextResponse.json({
    skill: { ...created, toolCount: discovered.length },
    tools: discovered.map((t) => ({ name: t.name, description: t.description })),
  });
}
