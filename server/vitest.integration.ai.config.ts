import { defineConfig } from "vitest/config";

// AI integration tests — require the docker-compose database and the AI
// provider named by their own env file (`env/test-ai.env` via the npm
// script; any OpenAI-compatible endpoint works). That preset carries a local
// Ollama model and no credential, so a default run is free. Kept apart from
// the plain
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
