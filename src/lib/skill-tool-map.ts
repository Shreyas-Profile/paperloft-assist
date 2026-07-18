// Which chat tools each marketplace-toggle skill provides.
//
// One entry per skill id shown on /skills. When a user toggles a skill on,
// the chat route filters the LLM's tool set to include only tools listed
// here for enabled skills.
//
// Adding a new skill: add its id to SKILL_TOOLS AND to KNOWN_SKILLS in
// src/app/api/skills/[skillId]/toggle/route.ts AND to SKILLS[] in
// src/app/skills/page.tsx.

export const SKILL_TOOLS: Record<string, string[]> = {
  // Hosted MCPs — remote-tool wiring hasn't shipped yet, so enabling these
  // records the toggle but doesn't add tools to the LLM's toolbelt.
  video_render_mcp: [],
  // Docs (docs-mcp) — vector RAG over any uploaded document. Toggling this
  // on provisions a sub-account on docs.regiq.in via /api/platform/provision-user
  // and stores the key in SkillConnection. Every tool call routes through
  // that per-user key so data stays isolated at the docs-mcp DB level.
  docs_mcp: [
    "docs_upload",
    "docs_list",
    "docs_get",
    "docs_search",
    "docs_delete",
    "docs_balance",
  ],
  // Tor (tor-mcp) — anonymous HTTP fetch through the Tor network. Toggling
  // this on provisions a sub-account on tor.regiq.in. Honest scope: won't
  // beat Cloudflare-guarded sites (Indeed, Google, LinkedIn) — the LLM
  // falls back to browser_* for those.
  tor_mcp: [
    "tor_fetch",
    "tor_get_exit_ip",
    "tor_new_circuit",
    "tor_check",
  ],
  // Nova-reminders skill — general/medication/appointment reminders plus
  // prescription intake (image/PDF/text).
  reminders: [
    "reminder_create",
    "reminder_list",
    "reminder_get",
    "reminder_update",
    "reminder_delete",
    "reminder_ack",
    "reminder_missed",
    "prescription_ingest",
    "prescription_confirm",
    "prescription_list",
    "prescription_star",
    "channel_prefs_get",
    "channel_prefs_update",
  ],
};

// Tools that are always on (not gated by any skill).
// - fetch_url: Jina Reader — cheap, static HTML fetches.
// - browser_*: real Chrome on Hetzner (browser-mcp) — for JS-heavy sites.
// - cron_*: hosted cron scheduling (cron-mcp).
export const ALWAYS_ON_TOOLS = [
  "fetch_url",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_wait_for",
  "browser_read_page",
  "cron_schedule",
  "cron_list",
  "cron_delete",
  "cron_pause",
  "cron_resume",
];

// Given the set of skill ids enabled for a user, return the flat set of
// chat tool names they should see.
export function toolsForEnabledSkills(enabledSkillIds: Set<string>): Set<string> {
  const names = new Set<string>(ALWAYS_ON_TOOLS);
  for (const skillId of enabledSkillIds) {
    for (const tool of SKILL_TOOLS[skillId] ?? []) {
      names.add(tool);
    }
  }
  return names;
}
