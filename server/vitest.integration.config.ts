import { defineConfig } from "vitest/config";

// Integration tests — require the docker-compose Neo4j at
// bolt://localhost:7687 (credentials per `src/config.ts` defaults).
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // The suite wipes the database and reboots the adapter; run serially.
    fileParallelism: false,
  },
});
