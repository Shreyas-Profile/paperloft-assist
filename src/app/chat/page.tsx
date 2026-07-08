// Authed. Empty state — no conversation open yet. First message the user sends
// creates the conversation server-side; ChatView redirects to /chat/[id].

import { auth } from "@/lib/auth";
import { ChatView } from "@/components/chat/chat-view";
import { TopNav } from "@/components/top-nav";

export default async function ChatIndexPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <ChatView userName={user?.name} userImage={user?.image} />
    </div>
  );
}
