"use client";

// Bottom-pinned message composer. Enter to send, Shift+Enter for newline.
// Auto-resizes vertically up to a max height.
//
// File attach flow: paperclip icon opens picker → POST to /api/docs/upload
// with the file → paperloft proxies it to docs.regiq.in using the user's
// docs-mcp key (SkillConnection) → returns docId. When the user sends the
// message, we prepend a short "[Attached: filename.pdf (docId: xxx, status)]"
// line so the LLM knows to poll docs_get and use docs_search.

import { useRef, useState, type KeyboardEvent } from "react";
import { Send, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation";

interface AttachedDoc {
  docId: string;
  filename: string;
  status: string;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (extra?: { attachedDoc?: AttachedDoc }) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({ value, onChange, onSubmit, disabled, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [attached, setAttached] = useState<AttachedDoc | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || attached) && !disabled && !uploading) {
        onSubmit({ attachedDoc: attached ?? undefined });
        setAttached(null);
      }
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  async function handleFileChosen(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/docs/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      setAttached({ docId: body.docId, filename: body.filename, status: body.status });
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const canSend = (value.trim() || attached) && !disabled && !uploading;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) {
          onSubmit({ attachedDoc: attached ?? undefined });
          setAttached(null);
        }
      }}
      className="border-t border-border bg-background"
    >
      <div className="mx-auto max-w-3xl px-4 py-3">
        {attached && (
          <div className="mb-2 flex items-center gap-2 rounded border border-border bg-foreground/[0.03] px-2 py-1 text-xs">
            <Paperclip className="h-3 w-3" />
            <span className="truncate flex-1">
              {attached.filename}{" "}
              <span className="text-muted-foreground">— {attached.status}</span>
            </span>
            <button
              type="button"
              onClick={() => setAttached(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove attachment"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {uploadError && (
          <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {uploadError}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => handleFileChosen(e.target.files)}
            className="hidden"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach document"
          >
            <Paperclip className={cn("h-4 w-4", uploading && "animate-pulse")} />
          </Button>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              uploading
                ? "Uploading document…"
                : placeholder ?? "Ask anything… (or paperclip to attach a PDF)"
            }
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-foreground/20",
              "placeholder:text-muted-foreground",
            )}
          />
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}
