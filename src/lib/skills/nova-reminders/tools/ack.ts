import { tool } from "ai";
import { z } from "zod";
import type { SkillContext } from "../context";

/**
 * Ack tool — usually invoked by the host when it decodes an inbound button
 * press. Also callable by the agent when the user says "I took my meds"
 * without tapping a button.
 */
export function reminderAck(ctx: SkillContext) {
  return tool({
    description:
      "Acknowledge a reminder instance. `state` is 'acked' (taken/done) or 'skipped'. The `instanceId` identifies a specific firing — get it from the button press or by looking up the latest pending instance for a reminder. Snooze is intentionally not supported: if the user asks to postpone, offer to create a new reminder for the later time instead.",
    inputSchema: z.object({
      instanceId: z.string(),
      state: z.enum(["acked", "skipped"]),
      buttonId: z.string().optional(),
    }),
    execute: async (input) => {
      const inst = await ctx.prisma.reminderInstance.findFirst({
        where: { id: input.instanceId, userId: ctx.userId },
      });
      if (!inst) return { error: "Instance not found" };
      if (inst.ackState !== "pending") {
        return { alreadyAcked: true, state: inst.ackState };
      }

      await ctx.prisma.reminderInstance.update({
        where: { id: inst.id },
        data: {
          ackState: input.state,
          ackButtonId: input.buttonId ?? null,
          ackAt: new Date(),
        },
      });
      return { ok: true, state: input.state };
    },
  });
}

/**
 * Show missed instances since a cutoff. The agent surfaces this at the start
 * of a new chat: "you missed 2 BP meds yesterday".
 */
export function missedList(ctx: SkillContext) {
  return tool({
    description:
      "List reminder instances that fired but were never acked (state='missed'). Use at the start of a chat to nudge the user about missed medication.",
    inputSchema: z.object({
      sinceHours: z.number().int().positive().optional().default(48),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }),
    execute: async (input) => {
      const since = new Date(Date.now() - input.sinceHours * 3_600_000);
      const rows = await ctx.prisma.reminderInstance.findMany({
        where: {
          userId: ctx.userId,
          ackState: "missed",
          scheduledFor: { gte: since },
        },
        orderBy: { scheduledFor: "desc" },
        take: input.limit,
        include: {
          reminder: { select: { title: true, type: true } },
        },
      });
      return {
        count: rows.length,
        missed: rows.map((r: { id: string; scheduledFor: Date; reminder: { title: string; type: string } }) => ({
          instanceId: r.id,
          title: r.reminder.title,
          type: r.reminder.type,
          scheduledFor: r.scheduledFor.toISOString(),
        })),
      };
    },
  });
}
