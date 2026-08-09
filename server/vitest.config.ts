import { defineConfig } from "vitest/config";

// Unit tests only — the integration suite (requires the docker-compose
// Neo4j) runs via `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
