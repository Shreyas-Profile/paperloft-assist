// Auth.js (NextAuth v5) configuration.
//
// Providers:
//   - Google (OAuth) — traditional Google sign-in
//   - Credentials (whatsapp) — phone + OTP code sent via wasenderapi
//   - Credentials (telegram) — Telegram chatId + OTP code sent via bot
//
// JWT-only sessions. On first sign-in, we auto-enable the skill that matches
// the provider — Google → browser_mcp, Telegram → telegram_mcp,
// WhatsApp → reminders. Users can toggle skills freely from /skills afterwards.
//
// For OTP-based providers we also stash the user's identifier on their
// UserChannelPref row so the reminders scheduler knows where to deliver.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { enableSkill } from "./enabled-skills";
import { syntheticEmail, verifySignInCode, type OtpProvider } from "./otp";
import { prisma } from "./db";

const PROVIDER_AUTO_ENABLE: Record<string, string> = {
  google: "browser_mcp",
  telegram: "telegram_mcp",
  whatsapp: "reminders",
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Sign-in is expensive (OTP round-trip, or a Google popup). Once a user
  // proves who they are, keep them signed in for a year and roll the expiry
  // forward every day they use the app. Effectively: sign in once per
  // browser, then never again unless they clear cookies or sign out.
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
      id: "whatsapp",
      name: "WhatsApp",
      credentials: {
        identifier: { label: "Phone (E.164)", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(creds) {
        return authorizeOtp("whatsapp", creds);
      },
    }),
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: {
        identifier: { label: "Telegram chat id", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(creds) {
        return authorizeOtp("telegram", creds);
      },
    }),
  ],
  events: {
    async signIn({ user, account }) {
      const provider = account?.provider;
      if (!provider || !user.email) return;
      const skillId = PROVIDER_AUTO_ENABLE[provider];
      if (skillId) enableSkill(user.email, skillId).catch(() => undefined);
      // Persist per-channel identifiers so the reminders scheduler can deliver
      // without asking the user again.
      if (provider === "whatsapp" || provider === "telegram") {
        // synthetic emails encode the identifier before the "@"
        const identifier = user.email.split("@")[0];
        await prisma.userChannelPref
          .upsert({
            where: { userId: user.email },
            create: {
              userId: user.email,
              whatsappNumber: provider === "whatsapp" ? identifier : undefined,
              telegramChatId: provider === "telegram" ? identifier : undefined,
              defaultChannel: provider === "whatsapp" ? "whatsapp" : "telegram",
            },
            update: {
              whatsappNumber: provider === "whatsapp" ? identifier : undefined,
              telegramChatId: provider === "telegram" ? identifier : undefined,
            },
          })
          .catch(() => undefined);
      }
    },
  },
  pages: {
    signIn: "/signin",
  },
});

async function authorizeOtp(
  provider: OtpProvider,
  creds: Partial<Record<"identifier" | "code", unknown>> | undefined,
) {
  const identifier = String(creds?.identifier ?? "").trim();
  const code = String(creds?.code ?? "").trim();
  if (!identifier || !code) return null;
  const ok = await verifySignInCode(provider, identifier, code);
  if (!ok) return null;
  const email = syntheticEmail(provider, identifier);
  return {
    id: email,
    email,
    name: provider === "whatsapp" ? identifier : `Telegram ${identifier}`,
  };
}
