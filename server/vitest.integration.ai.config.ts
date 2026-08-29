import { defineConfig } from "vitest/config";

// AI integration tests — require the docker-compose database AND an armed
// AI provider: `AI_TEST=1` plus the `AI_*` settings, which may point at any
// OpenAI-compatible endpoint. Without `AI_TEST=1` every test skips, so a
// paid endpoint is never billed by accident. Kept apart from the plain
// integration suite because these tests install a live language-model
// provider, while that suite's `features: false` assertions depend on
// running with no provider configured. Real models are slow — the timeouts
// are deliberately generous.
export default defineConfig({
  test: {
    include: ["tests/integration/ai/**/*.test.ts"],
    // Suite-level hard reset: a virgin database, once per invocation.
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
