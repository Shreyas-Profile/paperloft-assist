"use client";

// The interactive chat surface. Handles two modes:
//   - New chat: no `conversationId`. On the first successful send, the server
//     returns the new conversation id via the `x-conversation-id` header. We
//     capture it in a custom fetch and router.replace() into /chat/[id].
//   - Existing chat: `conversationId` is set. Server keeps appending messages
//     to that conversation.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { ChatMessage } from "@/components/chat/message";
import { Composer } from "@/components/chat/composer";

type Props = {
  conversationId?: string;
  initialMessages?: UIMessage[];
  userName?: string | null;
  userImage?: string | null;
};

export function ChatView({
  conversationId,
  initialMessages = [],
  userName,
  userImage,
}: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: conversationId ? { conversationId } : {},
      // Custom fetch to snag the x-conversation-id header on new chats.
      fetch: async (url, init) => {
        const res = await fetch(url, init);
        if (!conversationId) {
          const newId = res.headers.get("x-conversation-id");
          if (newId) {
            // Fire after this microtask so React has a chance to start applying
            // the streamed messages before we navigate.
            queueMicrotask(() => router.replace(`/chat/${newId}`));
          }
        }
        return res;
      },
    }),
  });

  // Auto-scroll to the bottom on new content.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    void sendMessage({ text });
    setInput("");
  }

  const isEmpty = messages.length === 0;
  const isStreaming = status === "streaming" || status === "submitted";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4">
          {isEmpty ? (
            <div className="min-h-[50vh] flex items-center justify-center text-center">
              <div>
                <h1 className="text-2xl font-semibold mb-2">What can I help with?</h1>
                <p className="text-sm text-muted-foreground max-w-md">
                  Ask a question, brainstorm an idea, or paste something you want
                  explained. Replies stream in as they&apos;re generated.
                </p>
              </div>
            </div>
          ) : (
            <div className="py-4 divide-y divide-border/60">
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  role={m.role as "user" | "assistant" | "system"}
                  content={extractText(m)}
                  avatarUrl={userImage}
                  userName={userName}
                />
              ))}
            </div>
          )}
          <div ref={scrollAnchorRef} />
        </div>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={send}
        disabled={isStreaming}
        placeholder={isStreaming ? "Assistant is typing…" : undefined}
      />
    </div>
  );
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
