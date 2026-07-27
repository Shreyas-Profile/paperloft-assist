// POST /api/admin/support/:id — admin-only ticket mutations.
// Body: { status: "open|in_progress|done|wont_fix" } OR { retriage: true }.
// Everything else is intentionally not exposed — no editing the body, no
// deleting rows (soft-delete via wont_fix instead). Keeps the audit trail
// clean.

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { triageTicket, fallbackTriage } from "@/lib/support-triage";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ status: z.enum(["open", "in_progress", "done", "wont_fix"]) }),
  z.object({ retriage: z.literal(true) }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const existing = await prisma.supportTicket.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if ("status" in parsed.data) {
    const isResolution =
      parsed.data.status === "done" || parsed.data.status === "wont_fix";
    await prisma.supportTicket.update({
      where: { id },
      data: {
        status: parsed.data.status,
        // Stamp resolvedAt on the first transition to done/wont_fix so
        // the audit trail shows how long tickets sat open.
        resolvedAt:
          isResolution && !existing.resolvedAt ? new Date() : existing.resolvedAt,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // retriage — re-run the LLM against the current title/body and store fresh.
  const triage = await triageTicket({
    title: existing.title,
    body: existing.body,
  }).catch(() => fallbackTriage());
  await prisma.supportTicket.update({
    where: { id },
    data: {
      aiTriage: triage as unknown as object,
      category: triage.category,
      priority: triage.priority,
    },
  });
  return NextResponse.json({ ok: true, triage });
}
