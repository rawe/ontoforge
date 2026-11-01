/**
 * The Studio helper's draft foundation and its agent drafter, over a
 * mocked store: the one draft tool on every turn, refused without an open
 * draft; the draft as a block and the drafter's guide with the message;
 * a draft only of a kind some drafter fills; and the agent drafter's
 * check — a valid proposal echoes target and draft version, an unknown or
 * gated tool name and an empty name are refused with the reason, and
 * nothing is written.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { beforeEach, describe, expect, it } from "vitest";

import type { Tool } from "../../src/assistants/index.js";
import { fillDraftTool, type Draft, type OpenDraft } from "../../src/modeling/helper/drafter.js";
import { agentDrafter, agentGuide, type AgentFields } from "../../src/modeling/helper/drafters/agent.js";
import { draftPart, DraftPayload } from "../../src/modeling/helper/drafters/index.js";
import { studioRun } from "../../src/modeling/helper/helper.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

type Row = Record<string, unknown>;

const DESIGN = { entityTypes: [], relationTypes: [], lenses: [] };
const LENS = { lensId: "lens-1", key: "hr", name: "HR", description: null, createdAt: NOW, updatedAt: NOW };

const DRAFT: Draft<AgentFields> = {
  target: { kind: "agent", lens: "hr", agent: "support" },
  version: 7,
  fields: { name: "Support", description: "", systemPrompt: "Be brief.", tools: ["get_schema"] },
};

let store: MockModelingStore;
let tool: Tool<null>;

/** A call as the loop makes it: the result, or what an expected failure hands the model. */
async function call(fields: Row, on: Tool<null> = tool): Promise<unknown> {
  try {
    return await on.run({ fields }, null);
  } catch (error) {
    const expected = on.expected(error);
    if (expected === undefined) throw error;
    return expected;
  }
}

const refusal = (result: unknown) => (result as { error: { code: string; message: string; details?: Row } }).error;

beforeEach(() => {
  store = createMockModelingStore();
  store.getLensByKey.mockResolvedValue(LENS);
  tool = fillDraftTool({ drafter: agentDrafter, draft: DRAFT } as OpenDraft, store) as Tool<null>;
});

describe("the draft in a Studio turn", () => {
  const run = async (draft?: Draft<AgentFields>) =>
    studioRun("fair", DESIGN, draft === undefined ? {} : { draft: await draftPart(draft) }, store, {} as BaseChatModel);

  it("offers the same tools with or without a draft, so the toolset never changes", async () => {
    const names = async (draft?: Draft<AgentFields>) => (await run(draft)).tools.map((t) => t.name);
    expect(await names()).toEqual(await names(DRAFT));
    expect((await names()).at(-1)).toBe("fill_draft");
  });

  it("refuses the draft tool without an open draft, telling the model why", async () => {
    const without = fillDraftTool(undefined, store) as Tool<null>;
    expect(refusal(await call({ name: "Helpdesk" }, without))).toMatchObject({
      code: "VALIDATION_ERROR", message: expect.stringContaining("No editor with a draft is open"),
    });
  });

  it("takes a draft only of a kind some drafter fills, with values that fit it", () => {
    expect(DraftPayload.safeParse(DRAFT).success).toBe(true);
    expect(DraftPayload.safeParse({ ...DRAFT, target: { kind: "lens", lens: "hr" } }).success).toBe(false);
    const extra = DraftPayload.safeParse({ ...DRAFT, fields: { ...DRAFT.fields, key: "x" } });
    expect(extra.error?.issues[0]?.path).toEqual(["fields"]);
  });

  it("sends the draft as a labelled block of its own and the drafter's guide, never in the system prompt", async () => {
    const prepared = await run({ ...DRAFT, target: { kind: "agent", lens: "hr", agent: null } });
    const block = prepared.context.at(-1)!;
    expect(block.label).toBe("Agent draft");
    expect(block.text).toBe(
      "kind: agent\nlens: hr\nagent: (new, not saved yet)\nname: Support\ndescription: (empty)\ntools: get_schema\nsystem prompt:\nBe brief.",
    );
    expect(prepared.guides).toEqual([{ label: "Agent draft", text: expect.stringContaining("systemPrompt") }]);
    expect(prepared.instructions).not.toContain("systemPrompt");
    expect((await run()).guides).toEqual([]);
  });
});

describe("the agent drafter", () => {
  it("returns the proposed fields with the draft's target and version", async () => {
    const result = await call({ name: "Helpdesk", systemPrompt: "Answer from the schema.", tools: ["search", "get_entity", "search"] });
    expect(result).toEqual({
      target: { kind: "agent", lens: "hr", agent: "support" },
      sourceVersion: 7,
      fields: { name: "Helpdesk", systemPrompt: "Answer from the schema.", tools: ["search", "get_entity"] },
    });
  });

  it("takes tools null as every tool", async () => {
    const result = await call({ description: "For HR questions", tools: null });
    expect((result as Row).fields).toEqual({ description: "For HR questions", tools: null });
  });

  it("refuses a field the editor does not have, by its path", async () => {
    expect(refusal(await call({ name: "A", system_prompt: "x" }))).toMatchObject({ code: "VALIDATION_ERROR", details: { fields: { fields: expect.any(String) } } });
    expect(refusal(await call({ tools: "search" }))).toMatchObject({ details: { fields: { tools: expect.any(String) } } });
  });

  it("refuses a tool name outside the grantable twelve and names them", async () => {
    const error = refusal(await call({ tools: ["get_schema", "delete_everything"] }));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("Unknown tool(s): ['delete_everything']");
  });

  it("names the tools this server cannot run in the guide", () => {
    expect(agentGuide(["search_saved_queries"])).toContain("This server cannot run search_saved_queries: never grant them.");
    expect(agentGuide([])).not.toContain("cannot run");
  });

  it("refuses an empty name, an empty tool list and an empty proposal", async () => {
    for (const fields of [{ name: " " }, { tools: [] }, {}]) {
      expect(refusal(await call(fields)).code).toBe("VALIDATION_ERROR");
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
