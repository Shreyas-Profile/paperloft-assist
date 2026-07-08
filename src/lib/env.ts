// Env-var validation. Imported anywhere env vars are read.
// Fails loud at startup if a required var is missing/malformed.

import { z } from "zod";

const schema = z.object({
  // Auth.js
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  // LLM
  OPENROUTER_API_KEY: z.string().min(1),
  MODEL: z.string().min(1).default("deepseek/deepseek-v4-pro"),
  // DB
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
});

// Parse eagerly so failures surface at process start, not at the first request.
export const env = schema.parse(process.env);
