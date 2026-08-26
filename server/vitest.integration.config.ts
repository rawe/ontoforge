import { defineConfig } from "vitest/config";

// Integration tests — require the docker-compose Neo4j at
// bolt://localhost:7687 (credentials per `src/config.ts` defaults).
//
// The embedding suite (`tests/integration/embedding/`) and the AI suite
// (`tests/integration/ai/`) are EXCLUDED here: they configure live
// providers, and this suite's `features: false` assertions depend on
// running with no provider. Run them separately via
// `npm run test:integration:embedding` (requires Ollama with
// nomic-embed-text) and `npm run test:integration:ai` (requires Ollama
// with the `AI_MODEL` default).
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["tests/integration/embedding/**", "tests/integration/ai/**", "node_modules/**"],
    // Suite-level hard reset: a virgin database, once per invocation.
    globalSetup: ["tests/integration/global-setup.ts"],
    // The suite wipes the database and reboots the adapter; run serially.
    fileParallelism: false,
  },
});
