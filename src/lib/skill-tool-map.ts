// Which chat tools each marketplace-toggle skill provides.
//
// One entry per skill id shown on /skills. When a user toggles a skill on,
// the chat route (src/app/api/chat/route.ts) filters the LLM's tool set to
// include only tools listed here for enabled skills.
//
// Adding a new skill: add its id to SKILL_TOOLS AND to KNOWN_SKILLS in
// src/app/api/skills/[skillId]/toggle/route.ts AND to SKILLS[] in
// src/app/skills/page.tsx (three places, kept in sync manually — we can
// centralize later once the shape settles).

export const SKILL_TOOLS: Record<string, string[]> = {
  // Chrome-agent-backed browser control. All six client-side browser_* tools
  // are gated together — no half-enabled state.
  browser_agent: [
    "browser_new_tab",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_read_page",
  ],
  // Hosted MCPs — remote-tool wiring hasn't shipped yet, so enabling these
  // records the toggle but doesn't add tools to the LLM's toolbelt. When the
  // MCP client lands, list the tool names here.
  telegram_mcp: [],
  video_render_mcp: [],
  // Nova-reminders skill — general/medication/appointment reminders plus
  // prescription intake (image/PDF/text). Delivers via WhatsApp today,
  // Telegram once telegram-mcp is wired as a delivery channel.
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
// - fetch_url: general Jina Reader fetch, cheap.
// - hosted_browser_*: hosted Playwright Chrome on Hetzner (browser-mcp).
//   Works everywhere (web /chat, Telegram, cron) since it runs server-side —
//   unlike the client-side browser_* tools which need the user's local Chrome
//   via the chrome-agent extension.
export const ALWAYS_ON_TOOLS = [
  "fetch_url",
  "hosted_browser_navigate",
  "hosted_browser_snapshot",
  "hosted_browser_click",
  "hosted_browser_type",
  "hosted_browser_press_key",
  "hosted_browser_wait_for",
  "hosted_browser_read_page",
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
