/**
 * Runtime AI agent functions (service-level), ported from
 * `tests/runtime/test_ai_agents.py`: agent discovery lists the implicit
 * default agent alongside configured ones, and A2A cards carry the agent's
 * own description or a generated one naming the lens and its type keys.
 * Neither operation runs a model, so both work with no provider installed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CONFIG, type AgentConfig } from "../../src/core/ai.js";
import { buildAgentCard, listRuntimeAgents } from "../../src/runtime/aiService.js";
import { invalidateLoadedSchemaCache, type SchemaCacheValue } from "../../src/runtime/schemaCache.js";
import { asRuntimeStore, createMockRuntimeStore, makeFullSchema } from "./helpers.js";

function makeSchemaCache(options?: {
  ontologyKey?: string;
  ontologyName?: string;
  ontologyDescription?: string | null;
}): SchemaCacheValue {
  return {
    ontologyId: "ont-1",
    ontologyKey: options?.ontologyKey ?? "test_onto",
    ontologyName: options?.ontologyName ?? "Test Ontology",
    ontologyDescription: options?.ontologyDescription ?? null,
    entityTypes: {
      person: {
        key: "person",
        displayName: "Person",
        description: null,
        properties: {
          name: {
            key: "name",
            displayName: "Name",
            description: null,
            dataType: "string",
            required: true,
            defaultValue: null,
          },
        },
      },
      company: {
        key: "company",
        displayName: "Company",
        description: null,
        properties: {},
      },
    },
    relationTypes: {
      works_for: {
        key: "works_for",
        displayName: "Works For",
        description: null,
        fromEntityTypeKey: "person",
        toEntityTypeKey: "company",
        properties: {},
      },
    },
  };
}

const TEST_AGENT_CONFIG: AgentConfig = {
  key: "my-agent",
  name: "My Agent",
  description: "A custom agent",
  systemPrompt: "You are a test agent",
  tools: ["get_schema"],
};

beforeEach(() => {
  invalidateLoadedSchemaCache();
});

describe("listRuntimeAgents", () => {
  it("returns the default agent plus any configured agents", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchema.mockResolvedValue(makeFullSchema({ ontologyKey: "test_onto" }));
    store.getAiAgentConfigs.mockResolvedValue([
      {
        key: "my-agent",
        name: "My Agent",
        description: "A custom agent",
        systemPrompt: "You are a test agent",
        tools: ["get_schema"],
      },
    ]);

    const agents = await listRuntimeAgents("test_onto", asRuntimeStore(store));

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
    store.getFullSchema.mockResolvedValue(makeFullSchema({ ontologyKey: "test_onto" }));

    const agents = await listRuntimeAgents("test_onto", asRuntimeStore(store));

    expect(agents).toHaveLength(1);
    expect(agents[0]!.key).toBe("_default");
  });
});

describe("buildAgentCard", () => {
  it("builds an A2A agent card with all fields", () => {
    const card = buildAgentCard(TEST_AGENT_CONFIG, makeSchemaCache(), "http://localhost:8000");

    expect(card.name).toBe("My Agent");
    expect(card.description).toBe("A custom agent");
    expect(card.url).toBe(
      "http://localhost:8000/api/runtime/test_onto/ai/agents/my-agent/a2a",
    );
    expect(card.version).toBe("0.1.0");
    expect((card.capabilities as Record<string, unknown>).streaming).toBe(false);
    expect((card.capabilities as Record<string, unknown>).pushNotifications).toBe(false);
    expect(card).toHaveProperty("skills");
    expect(card.skills).toHaveLength(1);
  });

  it("default agent card uses the default A2A URL path", () => {
    const card = buildAgentCard(DEFAULT_AGENT_CONFIG, makeSchemaCache(), "http://localhost:8000");

    expect(card.name).toBe(DEFAULT_AGENT_CONFIG.name);
    expect(card.url).toBe("http://localhost:8000/api/runtime/test_onto/ai/a2a");
  });

  it("auto-generates a description from schema types when none is set", () => {
    const agentNoDesc: AgentConfig = {
      key: "auto-desc",
      name: "Auto Desc Agent",
      description: null,
      systemPrompt: null,
      tools: null,
    };
    const card = buildAgentCard(
      agentNoDesc,
      makeSchemaCache({ ontologyName: "HR Ontology" }),
      "http://localhost:8000",
    );

    const description = card.description as string;
    expect(description).toContain("person");
    expect(description).toContain("company");
    expect(description).toContain("works_for");
    expect(description).toContain("HR Ontology");
  });
});
