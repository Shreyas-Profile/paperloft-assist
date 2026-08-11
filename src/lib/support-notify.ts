// Telegram DM to the admin(s) when a new SupportTicket lands.
//
// Runs after triage so the admin sees the AI's take alongside the raw
// text — one message, everything they need to decide "look at this now
// vs later". Fire-and-forget: if Telegram is flaky we still keep the
// ticket in the DB and the admin can catch up via /admin/support.

import { prisma } from "./db";
import { sendTelegramToChatId } from "./telegram-bot";
import { isAdmin } from "./admin";
import type { TriageResult } from "./support-triage";

// Public base URL for links back to the admin page — same env the sign-in
// flow uses. Falls back to the prod domain so local-dev tickets still
// produce a clickable URL (just one that opens the wrong environment).
function adminUrlFor(ticketId: string): string {
  const base = (process.env.AUTH_URL ?? "https://paperloft.uk").replace(
    /\/$/,
    "",
  );
  return `${base}/admin/support/${ticketId}`;
}

/**
 * Look up every admin's Telegram chatId (via the telegram_links table)
 * and DM them a ticket summary. Silent no-op for admins who haven't
 * linked Telegram — those admins get the ticket via /admin/support
 * refresh.
 */
export async function notifyAdminsOfTicket(input: {
  ticketId: string;
  ticketNumber: number;
  title: string;
  body: string;
  submitterName: string;
  submitterEmail?: string | null;
  triage: TriageResult;
}): Promise<void> {
  // Grab all telegram_links whose userEmail is an admin. Small table,
  // full scan is fine.
  const links = await prisma.telegramLink.findMany({
    select: { userEmail: true, chatId: true },
  });
  const adminLinks = links.filter((l) => isAdmin(l.userEmail));
  if (adminLinks.length === 0) {
    console.warn(
      `[support-notify] ticket ${input.ticketId} has no linked admin — visible only in /admin/support`,
    );
    return;
  }

  const priorityLabel = input.triage.priority.toUpperCase();
  const categoryLabel = input.triage.category;
  const reporter =
    input.submitterEmail && input.submitterEmail.trim().length > 0
      ? `${input.submitterName} <${input.submitterEmail}>`
      : input.submitterName;

  // Feedback body first, bold + quoted so it's impossible to miss in the
  // Telegram thread. Metadata (ticket #, category, AI take, submitter,
  // files, notes) comes AFTER — a bad ticket format used to bury the
  // actual feedback under the triage summary, which meant the admin had
  // to hunt for the user's own words.
  //
  // MarkdownV2 has hard escaping rules; the bot uses classic Markdown
  // (parse_mode=Markdown), so we escape backticks + asterisks only, keep
  // the rest as-is, and use blockquote formatting (>) for the body.
  const escapeForMd = (s: string) =>
    s.replace(/([`*_])/g, "\\$1").replace(/\n/g, "\n> ");
  const quotedBody = "> *" + escapeForMd(input.body.trim()) + "*";

  const filesLine =
    input.triage.suggestedFiles.length > 0
      ? "\n📎 Files: " +
        input.triage.suggestedFiles.map((f) => `\`${f}\``).join(", ")
      : "";
  const notesLine = input.triage.notes ? `\n📝 _${input.triage.notes}_` : "";

  const text =
    `💬 *Feedback #${input.ticketNumber}* — ${priorityLabel} · ${categoryLabel}\n\n` +
    `${quotedBody}\n\n` +
    `👤 ${reporter}\n` +
    `🎯 _${input.triage.summary}_${filesLine}${notesLine}\n\n` +
    `↗️ ${adminUrlFor(input.ticketId)}`;

  await Promise.allSettled(
    adminLinks.map((l) => sendTelegramToChatId(l.chatId, text)),
  );
}
