import { defineConfig } from "vitest/config";

// Embedding integration tests — require the docker-compose Neo4j AND a
// local Ollama at http://localhost:11434 with `nomic-embed-text` pulled.
// Kept apart from the plain integration suite because these tests install
// a live embedding provider (per-file `settings` mutation, restored on
// teardown), while that suite's `features: false` assertions depend on
// running with no provider configured.
export default defineConfig({
  test: {
    include: ["tests/integration/embedding/**/*.test.ts"],
    // The suite wipes the database and mutates global provider state; run
    // serially.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
