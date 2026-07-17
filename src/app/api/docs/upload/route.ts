// POST /api/docs/upload
//
// Proxies a chat-composer file upload to docs-mcp. Reads the multipart file
// out of the request, looks up the current user's docs-mcp SkillConnection
// (must have toggled Docs on at /skills first), and forwards to
// https://docs.regiq.in/api/upload with THEIR Bearer key. Returns the docId
// so the chat client can drop a reference into the outgoing user message.
//
// Guarantees isolation: paperloft never uses a shared docs-mcp key here —
// every upload lands in the caller's own tenant on docs-mcp.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSkillConnection } from "@/lib/skill-provisioning";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOCS_MCP_UPLOAD_URL =
  process.env.DOCS_MCP_UPLOAD_URL ?? "https://docs.regiq.in/api/upload";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const conn = await getSkillConnection(email, "docs_mcp");
  if (!conn) {
    return NextResponse.json(
      {
        error: "docs_skill_not_enabled",
        message: "Enable the Docs skill at /skills first, then re-try the upload.",
      },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "expected multipart form field 'file'" },
      { status: 400 },
    );
  }

  // Rebuild a fresh multipart FormData for docs-mcp — passing the original
  // through isn't safe with Next.js's parsed formData object.
  const outbound = new FormData();
  outbound.append("file", file, file.name);

  const upstream = await fetch(DOCS_MCP_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.remoteApiKey}` },
    body: outbound,
  });
  const body = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "docs_mcp_rejected", status: upstream.status, message: body.slice(0, 400) },
      { status: 400 },
    );
  }
  const data = JSON.parse(body) as {
    id: string;
    status: string;
    filename: string;
    duplicated?: boolean;
  };
  return NextResponse.json({
    docId: data.id,
    filename: data.filename,
    status: data.status,
    duplicated: !!data.duplicated,
  });
}
