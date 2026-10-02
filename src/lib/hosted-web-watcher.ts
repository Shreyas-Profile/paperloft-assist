// Web-watcher skill — Paperloft-native (no external MCP). The user asks
// "watch example.com" in chat, the skill records a target in the WebWatcher
// table, and a periodic poll compares each target's current content to its
// last snapshot. On any change, we DM the user via their linked Telegram
// chat.
//
// Snapshot shape:
//   - body hash (sha256 of script/style-stripped, whitespace-collapsed HTML)
//   - h1/h2/h3 text (first 60)
//   - same-origin or in-scope links (first 80)
//
// This matches what marketops-mcp uses on the Globalion marketing side —
// stable across renders, noisy only when something real changes.

import { tool } from "ai";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "./db";
import { sendTelegramToChatId } from "./telegram-bot";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PaperloftWebWatcher/1.0; +https://paperloft.uk)";

export interface PollResult {
  id: string;
  url: string;
  status: "baseline" | "unchanged" | "changed" | "error";
  detail?: string;
  newHeadings?: string[];
  removedHeadings?: string[];
  newLinks?: string[];
  notified?: boolean;
}

// ---------- helpers (shared with marketops-mcp site-watcher) ---------------
// Pure helpers are exported for unit tests. They do no IO.

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export function hashHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/nonce=["'][^"']+["']/g, "")
    .replace(/\s+/g, " ")
    // Strip pure whitespace between tags so pretty-printed HTML hashes the
    // same as minified HTML (otherwise every curl -s diff looks "changed").
    .replace(/>\s+</g, "><")
    .trim();
  return crypto.createHash("sha256").update(stripped).digest("hex").slice(0, 16);
}

export function extractSignals(html: string): { headings: string[]; links: string[] } {
  const headings: string[] = [];
  const headingRe = /<(h[123])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null) {
    const text = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text && text.length < 200) headings.push(text);
  }
  const links = new Set<string>();
  const linkRe = /<a[^>]+href=["']([^"']+)["']/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].split("?")[0].split("#")[0].trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (href.length > 200) continue;
    links.add(href);
  }
  return {
    headings: Array.from(new Set(headings)).slice(0, 60),
    links: Array.from(links).slice(0, 80),
  };
}

export function fmtChange(watcher: { url: string; label: string | null }, res: PollResult): string {
  const host = new URL(res.url).host;
  const title = watcher.label ? `${watcher.label} (${host})` : host;
  const lines: string[] = [`\u{1F440} ${title} changed.`];
  if (res.newHeadings && res.newHeadings.length > 0) {
    lines.push("", "New sections:");
    res.newHeadings.slice(0, 6).forEach((h) => lines.push(`• ${h}`));
    if (res.newHeadings.length > 6) lines.push(`… +${res.newHeadings.length - 6} more`);
  }
  if (res.newLinks && res.newLinks.length > 0) {
    lines.push("", "New links/pages:");
    res.newLinks.slice(0, 6).forEach((l) => lines.push(`• ${l}`));
    if (res.newLinks.length > 6) lines.push(`… +${res.newLinks.length - 6} more`);
  }
  if (res.removedHeadings && res.removedHeadings.length > 0) {
    lines.push("", "Removed: " + res.removedHeadings.slice(0, 4).join(", "));
  }
  lines.push("", res.url);
  return lines.join("\n");
}

// ---------- core: poll one target ------------------------------------------

export async function pollOne(watcherId: string): Promise<PollResult> {
  const w = await prisma.webWatcher.findUnique({ where: { id: watcherId } });
  if (!w) return { id: watcherId, url: "?", status: "error", detail: "watcher not found" };
  if (!w.active) return { id: watcherId, url: w.url, status: "unchanged" };

  try {
    const html = await fetchHtml(w.url);
    const hash = hashHtml(html);
    const { headings, links } = extractSignals(html);
    const now = new Date();

    const prevHash = w.lastHash;
    const prevHeadings = (w.lastHeadings as string[] | null) ?? [];
    const prevLinks = (w.lastLinks as string[] | null) ?? [];

    if (!prevHash) {
      // Baseline: record and don't notify
      await prisma.webWatcher.update({
        where: { id: w.id },
        data: {
          lastHash: hash,
          lastHeadings: headings,
          lastLinks: links,
          lastCheckedAt: now,
          lastError: null,
        },
      });
      return {
        id: w.id,
        url: w.url,
        status: "baseline",
        detail: `${headings.length} headings, ${links.length} links tracked`,
      };
    }

    if (prevHash === hash) {
      await prisma.webWatcher.update({
        where: { id: w.id },
        data: { lastCheckedAt: now, lastError: null },
      });
      return { id: w.id, url: w.url, status: "unchanged" };
    }

    const prevH = new Set(prevHeadings);
    const nextH = new Set(headings);
    const newHeadings = headings.filter((h) => !prevH.has(h));
    const removedHeadings = prevHeadings.filter((h) => !nextH.has(h));
    const prevL = new Set(prevLinks);
    const newLinks = links.filter((l) => !prevL.has(l));

    await prisma.webWatcher.update({
      where: { id: w.id },
      data: {
        lastHash: hash,
        lastHeadings: headings,
        lastLinks: links,
        lastCheckedAt: now,
        lastChangedAt: now,
        lastError: null,
      },
    });

    const result: PollResult = {
      id: w.id,
      url: w.url,
      status: "changed",
      newHeadings,
      removedHeadings,
      newLinks,
    };

    // Fire Telegram DM if the user has linked
    const link = await prisma.telegramLink.findUnique({ where: { userEmail: w.userEmail } });
    if (link) {
      const msg = fmtChange({ url: w.url, label: w.label }, result);
      const send = await sendTelegramToChatId(link.chatId, msg);
      result.notified = send.ok;
    }
    return result;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await prisma.webWatcher.update({
      where: { id: w.id },
      data: { lastCheckedAt: new Date(), lastError: detail },
    });
    return { id: w.id, url: w.url, status: "error", detail };
  }
}

/**
 * Poll every watcher that is active and whose next scheduled check is due.
 * "Due" = never checked, OR lastCheckedAt + intervalHours <= now.
 * Called by the hosted cron job (every 15 min on paperloft).
 */
export async function pollDue(): Promise<PollResult[]> {
  const all = await prisma.webWatcher.findMany({ where: { active: true } });
  const now = Date.now();
  const due = all.filter((w) => {
    if (!w.lastCheckedAt) return true;
    const next = w.lastCheckedAt.getTime() + w.intervalMinutes * 60_000;
    return next <= now;
  });
  const results: PollResult[] = [];
  // Serialize — don't want a stampede on the user's bandwidth
  for (const w of due) {
    results.push(await pollOne(w.id));
  }
  return results;
}

// ---------- chat tools -----------------------------------------------------

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function makeWebWatcherSkills(userEmail: string) {
  return {
    web_watcher_add: tool({
      description:
        "Start watching a webpage for changes. When something changes (new section, new link, body text change) the user gets a Telegram DM. The user must have Telegram linked for notifications to go through — if they don't, record the watcher anyway and tell them to link Telegram.",
      inputSchema: z.object({
        url: z.string().describe("The URL to watch. http:// or https:// — if the user gives a bare domain, prefix https:// yourself."),
        label: z
          .string()
          .max(80)
          .optional()
          .describe("Optional short name shown in notifications, e.g. 'UCAS portal' or 'ACME careers'."),
        intervalMinutes: z
          .number()
          .int()
          .min(1)
          .max(10080)
          .default(180)
          .describe("How often to poll in minutes. Default 180 (3 hours). Minimum 1 minute, maximum 10080 (1 week). Interpret user requests like 'every 6 hours' as 360, 'every 2 days' as 2880."),
      }),
      execute: async (input) => {
        const url = normalizeUrl(input.url);
        try {
          // Validate it parses as a URL
          new URL(url);
        } catch {
          return { ok: false, error: "That doesn't look like a valid URL." };
        }
        const existing = await prisma.webWatcher.findFirst({
          where: { userEmail, url },
        });
        if (existing) {
          return {
            ok: false,
            error: `Already watching ${url}. Call web_watcher_list to see your watchers.`,
          };
        }
        const w = await prisma.webWatcher.create({
          data: {
            userEmail,
            url,
            label: input.label ?? null,
            intervalMinutes: input.intervalMinutes,
          },
        });
        const link = await prisma.telegramLink.findUnique({ where: { userEmail } });
        return {
          ok: true,
          id: w.id,
          url: w.url,
          label: w.label,
          intervalMinutes: w.intervalMinutes,
          telegramLinked: !!link,
          note: link
            ? "First poll will establish a baseline (no notification). Future changes will DM you on Telegram."
            : "Watcher saved, but you don't have Telegram linked yet — go to Settings → Telegram to connect, otherwise changes won't DM you.",
        };
      },
    }),

    web_watcher_list: tool({
      description:
        "List all URLs the user is currently watching, with their interval and last status.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await prisma.webWatcher.findMany({
          where: { userEmail },
          orderBy: { createdAt: "desc" },
        });
        return {
          watchers: rows.map((r) => ({
            id: r.id,
            url: r.url,
            label: r.label,
            intervalMinutes: r.intervalMinutes,
            active: r.active,
            lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
            lastChangedAt: r.lastChangedAt?.toISOString() ?? null,
            lastError: r.lastError,
          })),
        };
      },
    }),

    web_watcher_remove: tool({
      description:
        "Stop watching a URL. Accepts the watcher's id (from web_watcher_list) OR the url itself.",
      inputSchema: z.object({
        id: z.string().optional().describe("Watcher id from web_watcher_list"),
        url: z.string().optional().describe("The URL being watched (alternative to id)"),
      }),
      execute: async (input) => {
        if (!input.id && !input.url) {
          return { ok: false, error: "Provide either id or url." };
        }
        const where = input.id
          ? { id: input.id, userEmail }
          : { userEmail, url: normalizeUrl(input.url!) };
        const existing = await prisma.webWatcher.findFirst({ where });
        if (!existing) return { ok: false, error: "No matching watcher." };
        await prisma.webWatcher.delete({ where: { id: existing.id } });
        return { ok: true, removed: existing.url };
      },
    }),
  } as const;
}
