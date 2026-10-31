/**
 * The Studio helper's agent draft over a mocked store: the draft as a
 * context block, the draft tool offered only with a draft, and the tool
 * itself — a valid proposal echoes target and draft version, an unknown or
 * gated tool name and an empty name are refused with the reason, and
 * nothing is written.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { beforeEach, describe, expect, it } from "vitest";

import type { Tool } from "../../src/assistants/index.js";
import { fillAgentDraftTool, type AgentDraft } from "../../src/modeling/helper/draft.js";
import { studioRun } from "../../src/modeling/helper/helper.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

type Row = Record<string, unknown>;

const DESIGN = { entityTypes: [], relationTypes: [], lenses: [] };
const LENS = { lensId: "lens-1", key: "hr", name: "HR", description: null, createdAt: NOW, updatedAt: NOW };

const DRAFT: AgentDraft = {
  target: { lensKey: "hr", agentKey: "support" },
  version: 7,
  fields: { name: "Support", description: "", systemPrompt: "Be brief.", tools: ["get_schema"] },
};

let store: MockModelingStore;
let tool: Tool<null>;

/** A call as the loop makes it: the result, or what an expected failure hands the model. */
async function call(args: Row): Promise<unknown> {
  try {
    return await tool.run(args, null);
  } catch (error) {
    const expected = tool.expected(error);
    if (expected === undefined) throw error;
    return expected;
  }
}

const refusal = (result: unknown) => (result as { error: { code: string; message: string } }).error;

beforeEach(() => {
  store = createMockModelingStore();
  store.getLensByKey.mockResolvedValue(LENS);
  tool = fillAgentDraftTool(DRAFT, store, ["search_saved_queries"]);
});

describe("the draft in a Studio turn", () => {
  const run = (draft?: AgentDraft) =>
    studioRun("fair", DESIGN, draft === undefined ? {} : { draft }, store, {} as BaseChatModel);

  it("offers the draft tool only with a draft", () => {
    expect(run().tools.map((t) => t.name)).not.toContain("fill_agent_draft");
    expect(run(DRAFT).tools.map((t) => t.name).at(-1)).toBe("fill_agent_draft");
  });

  it("sends the draft as a labelled block of its own", () => {
    const block = run({ ...DRAFT, target: { lensKey: "hr", agentKey: null } }).context.at(-1)!;
    expect(block.label).toBe("Agent draft");
    expect(block.text).toBe(
      "lens: hr\nagent: (a new agent, not saved yet)\nname: Support\ndescription: (empty)\ntools: get_schema\nsystem prompt:\nBe brief.",
    );
  });
});

describe("fill_agent_draft", () => {
  it("returns the proposed fields with the draft's target and version", async () => {
    const result = await call({ name: "Helpdesk", system_prompt: "Answer from the schema.", tools: ["search", "get_entity", "search"] });
    expect(result).toEqual({
      target: { lensKey: "hr", agentKey: "support" },
      sourceVersion: 7,
      fields: { name: "Helpdesk", systemPrompt: "Answer from the schema.", tools: ["search", "get_entity"] },
    });
  });

  it("takes all_tools as every tool and null arguments as left out", async () => {
    const result = await call({ name: null, description: "For HR questions", all_tools: true, tools: null });
    expect((result as Row).fields).toEqual({ description: "For HR questions", tools: null });
  });

  it("refuses a tool name outside the grantable twelve and names them", async () => {
    const error = refusal(await call({ tools: ["get_schema", "delete_everything"] }));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("Unknown tool(s): ['delete_everything']");
    expect(error.message).toContain("search_saved_queries");
  });

  it("refuses a tool this server cannot run", async () => {
    const error = refusal(await call({ tools: ["get_schema", "search_saved_queries"] }));
    expect(error).toEqual({ code: "VALIDATION_ERROR", message: "This server cannot run search_saved_queries; grant other tools." });
    expect(tool.description).toContain("This server cannot run search_saved_queries: never grant them.");
  });

  it("refuses an empty name, an empty tool list, both tool forms and an empty proposal", async () => {
    for (const args of [{ name: " " }, { tools: [] }, { all_tools: true, tools: ["search"] }, {}]) {
      expect(refusal(await call(args)).code).toBe("VALIDATION_ERROR");
    }
  });

  it("refuses a draft whose lens is gone", async () => {
    store.getLensByKey.mockResolvedValue(null);
    expect(refusal(await call({ name: "Helpdesk" }))).toEqual({ code: "RESOURCE_NOT_FOUND", message: "Lens 'hr' not found" });
  });

  it("writes nothing", async () => {
    await call({ name: "Helpdesk", tools: ["search"] });
    await call({ tools: ["nope"] });
    expect(store.changeDesign).not.toHaveBeenCalled();
    expect(store.upsertAgent).not.toHaveBeenCalled();
  });
});
