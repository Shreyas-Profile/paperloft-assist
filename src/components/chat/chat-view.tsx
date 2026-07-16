"use client";

// The interactive chat surface. Handles two modes:
//   - New chat: no `conversationId`. On the first successful send, the server
//     returns the new conversation id via the `x-conversation-id` header. We
//     capture it in a ref and update the URL bar with history.replaceState —
//     NOT router.replace, which would re-mount this component.
//   - Existing chat: `conversationId` is set from the server load.

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [input, setInput] = useState("");
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const conversationIdRef = useRef<string | undefined>(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            conversationId: conversationIdRef.current,
            messages,
          },
        }),
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const newId = res.headers.get("x-conversation-id");
          if (newId && !conversationIdRef.current) {
            conversationIdRef.current = newId;
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", `/chat/${newId}`);
            }
          }
          return res;
        },
      }),
    [],
  );

  const chat = useChat({
    messages: initialMessages,
    transport,
  });

  const { messages, sendMessage, status } = chat;

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
                  parts={m.parts}
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
