"use client";

// Modal listing the user's past conversations. Server data comes in via prop.

import Link from "next/link";
import { History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Conversation = {
  id: string;
  title: string;
  updatedAt: Date;
};

export function HistoryDialog({ conversations }: { conversations: Conversation[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="History" className="gap-2">
          <History className="h-4 w-4" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[70vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Conversations</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto -mx-2 px-2">
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No conversations yet. Send a message to start one.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <DialogClose asChild>
                    <Link
                      href={`/chat/${c.id}`}
                      className="flex flex-col rounded-md px-3 py-2 hover:bg-foreground/5 transition"
                    >
                      <span className="text-sm truncate">{c.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatWhen(c.updatedAt)}
                      </span>
                    </Link>
                  </DialogClose>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatWhen(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
