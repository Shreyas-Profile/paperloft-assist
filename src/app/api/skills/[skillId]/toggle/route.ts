// POST /api/skills/[skillId]/toggle
//
// Body: { enabled: boolean }
// Enables or disables a skill for the signed-in user. Returns the new state.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enableSkill, disableSkill } from "@/lib/enabled-skills";

// Kept in sync with SKILLS[].id in src/app/skills/page.tsx. Adding a new skill?
// Add its id here too so the API refuses toggle requests for unknown skills.
const KNOWN_SKILLS = new Set([
  "video_render_mcp",
  "reminders",
]);

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
  } else {
    await disableSkill(userEmail, skillId);
  }
  return NextResponse.json({ skillId, enabled });
}
