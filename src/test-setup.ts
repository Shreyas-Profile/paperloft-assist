// Runs before every test file. `src/lib/env.ts` does eager Zod validation
// on module load, so any test importing anything transitively pulling env
// in will fail without these placeholders. Values are junk — tests must
// never actually hit external services (Google, OpenRouter, the DB).

process.env.AUTH_SECRET ??= "test-secret-not-used";
process.env.AUTH_GOOGLE_ID ??= "test-google-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-secret";
process.env.OPENROUTER_API_KEY ??= "test-openrouter-key";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
