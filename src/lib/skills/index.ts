// Skill registry. Import from here and pass to `streamText({ tools })`.
//
// All skills are server-side (have an `execute` fn). Nothing runs on the
// user's machine — the browser skill drives a real Chrome instance on our
// Hetzner box via browser-mcp.

import { findOpportunitiesTool } from "./find-opportunities";
import { makeBrowserSkills } from "../hosted-browser";
import { makeCronSkills } from "../hosted-cron";
import { makeDocsSkills } from "../hosted-docs";
import { makeTorSkills } from "../hosted-tor";

// Provider-agnostic base skills (no per-user context needed).
export const skills = {
  fetch_url: findOpportunitiesTool,
} as const;

// Per-user skills that need the authed userEmail.
//
// Note on docs_* tools: they always exist on the toolbelt but throw a friendly
// "connect the Docs skill first" error unless the user has toggled it on
// (which provisions their sub-account on docs-mcp). The chat route's tool
// filter drops them unless enabled, so the LLM won't try to call them
// unbidden. Keeping them here lets the docs_mcp toggle flip them into the
// LLM's toolbelt without extra plumbing.
export function makeUserScopedSkills(userEmail: string) {
  return {
    ...makeBrowserSkills(userEmail),
    ...makeCronSkills(userEmail),
    ...makeDocsSkills(userEmail),
    ...makeTorSkills(userEmail),
  } as const;
}
