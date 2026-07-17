// POST /api/skills/[skillId]/toggle
//
// Body: { enabled: boolean }
// Enables or disables a skill for the signed-in user. Returns the new state.
//
// For external MCP skills that require per-user provisioning (docs_mcp), we
// also call the skill's /api/platform/provision-user on enable to mint a
// sub-account there. Failure at that step un-does the enable and returns the
// error so the UI can show it.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enableSkill, disableSkill } from "@/lib/enabled-skills";
import { provisionSkillConnection } from "@/lib/skill-provisioning";

// Kept in sync with SKILLS[].id in src/app/skills/page.tsx.
const KNOWN_SKILLS = new Set([
  "video_render_mcp",
  "reminders",
  "docs_mcp",
  "tor_mcp",
]);

// External skills that need paperloft to provision a sub-account on their
// MCP server before the tools work.
const SKILLS_NEEDING_PROVISION = new Set(["docs_mcp", "tor_mcp"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { skillId } = await params;
  if (!KNOWN_SKILLS.has(skillId)) {
    return NextResponse.json({ error: "unknown skill" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = !!body.enabled;

  if (enabled) {
    await enableSkill(userEmail, skillId);
    if (SKILLS_NEEDING_PROVISION.has(skillId)) {
      try {
        const result = await provisionSkillConnection(userEmail, skillId);
        return NextResponse.json({
          skillId,
          enabled,
          provisioned: true,
          existing: result.existing,
        });
      } catch (err) {
        // Roll back the enable so the user can retry cleanly rather than
        // being stuck in a "toggled on but not connected" state.
        await disableSkill(userEmail, skillId).catch(() => undefined);
        // Use 400, NOT 502: Cloudflare intercepts 5xx from origin and
        // replaces the response body with its own generic error page, so the
        // client never sees our helpful message. 400 lets it through.
        return NextResponse.json(
          {
            error: "provision_failed",
            message: (err as Error).message,
          },
          { status: 400 },
        );
      }
    }
  } else {
    await disableSkill(userEmail, skillId);
  }
  return NextResponse.json({ skillId, enabled });
}
