import { tool } from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import type { SkillContext } from "../context";
import { extractFromFile, extractFromText, type ExtractedPrescription } from "../prescription/extract";
import { enforceQuota } from "../prescription/retention";
import { serializeRecurrence } from "../recurrence";
import type { Medication } from "../types";

/**
 * Two-phase flow:
 *   1. prescription_ingest → runs extraction, stores metadata, returns a
 *      preview payload the agent can show the user (including proposed
 *      reminders). File is stored in the user's dir.
 *   2. prescription_confirm → creates the reminders after user approval,
 *      with any user-supplied edits to the extracted meds.
 */

export function prescriptionIngest(ctx: SkillContext) {
  return tool({
    description:
      "Extract structured data (doctor, hospital, meds, follow-up) from a prescription. Accepts either a `filePath` (image or PDF) OR `text` (user typed the prescription). Returns a preview with proposed medication reminders — call `prescription_confirm` after the user approves.",
    inputSchema: z.object({
      filePath: z.string().optional(),
      fileKind: z.enum(["image", "pdf"]).optional(),
      text: z.string().optional(),
      /** Optional file name for storage. Ignored when text is used. */
      fileName: z.string().optional(),
    }),
    execute: async (input) => {
      let extracted: ExtractedPrescription;
      let storedPath: string | null = null;

      if (input.filePath) {
        const kind = input.fileKind ?? guessKind(input.filePath);
        extracted = await extractFromFile(ctx, { path: input.filePath, kind });
        try {
          const bytes = readFileSync(input.filePath);
          storedPath = await ctx.callbacks.saveUserFile(
            ctx.userId,
            "prescription",
            input.fileName ?? input.filePath.split(/[\\/]/).pop() ?? "prescription",
            bytes,
          );
        } catch (e) {
          // Non-fatal: metadata still lands, just no file kept.
          console.warn("[nova-reminders] failed to store prescription file:", (e as Error).message);
        }
      } else if (input.text) {
        extracted = await extractFromText(ctx, input.text);
      } else {
        return { error: "Provide either `filePath` or `text`." };
      }

      const row = await ctx.prisma.prescription.create({
        data: {
          userId: ctx.userId,
          patientName: extracted.patientName,
          doctorName: extracted.doctorName,
          doctorRegistrationNo: extracted.doctorRegistrationNo,
          hospitalOrClinic: extracted.hospitalOrClinic,
          prescriptionDate: extracted.prescriptionDate,
          followUpDate: extracted.followUpDate,
          diagnoses: extracted.diagnoses,
          advice: extracted.advice,
          medications: extracted.medications as unknown as object,
          extractedText: extracted.extractedText,
          fileRef: storedPath,
        },
      });

      const purge = storedPath ? await enforceQuota(ctx, ctx.userId) : { purgedIds: [] };

      return {
        prescriptionId: row.id,
        preview: {
          doctorName: extracted.doctorName,
          hospitalOrClinic: extracted.hospitalOrClinic,
          prescriptionDate: extracted.prescriptionDate?.toISOString().slice(0, 10) ?? null,
          followUpDate: extracted.followUpDate?.toISOString().slice(0, 10) ?? null,
          diagnoses: extracted.diagnoses,
          medications: extracted.medications,
          advice: extracted.advice,
        },
        proposedReminders: buildProposedReminders(extracted.medications),
        purgedOverQuota: purge.purgedIds,
      };
    },
  });
}

function guessKind(path: string): "image" | "pdf" {
  return /\.(pdf)$/i.test(path) ? "pdf" : "image";
}

/** Build human-readable reminder proposals for the preview. */
function buildProposedReminders(meds: Medication[]) {
  return meds.map((m) => ({
    title: `Take ${m.name}${m.dose ? " " + m.dose : ""}`.trim(),
    times: m.times.length ? m.times : suggestTimes(m.frequency),
    durationDays: m.durationDays,
    notes: m.notes,
    frequencyLabel: m.frequency,
  }));
}

function suggestTimes(freq: string): string[] {
  const f = freq.toLowerCase();
  if (/once|1 time|daily|per day\b|\bod\b/.test(f)) return ["09:00"];
  if (/twice|2 times|bd\b|bid\b/.test(f)) return ["09:00", "21:00"];
  if (/thrice|3 times|tds\b|tid\b/.test(f)) return ["08:00", "14:00", "20:00"];
  if (/4 times|qid\b/.test(f)) return ["07:00", "12:00", "17:00", "22:00"];
  if (/every 8 hours/.test(f)) return ["08:00", "16:00", "00:00"];
  if (/every 6 hours/.test(f)) return ["06:00", "12:00", "18:00", "00:00"];
  if (/every 12 hours/.test(f)) return ["09:00", "21:00"];
  return [];
}

export function prescriptionConfirm(ctx: SkillContext) {
  return tool({
    description:
      "Confirm a prescription preview and create the reminders. Pass the prescriptionId returned by `prescription_ingest`. Optionally override the medications (same shape as the preview) if the user made edits like adjusting the time.",
    inputSchema: z.object({
      prescriptionId: z.string(),
      /** Optional user-edited meds. If omitted, uses what was extracted. */
      medications: z
        .array(
          z.object({
            name: z.string(),
            dose: z.string().nullable().optional(),
            frequency: z.string(),
            times: z.array(z.string()),
            durationDays: z.number().nullable().optional(),
            notes: z.string().nullable().optional(),
          }),
        )
        .optional(),
      /** Optional first-dose date (YYYY-MM-DD). Defaults to today. */
      startDate: z.string().optional(),
    }),
    execute: async (input) => {
      const p = await ctx.prisma.prescription.findFirst({
        where: { id: input.prescriptionId, userId: ctx.userId },
      });
      if (!p) return { error: "Prescription not found" };

      const meds = (input.medications ?? (p.medications as unknown as Medication[])) as Medication[];
      const startDate = input.startDate ? new Date(input.startDate) : new Date();

      const createdIds: string[] = [];
      for (const m of meds) {
        if (!m.times.length) {
          // Skip if we don't know when to fire; leave as-is for user to edit.
          continue;
        }
        for (const t of m.times) {
          const [hh, mm] = t.split(":").map((s) => parseInt(s, 10));
          const due = new Date(startDate);
          due.setHours(hh || 9, mm || 0, 0, 0);
          if (due < new Date()) due.setDate(due.getDate() + 1);

          const recEnd =
            m.durationDays != null
              ? new Date(due.getTime() + m.durationDays * 86_400_000)
              : null;

          const r = await ctx.prisma.reminder.create({
            data: {
              userId: ctx.userId,
              type: "medication",
              title: `Take ${m.name}${m.dose ? " " + m.dose : ""}`.trim(),
              description: m.notes ?? null,
              dueAt: due,
              recurrence: serializeRecurrence("daily"),
              recurrenceEnd: recEnd,
              ackMode: "tap",
              snoozeOffer: [],
              escalateAfterMin: 10,
              prescriptionId: p.id,
              metadata: { fromPrescription: p.id, frequency: m.frequency },
            },
          });
          createdIds.push(r.id);
        }
      }

      // Follow-up appointment reminder
      if (p.followUpDate) {
        const r = await ctx.prisma.reminder.create({
          data: {
            userId: ctx.userId,
            type: "appointment",
            title: `Follow-up with ${p.doctorName ?? "your doctor"}`,
            description: p.hospitalOrClinic,
            dueAt: p.followUpDate,
            recurrence: "none",
            ackMode: "tap",
            snoozeOffer: [],
            escalateAfterMin: 0,
            prescriptionId: p.id,
          },
        });
        createdIds.push(r.id);
      }

      return { createdReminderIds: createdIds, count: createdIds.length };
    },
  });
}

export function prescriptionList(ctx: SkillContext) {
  return tool({
    description:
      "List the user's past prescriptions with doctor, hospital, date, and med count. Use for 'when did I last see X?' or 'show my prescriptions'.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional().default(10),
      starredOnly: z.boolean().optional(),
    }),
    execute: async (input) => {
      const rows = await ctx.prisma.prescription.findMany({
        where: {
          userId: ctx.userId,
          ...(input.starredOnly ? { starred: true } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          doctorName: true,
          hospitalOrClinic: true,
          prescriptionDate: true,
          followUpDate: true,
          diagnoses: true,
          medications: true,
          starred: true,
          fileRef: true,
          createdAt: true,
        },
      });
      return {
        count: rows.length,
        prescriptions: rows.map((r: {
          id: string;
          doctorName: string | null;
          hospitalOrClinic: string | null;
          prescriptionDate: Date | null;
          followUpDate: Date | null;
          diagnoses: string[];
          medications: unknown;
          starred: boolean;
          fileRef: string | null;
          createdAt: Date;
        }) => ({
          id: r.id,
          doctorName: r.doctorName,
          hospitalOrClinic: r.hospitalOrClinic,
          prescriptionDate: r.prescriptionDate?.toISOString().slice(0, 10) ?? null,
          followUpDate: r.followUpDate?.toISOString().slice(0, 10) ?? null,
          diagnoses: r.diagnoses,
          medicationCount: Array.isArray(r.medications) ? r.medications.length : 0,
          starred: r.starred,
          hasFile: !!r.fileRef,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  });
}

export function prescriptionStar(ctx: SkillContext) {
  return tool({
    description:
      "Pin (or unpin) a prescription so its file survives the quota purge. Metadata is always kept; this only affects the raw file retention.",
    inputSchema: z.object({
      id: z.string(),
      starred: z.boolean(),
    }),
    execute: async ({ id, starred }) => {
      const r = await ctx.prisma.prescription.updateMany({
        where: { id, userId: ctx.userId },
        data: { starred },
      });
      return { updated: r.count > 0 };
    },
  });
}
