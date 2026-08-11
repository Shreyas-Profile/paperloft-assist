"use client";

// Floating chat widget on the marketing landing page.
//
// Two jobs handled by a single conversation with /api/marketing-chat:
//   1. Q&A about Paperloft
//   2. Feedback capture — if the model detects the visitor is giving
//      feedback and collects their name/email, the reply includes a
//      { feedback } object. The widget POSTs that to /api/support so
//      Shreyas sees it in Telegram (@PaperloftAssistantBot).
//
// Only rendered when the visitor is not signed in (the parent decides).
// Vanilla React state; no external chat library.

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant" | "system";
interface Message {
  role: Role;
  content: string;
  // Set on assistant messages that triggered a feedback send. Used to
  // render a confirmation chip so the user sees their feedback was queued.
  feedbackForwarded?: boolean;
}

const GREETING: Message = {
  role: "assistant",
  content:
    "Hi! 👋 I'm the Paperloft guide. Ask me anything about the assistant — or share feedback and I'll pass it to Shreyas.\n\n[Try it →](/signin)",
};

/**
 * Very small markdown-ish renderer: bold, links, line breaks. Everything
 * else is escaped. Kept inline so the widget stays self-contained.
 */
function renderRichText(text: string) {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let html = escape(text);
  // [label](url) — internal paths get target=_self, external target=_blank
  html = html.replace(
    /\[([^\]]+)\]\((\S+?)\)/g,
    (_m, label, url) => {
      const isExternal = /^https?:\/\//i.test(url);
      const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${url}"${target} style="color:#f97316;text-decoration:underline;text-underline-offset:2px">${label}</a>`;
    },
  );
  // **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // newlines
  html = html.replace(/\n/g, "<br/>");
  return html;
}

export function MarketingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Autoscroll to bottom on every message
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setInput("");
    const next = [...messages, { role: "user" as Role, content: trimmed }];
    setMessages(next);
    setBusy(true);

    // Client-side retry: 2 tries on 5xx/network. Marketing chat sits
    // behind Cloudflare + Next server, occasional 503 is normal.
    let reply: string | null = null;
    let feedback:
      | { name: string; email: string; body: string }
      | undefined = undefined;
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/marketing-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            reply?: string;
            feedback?: { name: string; email: string; body: string };
          };
          reply = data.reply ?? null;
          feedback = data.feedback;
          break;
        } else if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        } else {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          lastErr = err.error ?? `HTTP ${res.status}`;
          break;
        }
      } catch (e) {
        lastErr = (e as Error).message ?? "network error";
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
      }
    }

    if (!reply) {
      setBusy(false);
      setError(lastErr || "Something went wrong. Try again in a moment.");
      return;
    }

    // If the model asked to forward feedback, fire /api/support in parallel.
    // Widget doesn't wait for the ticket write — the visitor sees the
    // acknowledgement immediately; the ticket lands within ~1s.
    let feedbackForwarded = false;
    if (feedback) {
      feedbackForwarded = true;
      void fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: feedback.name,
          email: feedback.email,
          title: `Feedback from ${feedback.name} (marketing-chat)`,
          body: feedback.body,
        }),
      }).catch((e) => console.warn("[marketing-chat] feedback POST failed:", e));
    }

    setMessages((cur) => [
      ...cur,
      { role: "assistant", content: reply!, feedbackForwarded },
    ]);
    setBusy(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      {/* Floating trigger orb */}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((o) => !o)}
        className={`fixed bottom-6 right-6 z-[2147483000] h-14 w-14 rounded-full text-white shadow-lg transition ${
          open
            ? "bg-neutral-800 hover:bg-neutral-700"
            : "bg-orange-500 hover:bg-orange-600 hover:-translate-y-0.5"
        }`}
        style={{
          boxShadow: open
            ? "0 8px 20px rgba(0,0,0,.3)"
            : "0 12px 30px rgba(249,115,22,.4), 0 4px 10px rgba(0,0,0,.15)",
        }}
      >
        {open ? (
          <svg
            className="mx-auto h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
          >
            <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            className="mx-auto h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open ? (
        <div
          className="fixed bottom-24 right-6 z-[2147483000] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-neutral-100 shadow-2xl"
          style={{
            width: "min(400px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 128px))",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-orange-500/15 to-transparent px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-base shadow-md">
                P
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold">Ask Paperloft</div>
                <div className="text-[11px] text-neutral-400">
                  <span
                    className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                    style={{ boxShadow: "0 0 0 3px rgba(16,185,129,.2)" }}
                  />
                  Answers · feedback goes to Shreyas
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="h-7 w-7 rounded text-neutral-400 hover:bg-white/5 hover:text-white"
            >
              ×
            </button>
          </div>

          {/* Log */}
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto rounded-br-sm bg-orange-500 text-white"
                    : "rounded-bl-sm bg-white/5 text-neutral-100"
                }`}
              >
                <span
                  dangerouslySetInnerHTML={{ __html: renderRichText(m.content) }}
                />
                {m.feedbackForwarded ? (
                  <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                    ✓ Sent to Shreyas on Telegram
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white/5 px-3.5 py-3 text-neutral-400">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
              </div>
            ) : null}
            {error ? (
              <div className="max-w-[85%] rounded-2xl border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-sm text-red-300">
                {error}
              </div>
            ) : null}
          </div>

          {/* Input */}
          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="Ask about Paperloft — or share feedback…"
              className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-orange-500/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="h-9 w-9 flex-shrink-0 rounded-full bg-orange-500 text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              →
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
