import { defineConfig } from "vitest/config";

// Integration tests — require the docker-compose Neo4j at
// bolt://localhost:7687 (credentials per `src/config.ts` defaults).
//
// The embedding suite (`tests/integration/embedding/`) is EXCLUDED here: it
// configures a live embedding provider, and this suite's `features: false`
// assertions depend on running with no provider. Run it separately via
// `npm run test:integration:embedding` (requires Ollama with
// nomic-embed-text) — mirroring the Python suite's marker split.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["tests/integration/embedding/**", "node_modules/**"],
    // The suite wipes the database and reboots the adapter; run serially.
    fileParallelism: false,
  },
});
