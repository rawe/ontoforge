import { defineConfig } from "vitest/config";

// AI integration tests — require the docker-compose Neo4j AND a local
// Ollama at http://localhost:11434 with the `AI_MODEL` default (qwen3:8b)
// pulled. Kept apart from the plain integration suite because these tests
// install a live language-model provider (per-file `settings` mutation,
// restored on teardown), while that suite's `features: false` assertions
// depend on running with no provider configured. Local models are slow —
// the timeouts are deliberately generous.
export default defineConfig({
  test: {
    include: ["tests/integration/ai/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
