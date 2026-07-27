import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only pick up tests in src/ so we don't accidentally run Next.js build
    // artifacts or third-party test files under node_modules.
    include: ["src/**/*.test.ts"],
    // Most tests are pure-function CPU work — no need for jsdom.
    environment: "node",
    // Inject placeholder env vars before any test imports src/lib/env.ts —
    // that file zod-parses at module load and otherwise crashes the run.
    setupFiles: ["./src/test-setup.ts"],
  },
  resolve: {
    // Match the path alias used in the app (tsconfig `"@/*": ["./src/*"]`),
    // so tests can `import { foo } from "@/lib/..."` the same way source can.
    // Use fileURLToPath so this works on Windows (bare `pathname` returns
    // "/C:/..." which node's resolver can't handle).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
