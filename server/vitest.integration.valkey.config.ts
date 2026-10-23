import { defineConfig } from "vitest/config";

// The Valkey thread-store suite — requires the disposable Valkey that
// `env/test-valkey.env` names. No database, no provider. It flushes that
// Valkey and changes its configuration, so it runs serially.
export default defineConfig({
  test: {
    include: ["tests/integration/valkey/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
