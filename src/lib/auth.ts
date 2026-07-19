// Auth.js (NextAuth v5) configuration.
//
// Providers:
//   - Google (OAuth) — traditional Google sign-in.
//   - Credentials (telegram) — Telegram Login Widget hand-off; the
//     /api/auth/telegram-login route validates the HMAC before the browser
//     ever reaches this authorize() call, so the id here is already trusted.
//   - Credentials (whatsapp) — phone + OTP. The code was delivered by
//     /api/auth/otp/send via wasenderapi; here we verify it and mint a
//     synthetic <phone>@phone.paperloft.local identity.
//
// Identity unification: if a user connected their Telegram to a Google
// account (via Settings → Connect Telegram → deep-link → bot /start), a
// TelegramLink row exists mapping chatId → their Google email. When the
// SAME person later signs in via the Telegram widget, we look that row up
// and log them in as the ORIGINAL account instead of minting a fresh
// synthetic tg-*@telegram.paperloft.local identity. Otherwise "connect
// once, use forever" would keep asking them to reconnect every widget sign-in.
//
// JWT-only sessions, 1-year rolling expiry. On every sign-in we ensure the
// user has the default skill set enabled (idempotent).

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { enableSkill } from "./enabled-skills";
import { prisma } from "./db";
import { verifySignInCode, syntheticEmail } from "./otp";

const E164 = /^\+[1-9]\d{6,14}$/;
const CODE = /^\d{6}$/;

// Skills every user gets by default, on every sign-in. `enableSkill` is
// idempotent, so re-inserting is a cheap no-op after the first time.
// (browser_* and cron_* live in ALWAYS_ON_TOOLS in skill-tool-map.ts — no
// toggle, always available.)
const DEFAULT_SKILLS = ["reminders"];

function telegramEmail(id: string): string {
  return `tg-${id}@telegram.paperloft.local`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust the incoming Host header. Required behind Cloudflare tunnel where
  // the container sees plain HTTP but the browser used HTTPS — without this,
  // NextAuth can't reliably decide cookie prefixes and PKCE breaks.
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 365,
    updateAge: 60 * 60 * 24,
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: {
        telegramId: { label: "Telegram id", type: "text" },
        firstName: { label: "First name", type: "text" },
        username: { label: "Username", type: "text" },
        photoUrl: { label: "Photo", type: "text" },
      },
      async authorize(creds) {
        const id = String(creds?.telegramId ?? "").trim();
        if (!id || !/^\d+$/.test(id)) return null;

        // Identity unification (see file header).
        const existing = await prisma.telegramLink
          .findFirst({ where: { chatId: id } })
          .catch(() => null);
        const email = existing?.userEmail ?? telegramEmail(id);
        const name =
          String(creds?.username ?? "") ||
          String(creds?.firstName ?? "") ||
          `Telegram ${id}`;
        return {
          id: email,
          email,
          name,
          image: String(creds?.photoUrl ?? "") || undefined,
        };
      },
    }),
    Credentials({
      id: "whatsapp",
      name: "WhatsApp",
      credentials: {
        phone: { label: "Phone (E.164)", type: "text" },
        code: { label: "One-time code", type: "text" },
      },
      async authorize(creds) {
        const phone = String(creds?.phone ?? "").trim();
        const code = String(creds?.code ?? "").trim();
        if (!E164.test(phone) || !CODE.test(code)) return null;
        const ok = await verifySignInCode("whatsapp", phone, code);
        if (!ok) return null;
        const email = syntheticEmail(phone);
        // Last-4 digits for a friendly display name that doesn't leak the full
        // number in server logs or the header avatar tooltip.
        const last4 = phone.slice(-4);
        return { id: email, email, name: `WhatsApp ···${last4}` };
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      if (!user.email) return;
      // Every user gets the default skill set. enableSkill upserts — safe to
      // call on every sign-in, even for returning users.
      for (const skillId of DEFAULT_SKILLS) {
        enableSkill(user.email, skillId).catch(() => undefined);
      }
      // WhatsApp sign-in identities (email = "+<phone>@phone.paperloft.local")
      // need a UserChannelPref row so inbound WhatsApp messages from that
      // number can be routed back to this account. Upsert-only, never
      // overwrites an existing pref (user may have set a different phone
      // via channel_prefs_update in-chat).
      const m = /^(\+\d+)@phone\.paperloft\.local$/.exec(user.email);
      if (m) {
        const phone = m[1];
        await prisma.userChannelPref
          .upsert({
            where: { userId: user.email },
            create: {
              userId: user.email,
              whatsappNumber: phone,
              defaultChannel: "whatsapp",
            },
            update: {},
          })
          .catch((e) => console.error("[auth] channel-pref upsert failed:", e));
      }
    },
  },
  pages: {
    signIn: "/signin",
  },
});
