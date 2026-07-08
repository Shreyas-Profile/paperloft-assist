"use client";

// One chat message bubble. Renders assistant text as markdown via streamdown,
// which handles partial markdown mid-stream without flickering (unlike plain
// react-markdown, which re-renders the whole tree on every token).

import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant" | "system";
  content: string;
  avatarUrl?: string | null;
  userName?: string | null;
};

export function ChatMessage({ role, content, avatarUrl, userName }: Props) {
  if (role === "system") return null; // never render system prompts

  const isUser = role === "user";

  return (
    <div className="flex gap-3 py-4">
      <Avatar isUser={isUser} avatarUrl={avatarUrl} userName={userName} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-muted-foreground mb-1">
          {isUser ? userName ?? "You" : "Alpha Assist"}
        </div>
        <div
          className={cn(
            "prose prose-sm max-w-none dark:prose-invert",
            // Custom prose tweaks for chat legibility
            "prose-p:my-2 prose-pre:my-2 prose-headings:mt-3 prose-headings:mb-2",
            "prose-code:before:content-none prose-code:after:content-none",
            "prose-code:bg-foreground/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em]",
            "prose-pre:bg-foreground/5 prose-pre:border prose-pre:border-border",
          )}
        >
          {isUser ? (
            // Users type plain text — don't parse it as markdown.
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <Streamdown>{content}</Streamdown>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({
  isUser,
  avatarUrl,
  userName,
}: {
  isUser: boolean;
  avatarUrl?: string | null;
  userName?: string | null;
}) {
  const size = "h-7 w-7";
  if (isUser && avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={userName ?? "user"}
        className={cn(size, "rounded-full border border-border shrink-0")}
      />
    );
  }
  return (
    <div
      className={cn(
        size,
        "rounded-full shrink-0 flex items-center justify-center text-xs font-semibold",
        isUser
          ? "bg-foreground/10 text-foreground"
          : "bg-accent text-background",
      )}
    >
      {isUser ? (userName?.[0]?.toUpperCase() ?? "U") : "A"}
    </div>
  );
}
