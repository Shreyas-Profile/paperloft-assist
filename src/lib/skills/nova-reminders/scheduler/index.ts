/**
 * Scheduler — the poll loop the host wires into its process manager.
 *
 * Responsibilities:
 *   1. Find reminders whose `dueAt` has passed and status='pending'; fire them.
 *   2. Find `ReminderInstance` rows past their escalation window; resend once.
 *   3. Find instances still pending well past escalation; mark 'missed'.
 *   4. For recurring reminders, roll forward `dueAt` to the next occurrence.
 *
 * The scheduler is stateless between ticks — safe to run one instance per
 * process. Multiple concurrent runners would double-fire (add a lock later
 * if we ever run more than one).
 */

import type { SkillContext } from "../context";
import { buildEnvelope } from "../envelope";
import { nextOccurrence, parseRecurrence } from "../recurrence";
import type { Reminder, ReminderInstance } from "../types";

interface TickOptions {
  /** ms — how far past dueAt we consider fireable. Default 30s. */
  fireGraceMs?: number;
  /** ms — after this without ack (and if reminder has escalate>0), resend. */
  now?: () => Date;
}

const DEFAULT_TICK: Required<Omit<TickOptions, "now">> & { now: () => Date } = {
  fireGraceMs: 30_000,
  now: () => new Date(),
};

/**
 * Called by the host every N seconds (recommend 30s).
 * Uses the host-provided prisma client — no direct DB access.
 */
export async function tick(
  makeCtx: (userId: string) => SkillContext,
  opts: TickOptions = {},
): Promise<{ fired: number; escalated: number; missed: number; rolled: number }> {
  const { fireGraceMs, now } = { ...DEFAULT_TICK, ...opts };
  const cutoff = new Date(now().getTime() - fireGraceMs);

  // We need a prisma client to search across users — the host builds a "system"
  // context by passing a dummy user id; DB queries below don't filter by it.
  const systemCtx = makeCtx("__system__");
  const prisma = systemCtx.prisma;

  let fired = 0;
  let escalated = 0;
  let missed = 0;
  let rolled = 0;

  // 1. Fire due reminders — pending status AND either no instance yet for
  //    this dueAt, OR a pending instance that hasn't been fired.
  const dueReminders = await prisma.reminder.findMany({
    where: {
      status: "pending",
      dueAt: { lte: now() },
    },
    orderBy: { dueAt: "asc" },
    take: 500,
  });

  for (const r of dueReminders as unknown as Reminder[]) {
    // Look for an existing pending instance for this dueAt
    let inst = (await prisma.reminderInstance.findFirst({
      where: {
        reminderId: r.id,
        scheduledFor: r.dueAt,
      },
    })) as unknown as ReminderInstance | null;

    if (!inst) {
      inst = (await prisma.reminderInstance.create({
        data: {
          reminderId: r.id,
          userId: r.userId,
          scheduledFor: r.dueAt,
          ackState: "pending",
        },
      })) as unknown as ReminderInstance;
    }

    // If already fired and ack pending, leave it — escalation loop handles.
    if (inst.firedAt) continue;

    const userCtx = makeCtx(r.userId);
    const pref = await prisma.userChannelPref.findUnique({
      where: { userId: r.userId },
    });
    const channels: Array<"telegram" | "whatsapp"> = pref
      ? [pref.defaultChannel as "telegram" | "whatsapp"]
          .concat(pref.fallbackChannel ? [pref.fallbackChannel as "telegram" | "whatsapp"] : [])
      : ["telegram"];

    const env = buildEnvelope(r, inst, channels);
    try {
      await userCtx.callbacks.onFire(env);
      await prisma.reminderInstance.update({
        where: { id: inst.id },
        data: { firedAt: now(), channels },
      });
      fired++;
    } catch (e) {
      console.warn(
        `[nova-reminders] onFire failed for reminder ${r.id}:`,
        (e as Error).message,
      );
      continue; // leave inst without firedAt so we retry next tick
    }

    // Recurrence: roll dueAt forward or close the reminder out
    const rec = parseRecurrence(r.recurrence as unknown as string);
    const next = nextOccurrence(r.dueAt, rec);
    if (next && (!r.recurrenceEnd || next <= r.recurrenceEnd)) {
      await prisma.reminder.update({
        where: { id: r.id },
        data: { dueAt: next },
      });
      rolled++;
    } else {
      // One-shot or end of series
      await prisma.reminder.update({
        where: { id: r.id },
        data: { status: "sent" },
      });
    }
  }

  // 2. Escalation — resend once for pending instances past their window.
  //    We only touch reminders with escalateAfterMin > 0.
  const escalatable = (await prisma.reminderInstance.findMany({
    where: {
      ackState: "pending",
      firedAt: { not: null, lte: cutoff },
      escalatedAt: null,
    },
    orderBy: { firedAt: "asc" },
    take: 200,
    include: { reminder: true },
  })) as unknown as Array<ReminderInstance & { reminder: Reminder }>;

  for (const inst of escalatable) {
    const r = inst.reminder;
    if (!r.escalateAfterMin || r.escalateAfterMin <= 0) continue;
    if (!inst.firedAt) continue;
    const escalateAt = new Date(
      inst.firedAt.getTime() + r.escalateAfterMin * 60_000,
    );
    if (escalateAt > now()) continue;

    const userCtx = makeCtx(r.userId);
    const env = buildEnvelope(r, inst, inst.channels as Array<"telegram" | "whatsapp">);
    try {
      await userCtx.callbacks.onFire({ ...env, text: `⏰ Reminder: ${env.text}` });
      await prisma.reminderInstance.update({
        where: { id: inst.id },
        data: { escalatedAt: now() },
      });
      escalated++;
    } catch (e) {
      console.warn(
        `[nova-reminders] escalation onFire failed for ${inst.id}:`,
        (e as Error).message,
      );
    }
  }

  // 3. Missed — pending instances escalated but still unacked after a
  //    generous window (2x escalate window). Mark as missed and move on.
  const missedCandidates = (await prisma.reminderInstance.findMany({
    where: {
      ackState: "pending",
      escalatedAt: { not: null, lte: cutoff },
    },
    include: { reminder: true },
    take: 200,
  })) as unknown as Array<ReminderInstance & { reminder: Reminder }>;

  for (const inst of missedCandidates) {
    if (!inst.escalatedAt) continue;
    const missAt = new Date(
      inst.escalatedAt.getTime() + inst.reminder.escalateAfterMin * 60_000,
    );
    if (missAt > now()) continue;
    await prisma.reminderInstance.update({
      where: { id: inst.id },
      data: { ackState: "missed" },
    });
    missed++;
  }

  return { fired, escalated, missed, rolled };
}
