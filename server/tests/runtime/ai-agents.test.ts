/**
 * The runtime agent list (service-level): the built-in default agent
 * first, named "Default" and marked built in, then the configured ones. It runs no model, so it works
 * with no provider installed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CONFIG } from "../../src/core/ai.js";
import { listRuntimeAgents } from "../../src/runtime/aiService.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { asRuntimeStore, createMockRuntimeStore, makeFullSchema } from "./helpers.js";

beforeEach(() => {
  invalidateLoadedSchemaCache();
});

describe("listRuntimeAgents", () => {
  it("returns the default agent plus any configured agents", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));
    store.getAiAgentConfigs.mockResolvedValue([
      {
        key: "my-agent",
        name: "My Agent",
        description: "A custom agent",
        systemPrompt: "You are a test agent",
        tools: ["get_schema"],
      },
    ]);

    const agents = await listRuntimeAgents("test_lens", asRuntimeStore(store));

    expect(agents).toEqual([
      { key: "_default", name: "Default", description: null, builtIn: true },
      { key: "my-agent", name: "My Agent", description: "A custom agent", builtIn: false },
    ]);
    expect(agents[0]!.name).toBe(DEFAULT_AGENT_CONFIG.name);
  });

  it("with no configured agents, returns only the default", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));

    const agents = await listRuntimeAgents("test_lens", asRuntimeStore(store));

    expect(agents).toHaveLength(1);
    expect(agents[0]!.key).toBe("_default");
  });
});
