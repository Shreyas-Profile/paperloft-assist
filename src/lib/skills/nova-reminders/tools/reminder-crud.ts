import { tool } from "ai";
import { z } from "zod";
import type { SkillContext } from "../context";
import { serializeRecurrence } from "../recurrence";

const recurrenceEnum = z.enum([
  "none",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
]);

const reminderTypeEnum = z.enum(["general", "medication", "appointment"]);
const ackModeEnum = z.enum(["none", "tap", "reply"]);

export function reminderCreate(ctx: SkillContext) {
  return tool({
    description:
      "Create a reminder. `type` defaults to 'general'; use 'medication' for pill/dose reminders and 'appointment' for one-shot visits. `dueAt` is ISO 8601. Set `recurrence` for repeating reminders. Medication reminders get Taken/Snooze/Skip buttons by default; general reminders are silent unless `ackMode` is set to 'tap'.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      dueAt: z.string().describe("ISO 8601 datetime"),
      description: z.string().optional(),
      type: reminderTypeEnum.optional(),
      recurrence: recurrenceEnum.optional(),
      recurrenceEnd: z.string().optional(),
      ackMode: ackModeEnum.optional(),
      snoozeMinutes: z.array(z.number().int().positive()).optional(),
      escalateAfterMin: z.number().int().min(0).optional(),
      prescriptionId: z.string().optional(),
    }),
    execute: async (input) => {
      // Hard cap: 200 active reminders per user. Prevents the DB and the
      // scheduler from blowing up if an agent creates reminders in a loop.
      // Users see a clear "delete some to add more" message.
      const activeCount = await ctx.prisma.reminder.count({
        where: { userId: ctx.userId, status: { in: ["pending", "sent"] } },
      });
      if (activeCount >= 200) {
        throw new Error(
          `You already have ${activeCount} active reminders (limit 200). Delete or cancel some first, then try again.`,
        );
      }

      // Minimum recurrence 1 minute — hourly and above are safe by definition.
      // We only need to guard against the (rare) cron:<expr> case where the
      // agent might supply an interval faster than a minute.
      if (input.recurrence && !["none", "hourly", "daily", "weekdays", "weekly", "monthly", "yearly"].includes(input.recurrence)) {
        throw new Error(
          `unsupported recurrence "${input.recurrence}". Use one of: none, hourly, daily, weekdays, weekly, monthly, yearly.`,
        );
      }

      const type = input.type ?? "general";
      const defaultAck =
        type === "medication" ? "tap" : type === "appointment" ? "tap" : "none";
      const ackMode = input.ackMode ?? defaultAck;
      const defaultSnooze =
        type === "medication" ? [10] : type === "appointment" ? [] : [];
      const snooze = input.snoozeMinutes ?? defaultSnooze;
      const escalate =
        input.escalateAfterMin ?? (type === "medication" ? 10 : 0);

      const r = await ctx.prisma.reminder.create({
        data: {
          userId: ctx.userId,
          type,
          title: input.title,
          description: input.description ?? null,
          dueAt: new Date(input.dueAt),
          recurrence: serializeRecurrence(input.recurrence ?? "none"),
          recurrenceEnd: input.recurrenceEnd ? new Date(input.recurrenceEnd) : null,
          ackMode,
          snoozeOffer: snooze,
          escalateAfterMin: escalate,
          prescriptionId: input.prescriptionId ?? null,
        },
      });
      return { id: r.id, dueAt: r.dueAt.toISOString(), type: r.type };
    },
  });
}

export function reminderList(ctx: SkillContext) {
  return tool({
    description:
      "List the user's reminders. Filter by status/type/date range. `status` defaults to 'pending'; pass 'all' when the user asks for EVERYTHING (past + current + cancelled), or a specific status when they want just one kind. Returns compact rows suitable for showing to the user.",
    inputSchema: z.object({
      status: z
        .enum(["pending", "sent", "cancelled", "draft", "all"])
        .optional()
        .default("pending"),
      type: reminderTypeEnum.optional(),
      limit: z.number().int().min(1).max(50).optional().default(20),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }),
    execute: async (input) => {
      const where: Record<string, unknown> = {
        userId: ctx.userId,
      };
      // 'all' means don't filter by status at all — the LLM reaches for this
      // when the user says "show me everything" or "all my reminders".
      if (input.status !== "all") {
        where.status = input.status;
      }
      if (input.type) where.type = input.type;
      if (input.fromDate || input.toDate) {
        const dueAt: Record<string, Date> = {};
        if (input.fromDate) dueAt.gte = new Date(input.fromDate);
        if (input.toDate) dueAt.lte = new Date(input.toDate);
        where.dueAt = dueAt;
      }
      const rows = await ctx.prisma.reminder.findMany({
        where,
        orderBy: { dueAt: "asc" },
        take: input.limit,
        select: {
          id: true,
          title: true,
          type: true,
          dueAt: true,
          recurrence: true,
          status: true,
        },
      });
      return {
        count: rows.length,
        reminders: rows.map((r: { id: string; title: string; type: string; dueAt: Date; recurrence: string; status: string }) => ({
          ...r,
          dueAt: r.dueAt.toISOString(),
        })),
      };
    },
  });
}

export function reminderGet(ctx: SkillContext) {
  return tool({
    description: "Get full details for a single reminder by id.",
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      const r = await ctx.prisma.reminder.findFirst({
        where: { id, userId: ctx.userId },
      });
      if (!r) return { error: "Not found" };
      return {
        ...r,
        dueAt: r.dueAt.toISOString(),
        recurrenceEnd: r.recurrenceEnd?.toISOString() ?? null,
      };
    },
  });
}

export function reminderUpdate(ctx: SkillContext) {
  return tool({
    description:
      "Update any subset of a reminder's fields. Use this when the user says things like 'change my BP reminder to 9am' or 'stop repeating after next month'.",
    inputSchema: z.object({
      id: z.string(),
      title: z.string().optional(),
      dueAt: z.string().optional(),
      description: z.string().optional(),
      recurrence: recurrenceEnum.optional(),
      recurrenceEnd: z.string().nullable().optional(),
      ackMode: ackModeEnum.optional(),
      snoozeMinutes: z.array(z.number().int().positive()).optional(),
    }),
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.dueAt !== undefined) data.dueAt = new Date(input.dueAt);
      if (input.description !== undefined) data.description = input.description;
      if (input.recurrence !== undefined) {
        data.recurrence = serializeRecurrence(input.recurrence);
      }
      if (input.recurrenceEnd !== undefined) {
        data.recurrenceEnd = input.recurrenceEnd
          ? new Date(input.recurrenceEnd)
          : null;
      }
      if (input.ackMode !== undefined) data.ackMode = input.ackMode;
      if (input.snoozeMinutes !== undefined) data.snoozeOffer = input.snoozeMinutes;

      const r = await ctx.prisma.reminder.updateMany({
        where: { id: input.id, userId: ctx.userId },
        data,
      });
      return { updated: r.count > 0 };
    },
  });
}

export function reminderDelete(ctx: SkillContext) {
  return tool({
    description:
      "Cancel a reminder (soft-delete: status → 'cancelled'). Use for 'stop reminding me about X' / 'delete the water reminder'.",
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      const r = await ctx.prisma.reminder.updateMany({
        where: { id, userId: ctx.userId },
        data: { status: "cancelled" },
      });
      return { cancelled: r.count > 0 };
    },
  });
}

export function reminderDeleteMany(ctx: SkillContext) {
  return tool({
    description:
      "Bulk-cancel reminders in a single call. Prefer this over looping reminder_delete when the user asks to remove multiple at once ('delete all my reminders', 'clear the medication ones'). Two modes: pass `ids` for a specific list, OR pass a filter (`status` and/or `type`) to cancel every matching reminder. Returns the count of reminders cancelled.",
    inputSchema: z
      .object({
        ids: z
          .array(z.string())
          .optional()
          .describe(
            "Explicit reminder ids to cancel. Combine with reminder_list to get ids for e.g. 'cancel everything I have' → list all, then pass those ids here.",
          ),
        status: z
          .enum(["pending", "sent", "cancelled", "draft", "all"])
          .optional()
          .describe(
            "Filter cancels to reminders in this status. Use 'all' to nuke every reminder regardless of status.",
          ),
        type: reminderTypeEnum
          .optional()
          .describe("Filter cancels by reminder type (medication/appointment/general)."),
      })
      .refine(
        (v) => (v.ids && v.ids.length > 0) || v.status || v.type,
        {
          message: "Must supply at least one of: ids, status, type.",
        },
      ),
    execute: async (input) => {
      const where: Record<string, unknown> = { userId: ctx.userId };
      if (input.ids && input.ids.length > 0) {
        where.id = { in: input.ids };
      }
      if (input.status && input.status !== "all") {
        where.status = input.status;
      }
      if (input.type) {
        where.type = input.type;
      }
      // Only cancel reminders that aren't already cancelled — avoids
      // "cancelled 30 reminders" when 25 were already dead.
      where.status = where.status ?? { not: "cancelled" };
      const r = await ctx.prisma.reminder.updateMany({
        where,
        data: { status: "cancelled" },
      });
      return { cancelled: r.count };
    },
  });
}
