// Authed. A specific conversation. Loads history from DB (server-side),
// then hands it to ChatView which continues streaming via /api/chat.

import { notFound } from "next/navigation";
import type { UIMessage } from "ai";

import { auth } from "@/lib/auth";
import { getConversation } from "@/lib/chat";
import { ChatView } from "@/components/chat/chat-view";
import { TopNav } from "@/components/top-nav";

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) notFound(); // middleware should have caught this, defensive check

  const conv = await getConversation(id, email);
  if (!conv) notFound(); // wrong owner or bad ID both look like "not found"

  // Convert stored messages into the AI SDK's UIMessage shape for hydration.
  const initialMessages: UIMessage[] = conv.messages.map((m) => ({
    id: m.id,
    role: m.role as UIMessage["role"],
    parts: [{ type: "text", text: m.content }],
  }));

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <ChatView
        conversationId={conv.id}
        initialMessages={initialMessages}
        userName={session?.user?.name}
        userImage={session?.user?.image}
      />
    </div>
  );
}
