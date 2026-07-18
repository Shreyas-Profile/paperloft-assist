// PATCH  /api/user-skills/[id]   → toggle enabled (body: { enabled: boolean })
// DELETE /api/user-skills/[id]   → remove

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

async function requireOwner(id: string, email: string) {
  const row = await prisma.userSkill.findUnique({
    where: { id },
    select: { userEmail: true },
  });
  if (!row || row.userEmail !== email) return null;
  return row;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const own = await requireOwner(id, email);
  if (!own) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled: boolean is required" }, { status: 400 });
  }

  const updated = await prisma.userSkill.update({
    where: { id },
    data: { enabled: body.enabled },
    select: { id: true, enabled: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const own = await requireOwner(id, email);
  if (!own) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.userSkill.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
