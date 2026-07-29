import { defineConfig } from "vitest/config";

// Unit tests only — the integration suite (requires the docker-compose
// Neo4j) runs via `npm run test:integration`, mirroring the Python suite's
// `-m 'not integration'` split.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
