/**
 * Shared types for the nova-reminders skill.
 *
 * The skill is intentionally channel-agnostic. It emits `MessageEnvelope`s that
 * a host-side channel adapter (Telegram, WhatsApp, email, …) renders on the
 * user's default channel(s). Inbound button taps come back as `InboundEvent`s.
 */

export type ReminderType = "general" | "medication" | "appointment";

export type ReminderStatus = "pending" | "sent" | "cancelled" | "draft";

export type Recurrence =
  | "none"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | `every:${number}${"m" | "h"}`
  | `weekly:${string}`
  | { cron: string };

/** How much interaction we ask for on each fire. */
export type AckMode = "none" | "tap" | "reply";

/** A single button on a rendered reminder. */
export interface ReminderButton {
  /** Stable machine id — e.g. "taken", "snooze:10", "skip", "reschedule". */
  id: string;
  /** Human label — e.g. "Taken ✅". Emojis rendered where supported. */
  label: string;
}

/** Reminder — a scheduled series or a one-shot. */
export interface Reminder {
  id: string;
  userId: string;
  type: ReminderType;
  title: string;
  description: string | null;
  dueAt: Date;
  recurrence: Recurrence;
  recurrenceEnd: Date | null;
  status: ReminderStatus;
  ackMode: AckMode;
  /** Minutes offered for snooze — e.g. [5, 10]. Empty disables. */
  snoozeOffer: number[];
  /** Minutes after which we resend once if no ack. 0 disables. */
  escalateAfterMin: number;
  /** If this reminder came from a prescription, back-ref the row. */
  prescriptionId: string | null;
  /** Free-form UI/agent metadata. */
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** One firing of a reminder. Recurring series create many of these. */
export interface ReminderInstance {
  id: string;
  reminderId: string;
  userId: string;
  scheduledFor: Date;
  firedAt: Date | null;
  /** After ack/escalation/expiry. */
  ackState: "pending" | "acked" | "snoozed" | "missed" | "skipped";
  ackButtonId: string | null;
  ackAt: Date | null;
  /** If ackState=snoozed, the child instance we created. */
  snoozedToInstanceId: string | null;
  /** Delivery channels this fire went out on ("telegram", "whatsapp"…). */
  channels: string[];
  /** When we resent because ack window elapsed. Null if never. */
  escalatedAt: Date | null;
}

/** Structured med extracted from a prescription (image, PDF, or freetext). */
export interface Medication {
  name: string;
  dose: string | null;
  /** Human-readable: "twice daily", "every 8 hours", "as needed". */
  frequency: string;
  /** Parsed times of day when we know them: ["08:00", "20:00"]. */
  times: string[];
  /** Duration in days. Null = ongoing. */
  durationDays: number | null;
  /** "with food", "before sleep", etc. */
  notes: string | null;
}

/** All metadata we lift from a prescription — file kept 30d, this row forever. */
export interface Prescription {
  id: string;
  userId: string;
  patientName: string | null;
  doctorName: string | null;
  doctorRegistrationNo: string | null;
  hospitalOrClinic: string | null;
  prescriptionDate: Date | null;
  followUpDate: Date | null;
  diagnoses: string[];
  advice: string | null;
  medications: Medication[];
  /** Path to the raw file on disk. Nulled when purged (30d) or over quota. */
  fileRef: string | null;
  /** Pinned prescriptions survive the quota purge. */
  starred: boolean;
  /** Raw extracted text — always kept (small). */
  extractedText: string | null;
  createdAt: Date;
}

/** Per-user channel prefs — populated by host, read by skill. */
export interface UserChannel {
  userId: string;
  telegramChatId: string | null;
  whatsappNumber: string | null;
  defaultChannel: "telegram" | "whatsapp";
  fallbackChannel: "telegram" | "whatsapp" | null;
  /** Global user prefs. */
  askAckOnGeneral: boolean;
  /** Default snooze offers for new general reminders. */
  defaultSnoozeMinutes: number[];
}

// ────────────────────────────────────────────────────────────────────────────
// Channel envelope — the skill's only knowledge of "how to talk to users"
// ────────────────────────────────────────────────────────────────────────────

/** What the skill hands to the host to deliver. */
export interface MessageEnvelope {
  /** Correlation id. Host echoes this back on inbound events. */
  envelopeId: string;
  userId: string;
  /** Which reminder instance this fires. */
  instanceId: string;
  channels: Array<"telegram" | "whatsapp">;
  text: string;
  buttons: ReminderButton[];
  /** Optional file attachment (prescription preview, etc.). */
  attachment?: {
    kind: "image" | "pdf";
    path: string;
    caption?: string;
  };
}

/** Inbound from a channel adapter (button tap or freetext). */
export interface InboundEvent {
  userId: string;
  channel: "telegram" | "whatsapp";
  /** Set when the user tapped a button. */
  buttonPress?: {
    instanceId: string;
    buttonId: string;
  };
  /** Set when the user sent freetext (routed by NLP). */
  freetext?: {
    text: string;
    /** Optional attachment path (already saved by adapter). */
    attachmentPath?: string;
    attachmentKind?: "image" | "pdf";
  };
}

/** The skill's callback surface handed to the host. */
export interface SkillCallbacks {
  /** Called every time a reminder instance is ready to fire. */
  onFire: (env: MessageEnvelope) => Promise<void>;
  /** Called when we need to store a file on disk (returns absolute path). */
  saveUserFile: (
    userId: string,
    kind: "prescription",
    fileName: string,
    bytes: Buffer,
  ) => Promise<string>;
  /** Optional: called when a prescription file crosses the retention window. */
  purgeUserFile?: (absolutePath: string) => Promise<void>;
}
