// Skill registry. Import from here and pass to `streamText({ tools })`.
//
// Two flavours coexist:
//   - Server-side skills (have an `execute` fn): the server runs them and
//     returns the result inline. Example: find_opportunities (Jina Reader).
//   - Client-side skills (NO `execute` fn): the tool-call is streamed to the
//     browser, the browser bridges to the chrome-agent extension, the
//     extension drives Chrome, and the result flows back via addToolResult.
//     Example: the browser_* tools below.

import { findOpportunitiesTool } from "./find-opportunities";
import { makeHostedBrowserSkills } from "../hosted-browser";
import {
  browserNewTab,
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  browserReadPage,
} from "./browser-primitives";

// Provider-agnostic base skills (no per-user context needed).
export const skills = {
  // Server-side — general web fetcher. Historically named find_opportunities
  // and scoped to apprenticeship sites; now general-purpose.
  fetch_url: findOpportunitiesTool,
  // Client-side (executed in the user's Chrome via chrome-agent extension)
  browser_new_tab: browserNewTab,
  browser_navigate: browserNavigate,
  browser_snapshot: browserSnapshot,
  browser_click: browserClick,
  browser_type: browserType,
  browser_read_page: browserReadPage,
} as const;

// Per-user skills that need the authed userEmail. Hosted-browser tools go
// here because they cache a browser-mcp sessionId per user.
export function makeUserScopedSkills(userEmail: string) {
  return {
    ...makeHostedBrowserSkills(userEmail),
  } as const;
}
