// Server-side data access for conversations and messages.
// Owned per user by their Google email (JWT session's session.user.email).
// All helpers verify ownership before returning anything — a user can never see
// another user's conversation, even if they guess a cuid.

import { prisma } from "@/lib/db";

const MAX_CONTEXT_MESSAGES = 20;

export async function getConversations(userEmail: string) {
  return prisma.conversation.findMany({
    where: { userId: userEmail },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
}

/** Returns the conversation *and* its full message history, or null if not owned. */
export async function getConversation(id: string, userEmail: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: userEmail },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  return conv;
}

export async function createConversation(userEmail: string, title: string) {
  return prisma.conversation.create({
    data: {
      userId: userEmail,
      // Keep titles short — first user prompt, truncated
      title: title.trim().slice(0, 60) || "New chat",
    },
  });
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
) {
  const message = await prisma.message.create({
    data: { conversationId, role, content },
  });
  // Bump the conversation's updatedAt so it floats to the top of the history list.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return message;
}

/**
 * Fetch the last N messages of a conversation for feeding to the LLM.
 * Older messages exist in the DB but aren't sent to the model — a rough cap
 * that keeps costs sane and dodges context-window blowups.
 */
export async function getContextMessages(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_CONTEXT_MESSAGES,
    select: { role: true, content: true },
  });
  // findMany returned newest-first for the LIMIT to work; flip to chronological.
  return messages.reverse();
}
