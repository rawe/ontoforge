/**
 * The Studio helper's search index drafter over a mocked store: the draft
 * as a block and its guide with the message, and its check — the
 * save check decides (mocked here; the real one runs in the integration
 * suite), a new index needs a key, a saved one keeps its own, only the
 * parts that differ from the draft are proposed, an unchanged definition
 * is refused, and nothing is written.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Tool } from "../../src/assistants/index.js";
import { ConflictError } from "../../src/core/exceptions.js";
import type { Draft } from "../../src/modeling/helper/drafter.js";
import { fillDraftTool, type OpenDraft } from "../../src/modeling/helper/drafter.js";
import { draftPart, DraftPayload } from "../../src/modeling/helper/drafters/index.js";
import { searchIndexDrafter, type SearchIndexFields } from "../../src/modeling/helper/drafters/searchIndex.js";
import { studioRun } from "../../src/modeling/helper/helper.js";
import * as searchIndices from "../../src/modeling/searchIndices.js";
import { createMockModelingStore, type MockModelingStore } from "./helpers.js";

vi.mock("../../src/modeling/searchIndices.js", async (original) => ({
  ...(await original<typeof import("../../src/modeling/searchIndices.js")>()),
  checkSearchIndexDefinition: vi.fn(),
}));
const check = vi.mocked(searchIndices.checkSearchIndexDefinition);

type Row = Record<string, unknown>;

const BLANK: SearchIndexFields = {
  key: "", name: "", description: "", entityType: "", fields: [], header: null, relations: [],
  semantic: { enabled: true, template: null }, keyword: { enabled: true },
};
const NEW: Draft<SearchIndexFields> = { target: { kind: "searchIndex", searchIndex: null }, version: 4, fields: BLANK };
const PEOPLE = {
  ...BLANK, key: "people", name: "People", description: "People by name", entityType: "person", fields: ["name"],
};
const SAVED: Draft<SearchIndexFields> = { target: { kind: "searchIndex", searchIndex: "people" }, version: 9, fields: PEOPLE };

let store: MockModelingStore;

/** The draft tool on `draft`, through the index drafter. */
const fillSearchIndexDraftTool = (draft: Draft<SearchIndexFields>, on: MockModelingStore) =>
  fillDraftTool({ drafter: searchIndexDrafter, draft } as OpenDraft, on);

async function call(tool: Tool<null>, fields: Row): Promise<unknown> {
  try {
    return await tool.run({ fields }, null);
  } catch (error) {
    const expected = tool.expected(error);
    if (expected === undefined) throw error;
    return expected;
  }
}
const refusal = (result: unknown) => (result as { error: { code: string; message: string; details?: Row } }).error;

beforeEach(() => {
  store = createMockModelingStore();
  check.mockReset();
  // The check hands back the definition with its defaults, as a save would store it.
  check.mockImplementation(async (saved, body) => ({ ...BLANK, ...body, key: saved ?? (body.key as string) }) as never);
});

describe("the search index draft in a Studio turn", () => {
  it("takes the editor's values, nothing more or less", () => {
    expect(DraftPayload.safeParse(NEW).success).toBe(true);
    expect(DraftPayload.safeParse({ ...NEW, fields: { ...BLANK, cost: 1 } }).success).toBe(false);
    const { header: _header, ...noHeader } = BLANK;
    expect(DraftPayload.safeParse({ ...NEW, fields: noHeader }).success).toBe(false);
    expect(DraftPayload.safeParse({ ...NEW, target: { kind: "searchIndex", searchIndex: "" } }).success).toBe(false);
  });

  it("sends the definition as a labelled block and its guide with the message", async () => {
    const run = studioRun("fair", { entityTypes: [], relationTypes: [], lenses: [] }, { draft: await draftPart(SAVED) }, store, {} as BaseChatModel);
    const block = run.context.at(-1)!;
    expect(block.label).toBe("Search index draft");
    expect(block.text.startsWith("kind: searchIndex\nsearchIndex: people\ndefinition:\n{")).toBe(true);
    expect(JSON.parse(block.text.slice(block.text.indexOf("{")))).toEqual(PEOPLE);
    expect(run.guides).toEqual([{ label: "Search index draft", text: expect.stringContaining("relationType, direction") }]);
    expect(run.tools.map((t) => t.name).at(-1)).toBe("fill_draft");
  });
});

describe("the search index drafter", () => {
  it("proposes a new index's whole definition, checked as a create", async () => {
    const tool = fillSearchIndexDraftTool(NEW, store) as Tool<null>;
    const definition = { key: "people_work", name: "People at work", description: "Who works where", entityType: "person", fields: ["name"] };
    const result = await call(tool, definition);
    expect(check).toHaveBeenCalledWith(null, definition, store);
    expect(result).toEqual({
      target: { kind: "searchIndex", searchIndex: null }, sourceVersion: 4,
      fields: { key: "people_work", name: "People at work", description: "Who works where", entityType: "person", fields: ["name"] },
    });
  });

  it("refuses a new index without a key, before any check", async () => {
    const error = refusal(await call(fillSearchIndexDraftTool(NEW, store) as Tool<null>, { name: "X", description: "Y", entityType: "person" }));
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", details: { fields: { key: "Give the new index a key." } } });
    expect(check).not.toHaveBeenCalled();
  });

  it("checks a saved index as its replacement and proposes only what differs, order included", async () => {
    const tool = fillSearchIndexDraftTool(SAVED, store) as Tool<null>;
    const { key: _key, ...rest } = PEOPLE;
    const result = await call(tool, { ...rest, fields: ["name"], header: [], relations: [
      { relationType: "works_for", direction: "outgoing", fields: ["role"], target: {}, label: null, template: null },
    ] });
    expect(check.mock.calls[0]![0]).toBe("people");
    expect((result as Row).fields).toEqual({
      header: [],
      relations: [{ relationType: "works_for", direction: "outgoing", fields: ["role"], target: {}, label: null, template: null }],
    });
    check.mockImplementationOnce(async () => ({ ...PEOPLE, fields: ["bio", "name"] }) as never);
    const reordered = await call(fillSearchIndexDraftTool({ ...SAVED, fields: { ...PEOPLE, fields: ["name", "bio"] } }, store) as Tool<null>, rest);
    expect((reordered as Row).fields).toEqual({ fields: ["bio", "name"] });
  });

  it("counts a blank label or template as none, as the editor saves it", async () => {
    const group = { relationType: "works_for", direction: "outgoing", fields: ["role"], target: {}, label: "", template: " " };
    const draft = { ...SAVED, fields: { ...PEOPLE, relations: [group] } };
    check.mockImplementationOnce(async () => ({ ...PEOPLE, relations: [{ ...group, label: null, template: null }], description: "New" }) as never);
    const result = await call(fillSearchIndexDraftTool(draft, store) as Tool<null>, { name: "People" });
    expect((result as Row).fields).toEqual({ description: "New" });
  });

  it("refuses a definition the same as the draft", async () => {
    const { key: _key, ...rest } = PEOPLE;
    const error = refusal(await call(fillSearchIndexDraftTool(SAVED, store) as Tool<null>, rest));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("nothing to fill");
  });

  it("hands the save check's refusal to the model", async () => {
    check.mockRejectedValueOnce(new ConflictError("Search index with key 'people' already exists"));
    const error = refusal(await call(fillSearchIndexDraftTool(NEW, store) as Tool<null>, { key: "people", name: "P", description: "P", entityType: "person" }));
    expect(error).toEqual({ code: "RESOURCE_CONFLICT", message: "Search index with key 'people' already exists" });
  });

  it("writes nothing", async () => {
    await call(fillSearchIndexDraftTool(NEW, store) as Tool<null>, { key: "a", name: "A", description: "A", entityType: "person", fields: ["name"] });
    expect(store.changeDesign).not.toHaveBeenCalled();
    expect(store.indices.createIndex).not.toHaveBeenCalled();
  });
});
