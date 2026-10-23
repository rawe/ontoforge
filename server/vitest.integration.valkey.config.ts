import { defineConfig } from "vitest/config";

// The Valkey thread-store suite — requires the dev Valkey of
// docker-compose.yml, database 15 (`env/test-valkey.env`). No database, no
// provider. It flushes that database and changes the Valkey's configuration,
// so it runs serially.
export default defineConfig({
  test: {
    include: ["tests/integration/valkey/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
