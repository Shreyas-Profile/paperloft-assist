// Route guard + canonical-host redirect. Runs at the Edge before every
// matched request. Two jobs:
//
//   1. Canonical host: Cloudflare Tunnel serves the same container at
//      paperloft.uk (canonical), www.paperloft.uk, and paperloft.regiq.in
//      (legacy, pre-rebrand). NextAuth's cookies + AUTH_URL are pinned to
//      paperloft.uk, so a user signing in on paperloft.regiq.in would
//      verify successfully, get 302'd to paperloft.uk (where no cookie
//      exists on that hostname yet), bounce back to /signin, and loop.
//      A 308 to the canonical host BEFORE anything auth-related runs
//      guarantees every user is on the same origin as the cookies.
//
//   2. Auth guard: kick anonymous users away from protected routes.
//
// (In Next.js 16, `middleware.ts` was renamed to `proxy.ts`.)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const CANONICAL_HOST = "paperloft.uk";
const ALIAS_HOSTS = new Set(["www.paperloft.uk", "paperloft.regiq.in"]);

export default auth((req) => {
  // 1. Canonical host redirect — check first so a stale-host request never
  //    touches NextAuth cookie code.
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  if (ALIAS_HOSTS.has(host)) {
    const url = req.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  // 2. Auth guard.
  const isAuthed = !!req.auth;
  const path = req.nextUrl.pathname;
  const isProtected = path.startsWith("/chat");
  if (isProtected && !isAuthed) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", path);
    return Response.redirect(url);
  }
});

// Skip Next.js internals and static assets — cheaper and avoids matching the
// API routes.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
