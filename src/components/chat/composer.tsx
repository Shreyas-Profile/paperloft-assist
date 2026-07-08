"use client";

// Bottom-pinned message composer. Enter to send, Shift+Enter for newline.
// Auto-resizes vertically up to a max height.

import { useRef, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({ value, onChange, onSubmit, disabled, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  }

  function handleInput() {
    // Auto-grow — reset height first so shrinking works, then measure.
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !disabled) onSubmit();
      }}
      className="border-t border-border bg-background"
    >
      <div className="mx-auto max-w-3xl px-4 py-3 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Ask anything…"}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-foreground/20",
            "placeholder:text-muted-foreground",
          )}
        />
        <Button type="submit" size="icon" disabled={disabled || !value.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
