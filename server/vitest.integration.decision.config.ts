import { defineConfig } from "vitest/config";

// Local Decision API only; no database or language-model setup is required.
export default defineConfig({
  test: {
    include: ["tests/integration/decision/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
