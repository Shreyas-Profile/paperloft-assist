import { randomUUID } from "crypto";
import type { MessageEnvelope, Reminder, ReminderInstance, ReminderButton } from "./types";

/** Build the buttons that ship with a reminder based on its type + ackMode. */
export function buttonsFor(r: Reminder): ReminderButton[] {
  if (r.ackMode === "none") return [];
  const btns: ReminderButton[] = [];

  if (r.type === "medication") {
    btns.push({ id: "taken", label: "Taken ✅" });
    for (const m of r.snoozeOffer.length ? r.snoozeOffer : [10]) {
      btns.push({ id: `snooze:${m}`, label: `+${m} min ⏰` });
    }
    btns.push({ id: "skip", label: "Skip ❌" });
    return btns;
  }

  if (r.type === "appointment") {
    btns.push({ id: "confirmed", label: "Confirmed ✅" });
    btns.push({ id: "reschedule", label: "Reschedule" });
    return btns;
  }

  // general
  btns.push({ id: "ack", label: "Got it ✅" });
  for (const m of r.snoozeOffer) {
    btns.push({ id: `snooze:${m}`, label: `+${m} min ⏰` });
  }
  return btns;
}

/** Render the reminder body text. Kept short — channels have length quirks.
 * Scheduler already prepends "⏰ Reminder:" for general type; here we add
 * a friendlier verb for medication/appointment and just the title for
 * general (avoids the double-"Reminder:" that the scheduler prefix +
 * a verbal prefix here would produce). */
export function bodyFor(r: Reminder): string {
  const lines: string[] = [];
  const emoji =
    r.type === "medication" ? "💊" : r.type === "appointment" ? "📅" : "🔔";
  const prefix =
    r.type === "medication"
      ? `${emoji} Time to take: ${r.title}`
      : r.type === "appointment"
      ? `${emoji} Appointment: ${r.title}`
      : `${emoji} ${r.title}`;
  lines.push(prefix);
  if (r.description) lines.push("");
  if (r.description) lines.push(r.description);
  return lines.join("\n");
}

/** Build the outbound envelope for one instance fire. */
export function buildEnvelope(
  r: Reminder,
  inst: ReminderInstance,
  channels: Array<"telegram" | "whatsapp">,
): MessageEnvelope {
  return {
    envelopeId: randomUUID(),
    userId: r.userId,
    instanceId: inst.id,
    channels,
    text: bodyFor(r),
    buttons: buttonsFor(r),
  };
}
