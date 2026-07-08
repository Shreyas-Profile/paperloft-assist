// Top navigation bar for authed pages.
// Server component — reads the session and history list, then renders + delegates
// interactivity to client children (theme toggle, history dialog).

import Link from "next/link";
import { Plus } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { getConversations } from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { HistoryDialog } from "@/components/chat/history-dialog";

export async function TopNav() {
  const session = await auth();
  const user = session?.user;
  const conversations = user?.email ? await getConversations(user.email) : [];

  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/chat" className="font-semibold hover:opacity-80 transition">
          Alpha Assist
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/chat">
            <Button variant="ghost" size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              New chat
            </Button>
          </Link>
          <HistoryDialog conversations={conversations} />
          <ThemeToggle />
          {user?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? "user"}
              className="w-7 h-7 rounded-full border border-border"
            />
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
