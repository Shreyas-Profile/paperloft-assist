// LLM client for Alpha Assist.
// OpenRouter is OpenAI-compatible, so we use @ai-sdk/openai's createOpenAI() with
// a custom baseURL. Same integration story as the Telegram bot.

import { createOpenAI } from "@ai-sdk/openai";

import { env } from "@/lib/env";

export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  // OpenRouter uses these headers to attribute traffic on your dashboard.
  headers: {
    "HTTP-Referer": "https://github.com/Shreyas-Profile/alpha-assist",
    "X-Title": "Alpha Assist",
  },
});

export const CHAT_MODEL = env.MODEL;

export const SYSTEM_PROMPT = `You are Alpha Assist, Shreyas's personal AI assistant running in his own web app.

Rules of the road:
- Be helpful, direct, and concise. This is a chat interface — not an essay.
- Use markdown when it improves readability: bold for emphasis, lists for enumerations, fenced code blocks with language tags for code snippets.
- Ask a clarifying question if the request is genuinely ambiguous; otherwise make a reasonable call and mention what you assumed.
- If the user asks you to send email, post to social media, book something — you don't have those skills wired in yet. Say so briefly and offer to draft the content instead.`;
