"use client";

// The interactive chat surface. Handles two modes:
//   - New chat: no `conversationId`. On the first successful send, the server
//     returns the new conversation id via the `x-conversation-id` header. We
//     capture it in a ref and update the URL bar with history.replaceState —
//     NOT router.replace, which would re-mount this component and blow away
//     any in-flight tool-call state (kills the browser_* auto-loop mid-turn).
//   - Existing chat: `conversationId` is set from the server load. Server
//     keeps appending messages to that conversation.
//
// Client-side tool execution: any tool whose name starts with `browser_` has
// no `execute` on the server. Its tool-call streams here; we forward the call
// to the chrome-agent extension and feed the result back to the LLM via
// addToolResult so it can decide what to do next.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { ChatMessage } from "@/components/chat/message";
import { Composer } from "@/components/chat/composer";
import { callExtension } from "@/lib/browser-bridge";

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

  // Ref so the transport closure sees the *current* conversationId, not the
  // one at mount time. Without this, the first send happens with no id, the
  // server creates a new conversation, and every subsequent auto-resend
  // *also* omits the id → the server creates a *new* conversation every time
  // → the LLM has no memory of its previous tool calls and loops forever.
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
        // Custom fetch to snag the x-conversation-id header on new chats.
        // history.replaceState updates the URL in the browser bar without
        // re-mounting the page. router.replace would trigger a soft nav that
        // resets useChat's state and cancels the in-flight tool-call loop.
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
    // When the LLM's turn ends with an unresolved tool call that we've since
    // filled in via addToolResult (from our client-side browser_* tools), auto
    // resubmit so the LLM can read the result and continue. Without this, the
    // browser opens the tab but the loop dies and the assistant says nothing.
    //
    // Cap the loop at 15 rounds — a full workit flow is ~11 tool calls, so 15
    // is generous. Without a cap, a confused LLM could open browser_new_tab in
    // a runaway loop.
    sendAutomaticallyWhen: ({ messages }) => {
      const assistantTurns = messages.filter((m) => m.role === "assistant").length;
      if (assistantTurns >= 15) return false;
      return lastAssistantMessageIsCompleteWithToolCalls({ messages });
    },
    transport,
    // Client-side tool execution — browser_* tools have no server-side
    // execute, so we run them here by forwarding to the extension.
    async onToolCall({ toolCall }) {
      const tc = toolCall as {
        toolCallId: string;
        toolName: string;
        input?: unknown;
        args?: unknown;
      };
      if (!tc.toolName?.startsWith("browser_")) return;
      const input = (tc.input ?? tc.args) ?? {};
      try {
        const output = await callExtension(tc.toolName, input);
        chat.addToolResult({
          tool: tc.toolName,
          toolCallId: tc.toolCallId,
          output,
        } as Parameters<typeof chat.addToolResult>[0]);
      } catch (err) {
        chat.addToolResult({
          tool: tc.toolName,
          toolCallId: tc.toolCallId,
          output: { error: err instanceof Error ? err.message : String(err) },
        } as Parameters<typeof chat.addToolResult>[0]);
      }
    },
  });

  const { messages, sendMessage, status } = chat;

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
