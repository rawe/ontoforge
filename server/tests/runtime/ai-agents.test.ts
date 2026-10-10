/**
 * Runtime AI agent functions (service-level), ported from
 * `tests/runtime/test_ai_agents.py`: agent discovery lists the implicit
 * default agent alongside configured ones. It runs no model, so it works
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

    expect(agents).toHaveLength(2);
    // First should be the default agent.
    expect(agents[0]!.key).toBe("_default");
    expect(agents[0]!.name).toBe(DEFAULT_AGENT_CONFIG.name);
    // Second should be the configured agent.
    expect(agents[1]!.key).toBe("my-agent");
    expect(agents[1]!.name).toBe("My Agent");
    expect(agents[1]!.description).toBe("A custom agent");
  });

  it("with no configured agents, returns only the default", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));

    const agents = await listRuntimeAgents("test_lens", asRuntimeStore(store));

    expect(agents).toHaveLength(1);
    expect(agents[0]!.key).toBe("_default");
  });
});
