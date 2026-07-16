// Auth.js (NextAuth v5) configuration.
//
// Providers:
//   - Google (OAuth) — traditional Google sign-in
//   - Credentials (telegram) — Telegram Login Widget hand-off; the
//     /api/auth/telegram-login route validates the HMAC before the browser
//     ever reaches this authorize() call, so we treat the id here as trusted.
//
// (WhatsApp OTP is still wired in the codebase — wasender.ts, otp.ts, the
// /api/auth/otp/send route, phone map — but is not exposed on the sign-in
// page. Will come back as a delivery skill once a wasender WhatsApp session
// is linked.)
//
// JWT-only sessions, 1-year rolling expiry. On sign-in we auto-enable the
// skill matching the provider (Google → browser_mcp, Telegram → telegram_mcp).

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { enableSkill } from "./enabled-skills";

const PROVIDER_AUTO_ENABLE: Record<string, string> = {
  google: "browser_mcp",
  telegram: "telegram_mcp",
};

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
        const email = telegramEmail(id);
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
  ],
  events: {
    async signIn({ user, account }) {
      const provider = account?.provider;
      if (!provider || !user.email) return;
      const skillId = PROVIDER_AUTO_ENABLE[provider];
      if (skillId) enableSkill(user.email, skillId).catch(() => undefined);
    },
  },
  pages: {
    signIn: "/signin",
  },
});
