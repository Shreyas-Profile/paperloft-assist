"use client";

// Persistent left sidebar shown on every authed page (chat, skills, settings).
// On md+ screens it's a fixed sidebar. On mobile it collapses into a
// hamburger drawer overlay so users can still reach /skills, /settings,
// sign-out, etc. Auto-closes when the route changes.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  Sparkles,
  Settings,
  LogOut,
  Menu,
  X,
  LifeBuoy,
  Inbox,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PRIMARY: NavItem[] = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/skills", label: "Skills", icon: Sparkles },
];

// Bottom nav — "Support" is always visible so anyone hitting a bug
// can find /support in one click from anywhere in the authed app.
// "Tickets" (the /admin/support inbox) is added at render time for
// admins only — see NavContent below.
const BOTTOM: NavItem[] = [
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ADMIN_TICKETS_ITEM: NavItem = {
  href: "/admin/support",
  label: "Tickets",
  icon: Inbox,
};

export function Sidebar({
  userName,
  userImage,
  isAdmin,
}: {
  userName?: string | null;
  userImage?: string | null;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close drawer whenever the route changes (user clicked a nav item).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top-bar with hamburger — only visible under md */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur">
        <Link href="/chat" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-foreground text-background flex items-center justify-center text-xs font-bold">
            P
          </div>
          <span className="text-sm font-semibold">Paperloft Assist</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="p-2 -mr-2 rounded-md hover:bg-foreground/10 transition"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
      )}

      <aside
        // Mobile: fixed drawer, plain hidden/visible toggle. No slide-in
        // animation — tried translate-x-*, inline transform, and animated
        // `left`, all hit a Tailwind v4 CSS-var / cascade quirk where the
        // drawer stayed off-screen despite the correct inline style. A
        // straight hidden/visible flip is reliable and good enough.
        className={cn(
          "border-r border-border/50 bg-background flex-col",
          "lg:hidden fixed inset-y-0 left-0 z-50 w-64",
          mobileOpen ? "flex" : "hidden",
        )}
      >
        <MobileHeader onClose={() => setMobileOpen(false)} />
        <NavContent
          pathname={pathname}
          userName={userName}
          userImage={userImage}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Desktop sidebar — sticky, always visible on lg+ (raised from md so
          tablets/narrow desktops don't have the sidebar eating half the width). */}
      <aside className="hidden lg:flex lg:w-56 shrink-0 border-r border-border/50 bg-foreground/[0.02] flex-col h-screen sticky top-0">
        <div className="px-4 py-4 border-b border-border/50">
          <Link href="/chat" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center text-sm font-bold">
              P
            </div>
            <span className="font-semibold">Paperloft Assist</span>
          </Link>
        </div>
        <NavContent
          pathname={pathname}
          userName={userName}
          userImage={userImage}
          isAdmin={isAdmin}
        />
      </aside>
    </>
  );
}

function MobileHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-4 py-4 border-b border-border/50 flex items-center justify-between">
      <Link href="/chat" className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center text-sm font-bold">
          P
        </div>
        <span className="font-semibold">Paperloft Assist</span>
      </Link>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close menu"
        className="p-1.5 rounded-md hover:bg-foreground/10 transition"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function NavContent({
  pathname,
  userName,
  userImage,
  isAdmin,
}: {
  pathname: string;
  userName?: string | null;
  userImage?: string | null;
  isAdmin?: boolean;
}) {
  return (
    <>
      <nav className="flex-1 flex flex-col p-2 gap-1">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      <div className="p-2 border-t border-border/50 space-y-1">
        {BOTTOM.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        {isAdmin ? (
          <NavLink
            item={ADMIN_TICKETS_ITEM}
            active={isActive(pathname, ADMIN_TICKETS_ITEM.href)}
          />
        ) : null}

        <div className="px-2 py-2 mt-2 flex items-center gap-2">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={userImage}
              alt={userName ?? "user"}
              className="w-7 h-7 rounded-full border border-border shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center text-xs font-semibold shrink-0">
              {userName?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{userName ?? "You"}</div>
            {isAdmin ? (
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                Admin
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">Free plan</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            title="Sign out"
            className="p-1.5 rounded-md hover:bg-foreground/10 transition text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition",
        active
          ? "bg-foreground/10 text-foreground font-medium"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/chat") return pathname === "/chat" || pathname.startsWith("/chat/");
  return pathname.startsWith(href);
}
