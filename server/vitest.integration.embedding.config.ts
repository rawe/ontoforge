import { defineConfig } from "vitest/config";

// Embedding integration tests — require the docker-compose database AND a
// local Ollama at http://localhost:11434 with the configured
// `EMBEDDING_MODEL` (bge-m3 in `env/test-embedding.env`) pulled.
// Kept apart from the plain integration suite because these tests install
// a live embedding provider (per-file `settings` mutation, restored on
// teardown), while that suite's `features: false` assertions depend on
// running with no provider configured.
export default defineConfig({
  test: {
    include: ["tests/integration/embedding/**/*.test.ts"],
    // Suite-level hard reset: a virgin database, once per invocation.
    globalSetup: ["tests/integration/global-setup.ts"],
    // The suite wipes the database and mutates global provider state; run
    // serially.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
