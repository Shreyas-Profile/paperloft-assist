/**
 * @pakki10/nova-reminders — main entrypoint.
 *
 * Import in the host:
 *
 *   import { createReminderSkill } from "@pakki10/nova-reminders";
 *   const skill = createReminderSkill({ prisma, userId, callbacks, llm });
 *   const tools = skill.tools;   // register with your ai-sdk agent
 *
 * The host is also responsible for:
 *   1. Adding the Prisma models from `prisma/schema.prisma` to its own schema.
 *   2. Running the scheduler on a poll loop (`import { tick } from "@pakki10/nova-reminders/scheduler"`).
 *   3. Wiring channel adapters (Telegram / WhatsApp) to render envelopes and
 *      route inbound button/text back to `handleInbound()`.
 */

import type { ToolSet } from "ai";
import type { SkillContext } from "./context";
import type { InboundEvent } from "./types";

import {
  reminderCreate,
  reminderList,
  reminderGet,
  reminderUpdate,
  reminderDelete,
  reminderDeleteMany,
} from "./tools/reminder-crud";
import {
  prescriptionIngest,
  prescriptionConfirm,
  prescriptionList,
  prescriptionStar,
} from "./tools/prescription";
import { reminderAck, missedList } from "./tools/ack";
import { channelPrefsGet, channelPrefsUpdate } from "./tools/channel-prefs";

/** System-prompt fragment to hand to the agent so it uses the tools well. */
export const SKILL_SYSTEM_PROMPT = `You can manage reminders using the reminder_* tools.

CRITICAL: NEVER confirm that a reminder was set / updated / deleted / acked
unless you actually CALLED the corresponding tool THIS TURN and got a
success response. Do not say "✅ Reminder set" or "Done, I've scheduled..."
based on your intent alone — that's a hallucination that costs the user a
missed reminder. If for any reason you couldn't call the tool, tell the
user "I couldn't set that reminder — please try again" instead of pretending
you did.

When the user wants to set a reminder:
1. Parse the natural-language date/time against the current UTC time given
   in the system prompt. Convert to ISO 8601 UTC.
2. Call reminder_create with { title, dueAt, type, recurrence?, description? }.
   type: "general" | "medication" | "appointment".
3. ONLY after reminder_create returns success, confirm to the user with the
   exact time in a friendly relative format ("tomorrow at 9 AM").

Recurrence rules:
  • Fixed: hourly | daily | weekdays (Mon-Fri) | weekly | monthly | quarterly | yearly
  • Interval: every:<N>m (N>=5, minutes) or every:<N>h (hours) — e.g. every:15m, every:2h, every:6h
  • Weekly by day: weekly:<day>[,<day>...] using mon/tue/wed/thu/fri/sat/sun — e.g. weekly:wed, weekly:mon,wed,fri
Examples:
  • "every morning at 9am" → recurrence: "daily"
  • "every weekday at 5pm" → recurrence: "weekdays"
  • "every 30 minutes" → recurrence: "every:30m"
  • "every 2 hours" → recurrence: "every:2h"
  • "every Wednesday at 3pm" → recurrence: "weekly:wed" AND set dueAt to the NEXT Wednesday 3pm
  • "Mondays, Wednesdays, and Fridays at 8am" → recurrence: "weekly:mon,wed,fri" AND set dueAt to the next of those days at 8am
  • "every 3 months" or "quarterly" → recurrence: "quarterly"
  • birthdays / anniversaries → recurrence: "yearly"
Use recurrenceEnd if the user specifies an end date.

When the user wants to see, edit, or delete a SPECIFIC reminder ("change the BP one to 10am", "delete the water reminder"):
1. ALWAYS call reminder_list FIRST to get the current ids and current values.
2. If more than one reminder matches the user's description (e.g. they say "the medication one" but they have three), reply with a numbered list and ask which one — do NOT guess.
3. Only THEN call reminder_update / reminder_delete with the specific ID from that list.
4. ONLY confirm after the tool returns success.
NEVER pass an id you haven't just seen in a reminder_list response this turn. Guessed ids fail silently ({updated: false}) and the user thinks it worked.

When the user wants to bulk-delete ("delete all my reminders", "clear
everything", "remove them all", "cancel every reminder I have"):
- Prefer reminder_delete_many in ONE call. Two shapes:
  a) reminder_delete_many({ status: "all" }) — nukes every reminder the
     user has regardless of status. Use when the user says "everything"
     with no qualifier.
  b) reminder_list(status: "all") FIRST to get ids, then
     reminder_delete_many({ ids: [...] }) — use when you want to show
     the list before deleting or when you're deleting a subset.
- Do NOT loop reminder_delete one at a time — it burns the step budget
  and often stops mid-way, leaving reminders alive that the user asked
  to delete.
- After the call, reply with a single line summarising what was cancelled
  (the tool returns { cancelled: N }). Don't ask "shall I try again?"
  unless the tool actually returned an error.

Medication defaults: type="medication", Taken/Skip ack buttons.
Appointment defaults: type="appointment", Confirmed/Reschedule buttons.
General defaults: type="general", no ack buttons unless user asks.

Snooze is intentionally NOT supported. If a user asks to "snooze this
reminder for 10 min", DO NOT try to snooze — instead offer to create a
new one-shot reminder for 10 minutes from now, and if they agree, call
reminder_create with dueAt = now + 10 min. Do NOT reference an old fire
by instance id — those go stale fast.

Prescriptions: ALWAYS show the preview from prescription_ingest and let the
user approve before calling prescription_confirm. Never fabricate meds,
doctor names, or dosages — ask if unclear.

For batch reminders from CSV / file / voice list: create them ONE at a time
via reminder_create. Confirm the total count at the end, only after all
successful tool calls.

Users can talk in natural language: "move my BP med to 9am", "stop the
weekly one", "remind me in an hour" — parse and call the right tool.`;

/**
 * Build the skill for one acting user + one host request.
 * Call this per-request from the host chat surface.
 */
export function createReminderSkill(ctx: SkillContext): {
  tools: ToolSet;
  systemPrompt: string;
  handleInbound: (event: InboundEvent) => Promise<{ handled: boolean; result?: unknown }>;
} {
  const tools: ToolSet = {
    reminder_create: reminderCreate(ctx),
    reminder_list: reminderList(ctx),
    reminder_get: reminderGet(ctx),
    reminder_update: reminderUpdate(ctx),
    reminder_delete: reminderDelete(ctx),
    reminder_delete_many: reminderDeleteMany(ctx),
    reminder_ack: reminderAck(ctx),
    reminder_missed: missedList(ctx),
    prescription_ingest: prescriptionIngest(ctx),
    prescription_confirm: prescriptionConfirm(ctx),
    prescription_list: prescriptionList(ctx),
    prescription_star: prescriptionStar(ctx),
    channel_prefs_get: channelPrefsGet(ctx),
    channel_prefs_update: channelPrefsUpdate(ctx),
  };

  return {
    tools,
    systemPrompt: SKILL_SYSTEM_PROMPT,
    handleInbound: (event) => handleInbound(ctx, event),
  };
}

/**
 * Convert a button press into an ack. Adapters call this directly; the
 * agent is not in the loop for button clicks (they must be low-latency).
 */
export async function handleInbound(
  ctx: SkillContext,
  event: InboundEvent,
): Promise<{ handled: boolean; result?: unknown }> {
  if (event.buttonPress) {
    const { instanceId, buttonId } = event.buttonPress;
    // Snooze is not offered anymore; ignore any legacy snooze taps that
    // arrive from historical fires.
    if (buttonId.startsWith("snooze:")) {
      return { handled: false };
    }

    const state = buttonMap(buttonId);
    if (!state) return { handled: false };
    await ctx.prisma.reminderInstance.updateMany({
      where: { id: instanceId, userId: ctx.userId, ackState: "pending" },
      data: {
        ackState: state,
        ackButtonId: buttonId,
        ackAt: new Date(),
      },
    });
    return { handled: true, result: { state } };
  }

  // Freetext handling stays in the agent path — the host should route
  // inbound text to Nova's ops-agent, which will call our tools directly.
  return { handled: false };
}

function buttonMap(id: string): "acked" | "skipped" | null {
  if (id === "taken" || id === "confirmed" || id === "ack" || id === "done") return "acked";
  if (id === "skip" || id === "skipped") return "skipped";
  if (id === "reschedule") return "skipped"; // agent will follow up to schedule
  return null;
}

export { tick } from "./scheduler/index";
export * from "./types";
export { EXTRACTOR_SYSTEM_PROMPT } from "./prescription/extract";
export { purgeExpired, enforceQuota } from "./prescription/retention";
