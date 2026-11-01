/**
 * The search index drafter: fills the open search index editor's draft —
 * a custom index's whole definition. Its tool takes the definition in the
 * shape the modeling MCP tools publish (`mcp/searchIndexDefinition.ts`)
 * and checks it exactly as saving it would
 * (`searchIndices.checkSearchIndexDefinition`): every shape and schema
 * issue at once, a taken key for a new index, a changed key for a saved
 * one. No cost estimate: it counts instance data, which the helper never
 * reads. It writes nothing.
 */

import { z } from "zod";

import type { Tool } from "../../../assistants/index.js";
import { ValidationError } from "../../../core/exceptions.js";
import type { ModelingStore } from "../../../core/ports.js";
import { MAX_INDEX_FIELDS, MAX_RELATION_GROUPS } from "../../../core/searchIndex.js";
import { McpSearchIndexDefinition } from "../../../mcp/searchIndexDefinition.js";
import * as searchIndices from "../../searchIndices.js";
import { draftProposal, type Draft, type Drafter } from "../drafter.js";
import { expectedError } from "../tools.js";

/** The search index editor's values: a definition as the editor holds it,
 * possibly incomplete — an empty key, name or root type until chosen. */
export const SearchIndexFields = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    entityType: z.string(),
    fields: z.array(z.string()),
    header: z.array(z.string()).nullable(),
    relations: z.array(z.object({
      relationType: z.string(),
      direction: z.string(),
      fields: z.array(z.string()),
      target: z.record(z.string(), z.array(z.string())),
      label: z.string().nullable(),
      template: z.string().nullable(),
    }).strict()),
    semantic: z.object({ enabled: z.boolean(), template: z.string().nullable() }).strict(),
    keyword: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();
export type SearchIndexFields = z.infer<typeof SearchIndexFields>;

export const FILL_SEARCH_INDEX_DRAFT = "fill_search_index_draft";

/** Whether two values are the same, nested values and list order included. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The draft tool: proposes a whole definition for the open search index editor's draft. */
export function fillSearchIndexDraftTool(draft: Draft<SearchIndexFields>, store: ModelingStore): Tool<unknown> {
  const saved = draft.target.kind === "searchIndex" ? draft.target.searchIndex : null;
  return {
    name: FILL_SEARCH_INDEX_DRAFT,
    description:
      "Propose a search index definition for the search index editor the person has open (the Search index " +
      "draft block with their message shows its unsaved definition). Call it only when they ask you to " +
      "create, draft or change that index; read the schema first, so every key exists. Always send the whole " +
      "definition: a part you leave out takes its default. key: for a new index a new key (lowercase letters, " +
      "digits and '_', starting with a letter); for a saved index leave it out, it never changes. How to " +
      "choose: entityType is the type every hit is. fields are the root's own properties whose text should " +
      "be found; one document property among them is cut into passage entries. A relation group follows one " +
      "relation type one hop, outgoing when the root is its source, incoming when it is its target; each " +
      "relation becomes one entry holding its fields and the target fields of the entity at its other end. " +
      "The header starts every relation and passage entry so it says whose entry it is. A template turns an " +
      "entry's semantic text into prose. Limits: at most " +
      `${MAX_INDEX_FIELDS} fields (own, relation and target together; the header does not count), at most ` +
      `${MAX_RELATION_GROUPS} relation groups, at least one field or group, every group at least one field, ` +
      "at least one of semantic and keyword on. The server checks it exactly as a save would and returns every " +
      "issue at once with its path: fix them and call again. Nothing is saved: the person fills the editor " +
      "from your proposal, reviews its entry preview and saves it. Returns the proposal {target, " +
      "sourceVersion, fields} with the parts that differ from the draft.",
    input: McpSearchIndexDefinition.partial({ key: true }),
    run: async (args) => {
      if (saved === null && (typeof args.key !== "string" || args.key === "")) {
        throw new ValidationError("A new index needs a key", { fields: { key: "Give the new index a key." } });
      }
      const definition = await searchIndices.checkSearchIndexDefinition(saved, args, store);
      const current = draft.fields as unknown as Record<string, unknown>;
      const fields = Object.fromEntries(Object.entries(definition).filter(([field, value]) => !same(value, current[field])));
      if (Object.keys(fields).length === 0) {
        throw new ValidationError("The definition is the same as the open draft: there is nothing to fill.");
      }
      return draftProposal(draft, fields);
    },
    expected: expectedError,
  };
}

export const searchIndexDrafter: Drafter<SearchIndexFields> = {
  kind: "searchIndex",
  label: "Search index draft",
  fields: SearchIndexFields,
  show: (fields) => ["definition:", JSON.stringify(fields, null, 2)],
  tools: async (draft, store) => [fillSearchIndexDraftTool(draft, store)],
};
