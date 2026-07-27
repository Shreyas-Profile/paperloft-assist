// Admin gate. Right now the only admin is Shreyas (the app owner). Whenever
// we add pricing gates for skills or usage limits, they'll check this first
// and bypass for admins.
//
// Three entries for Shreyas — one per sign-in path he uses. They're all
// the same person; the app just stores whichever identity was in play
// when the account was created.
//   1. shreyas.pavuluri@gmail.com                — Google sign-in.
//   2. +447404660489@phone.paperloft.local       — WhatsApp OTP (deprecated).
//   3. tg-8639154947@telegram.paperloft.local    — Telegram Login Widget.
// Adding a new sign-in path? Add the synthetic email format used by
// events.signIn in src/lib/auth.ts.

const ADMIN_EMAILS = new Set([
  "shreyas.pavuluri@gmail.com",
  "+447404660489@phone.paperloft.local",
  "tg-8639154947@telegram.paperloft.local",
]);

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}
