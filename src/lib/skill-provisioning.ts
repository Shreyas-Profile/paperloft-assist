// Paperloft-side aggregator for external MCP skills.
//
// When a user enables an external skill (docs-mcp, video-render-mcp, ...),
// paperloft calls the skill's `/api/platform/provision-user` endpoint with
// its shared platform secret. The skill server creates a sub-account bound
// to (paperloft's platformId, user's email), returns an API key + userId
// on the skill side. We store those in SkillConnection so subsequent tool
// calls in chat run under this user's own tenant on the skill server.
//
// Data segregation is enforced at the skill server's DB layer (each row is
// scoped by userId); paperloft just holds the credentials that identify
// which sub-account a chat request belongs to.

import { prisma } from "./db";

interface SkillEndpoint {
  skillId: string;
  provisionUrl: string;
  grantUrl: string;
  sharedSecretEnv: string;
}

/**
 * Registry of external skills paperloft aggregates. Adding a new skill
 * here + its shared secret in .env is enough to wire it up.
 */
const SKILL_ENDPOINTS: Record<string, SkillEndpoint> = {
  docs_mcp: {
    skillId: "docs_mcp",
    provisionUrl: "https://docs.regiq.in/api/platform/provision-user",
    grantUrl: "https://docs.regiq.in/api/platform/grant-credits",
    sharedSecretEnv: "DOCS_MCP_PLATFORM_SECRET",
  },
  tor_mcp: {
    skillId: "tor_mcp",
    provisionUrl: "https://tor.regiq.in/api/platform/provision-user",
    grantUrl: "https://tor.regiq.in/api/platform/grant-credits",
    sharedSecretEnv: "TOR_MCP_PLATFORM_SECRET",
  },
};

export interface ProvisionResult {
  remoteUserId: string;
  remoteApiKey: string;   // raw key — store this, never re-derivable
  keyPrefix: string;
  isNew: boolean;
  freeTierCredits: number;
}

/**
 * Provision (or find-and-connect) a sub-account for `userEmail` on the given
 * skill. Idempotent — calling twice returns the same connection with the
 * cached apiKey.
 */
export async function provisionSkillConnection(
  userEmail: string,
  skillId: string,
): Promise<{ existing: boolean; remoteUserId: string; remoteApiKey: string }> {
  // Already provisioned?
  const existing = await prisma.skillConnection.findUnique({
    where: { userEmail_skillId: { userEmail, skillId } },
  });
  if (existing) {
    return {
      existing: true,
      remoteUserId: existing.remoteUserId,
      remoteApiKey: existing.remoteApiKey,
    };
  }

  const ep = SKILL_ENDPOINTS[skillId];
  if (!ep) throw new Error(`no provision endpoint configured for skill "${skillId}"`);
  const secret = process.env[ep.sharedSecretEnv];
  if (!secret) {
    throw new Error(
      `${ep.sharedSecretEnv} not set on paperloft — cannot provision ${skillId}. ` +
      `Ask an admin to set it.`,
    );
  }

  const res = await fetch(ep.provisionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-Secret": secret,
    },
    body: JSON.stringify({ platformRef: userEmail, email: userEmail }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${skillId} provision failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    userId: string;
    apiKey: string | null;
    keyPrefix: string;
    isNew: boolean;
    freeTierCredits: number;
  };
  if (!data.apiKey) {
    // Skill said "user existed with active key" but we have no record — this
    // can happen if paperloft's DB was reset. Best we can do is fail with a
    // clear message; user needs to rotate the key from the skill's dashboard.
    throw new Error(
      `${skillId} says user ${userEmail} exists with an active key but we don't have it. ` +
      `Visit the skill's dashboard to regenerate.`,
    );
  }

  await prisma.skillConnection.create({
    data: {
      userEmail,
      skillId,
      remoteUserId: data.userId,
      remoteApiKey: data.apiKey,
    },
  });

  return { existing: false, remoteUserId: data.userId, remoteApiKey: data.apiKey };
}

/**
 * Look up an existing connection without provisioning. Returns null if the
 * user hasn't been connected to this skill yet.
 */
export async function getSkillConnection(userEmail: string, skillId: string) {
  return await prisma.skillConnection.findUnique({
    where: { userEmail_skillId: { userEmail, skillId } },
  });
}

/**
 * Move `amount` credits from paperloft's platform pool → user's balance on
 * the remote skill. For future use — paperloft can grant custom quotas per
 * user or per Pro-tier plan. Not called on toggle by default (users start
 * with the skill's built-in free tier).
 */
export async function grantSkillCredits(
  userEmail: string,
  skillId: string,
  amount: number,
): Promise<{ newBalance: number; poolBalance: number }> {
  const conn = await getSkillConnection(userEmail, skillId);
  if (!conn) {
    throw new Error(`no connection for ${userEmail} on ${skillId} — provision first`);
  }
  const ep = SKILL_ENDPOINTS[skillId];
  if (!ep) throw new Error(`no grant endpoint configured for skill "${skillId}"`);
  const secret = process.env[ep.sharedSecretEnv];
  if (!secret) throw new Error(`${ep.sharedSecretEnv} not set on paperloft`);

  const res = await fetch(ep.grantUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-Secret": secret,
    },
    body: JSON.stringify({ userId: conn.remoteUserId, amount, reason: "paperloft_grant" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${skillId} grant failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as { newBalance: number; poolBalance: number };
}
