// POST /api/support — public endpoint for the /support form.
// Persists the ticket, kicks off AI triage, then DMs any Telegram-linked
// admins with the AI summary. Triage + notification run in the background
// so the form response returns fast; the ticket exists in the DB the
// moment we respond 201.

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { triageTicket, fallbackTriage } from "@/lib/support-triage";
import { notifyAdminsOfTicket } from "@/lib/support-notify";

export const runtime = "nodejs";

const submitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(5).max(4000),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, email, title, body } = parsed.data;

  // If the reporter is signed in, tag the ticket with their identity so
  // the admin can reply via the same channel. Anonymous submissions are
  // fine — just leaves submitterUserId null.
  const session = await auth().catch(() => null);
  const submitterUserId = session?.user?.email ?? null;

  // Monotonic ticket number for humans. Race-safe enough at our scale
  // (single writer at a time in practice). If we ever hit high write
  // rates we'll swap this for a Postgres sequence.
  const priorMax = await prisma.supportTicket
    .aggregate({ _max: { ticketNumber: true } })
    .catch(() => ({ _max: { ticketNumber: 0 } }));
  const ticketNumber = (priorMax._max?.ticketNumber ?? 0) + 1;

  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber,
      submitterName: name,
      submitterEmail: email && email.length > 0 ? email : null,
      submitterUserId,
      title,
      body,
    },
  });

  // Fire-and-forget triage + Telegram. Any failure inside doesn't affect
  // the response — the ticket is already persisted. Admin can retry
  // triage from /admin/support/:id if this pass errors.
  runTriageAndNotify(ticket.id, ticket.ticketNumber, name, email, title, body).catch(
    (err) => console.error("[support] triage/notify pipeline failed:", err),
  );

  return NextResponse.json(
    { ok: true, ticketId: ticket.id, ticketNumber },
    { status: 201 },
  );
}

async function runTriageAndNotify(
  ticketId: string,
  ticketNumber: number,
  name: string,
  email: string | undefined,
  title: string,
  body: string,
) {
  const triage = await triageTicket({ title, body }).catch(() => fallbackTriage());
  await prisma.supportTicket
    .update({
      where: { id: ticketId },
      data: {
        aiTriage: triage as unknown as object,
        category: triage.category,
        priority: triage.priority,
      },
    })
    .catch((err) => console.error("[support] persist triage failed:", err));
  await notifyAdminsOfTicket({
    ticketId,
    ticketNumber,
    title,
    body,
    submitterName: name,
    submitterEmail: email,
    triage,
  }).catch((err) => console.error("[support] admin notify failed:", err));
}
