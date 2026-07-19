// Admin gate. Right now the only admin is Shreyas (the app owner). Whenever
// we add pricing gates for skills or usage limits, they'll check this first
// and bypass for admins.
//
// Two entries for Shreyas:
//   1. shreyas.pavuluri@gmail.com  — legacy Google sign-in identity
//   2. +447404660489@phone.paperloft.local — WhatsApp sign-in synthetic
//      identity (matches otp.ts.syntheticEmail("+447404660489"))
// Both should get admin so he doesn't lose it when swapping sign-in method.

const ADMIN_EMAILS = new Set([
  "shreyas.pavuluri@gmail.com",
  "+447404660489@phone.paperloft.local",
]);

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}
