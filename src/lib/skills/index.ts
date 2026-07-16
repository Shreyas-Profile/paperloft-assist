// Skill registry. Import from here and pass to `streamText({ tools })`.
//
// All skills are server-side (have an `execute` fn). Nothing runs on the
// user's machine — the browser skill drives a real Chrome instance on our
// Hetzner box via browser-mcp.

import { findOpportunitiesTool } from "./find-opportunities";
import { makeBrowserSkills } from "../hosted-browser";
import { makeCronSkills } from "../hosted-cron";

// Provider-agnostic base skills (no per-user context needed).
export const skills = {
  fetch_url: findOpportunitiesTool,
} as const;

// Per-user skills that need the authed userEmail. Browser tools cache a
// browser-mcp session per user; cron tools stamp every scheduled job with
// metadata.userEmail so the fire callback can route the result back.
export function makeUserScopedSkills(userEmail: string) {
  return {
    ...makeBrowserSkills(userEmail),
    ...makeCronSkills(userEmail),
  } as const;
}
