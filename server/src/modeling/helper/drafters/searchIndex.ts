/**
 * The search index drafter: fills the open search index editor's draft —
 * a custom index's whole definition. A proposal is the whole definition,
 * checked exactly as saving it would be
 * (`searchIndices.checkSearchIndexDefinition`): every shape and schema
 * issue at once, a taken key for a new index, a changed key for a saved
 * one. No cost estimate: it counts instance data, which the helper never
 * reads. It writes nothing.
 */

import { z } from "zod";

import { ValidationError } from "../../../core/exceptions.js";
import { MAX_INDEX_FIELDS, MAX_RELATION_GROUPS } from "../../../core/searchIndex.js";
import * as searchIndices from "../../searchIndices.js";
import type { Drafter } from "../drafter.js";

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

/** A blank label or template as null: the index editor saves it so. */
const unblank = (key: string, value: unknown) =>
  (key === "label" || key === "template") && typeof value === "string" && value.trim() === "" ? null : value;

/** Whether two values are the same as the editor saves them, nested values and list order included. */
const same = (a: unknown, b: unknown) => JSON.stringify(a, unblank) === JSON.stringify(b, unblank);

export const SEARCH_INDEX_GUIDE =
  "Fill the open search index editor's draft (the Search index draft block shows its unsaved definition) " +
  "with fill_draft, only when the person asks you to create, draft or change that index. Read the schema " +
  "first, so every key exists. Always pass the whole definition as fields; a part you leave out takes its " +
  "default:\n" +
  "- key: for a new index a new key (lowercase letters, digits and _, starting with a letter); for a saved " +
  "index leave it out, it never changes.\n" +
  "- name, description: not blank; the description says what the index finds and when to use it — whoever " +
  "searches chooses indices by it.\n" +
  "- entityType: the root type; every hit is an entity of it.\n" +
  "- fields: own property keys of the root whose values are found, in the order they read (default []); a " +
  "document property among them, at most one, is cut into passage entries.\n" +
  "- header: own property keys that start every relation and passage entry, so it says whose entry it is; " +
  "null (default) is the root's name property, [] none.\n" +
  "- relations (default []): groups {relationType, direction, fields, target, label, template}. A group " +
  "follows one relation type one hop: direction outgoing when the root is its source, incoming when it is " +
  "its target. fields: the relation's own property keys; target: {<the entity type at the other end>: " +
  "[its property keys]}. Each relation becomes one entry with its fields and its target's. label (null: " +
  "the relation type's name) heads the entries; template (null: labelled lines) writes them as prose.\n" +
  "- semantic: {enabled (default true), template (null: labelled lines)}; keyword: {enabled (default true)}.\n" +
  "A template replaces the semantic text, and only these placeholders have a value: {x} with x a field key of " +
  "the relation (in a group's template) or of the root, and, in a group's template, {target.x} with x a field " +
  "key of the entity at the other end — e.g. {target.name}, never its type key. Any other placeholder never has " +
  "a value: its clause, up to the next , ; . or line break, is dropped.\n" +
  `Limits: at most ${MAX_INDEX_FIELDS} fields — own, relation and target together; the header does not ` +
  `count — at most ${MAX_RELATION_GROUPS} groups, at least one field or group, every group at least one ` +
  "field, at least one of semantic and keyword on. The check is the one a save runs and reports every issue " +
  "at once with its path. Your proposal holds the parts that differ from the draft; the person reviews the " +
  "entry preview and saves.";

export const searchIndexDrafter: Drafter<SearchIndexFields> = {
  kind: "searchIndex",
  label: "Search index draft",
  fields: SearchIndexFields,
  show: (fields) => ["definition:", JSON.stringify(fields, null, 2)],
  guide: async () => SEARCH_INDEX_GUIDE,
  fill: async (draft, proposed, store) => {
    const saved = draft.target.kind === "searchIndex" ? draft.target.searchIndex : null;
    if (saved === null && (typeof proposed.key !== "string" || proposed.key === "")) {
      throw new ValidationError("A new index needs a key", { fields: { key: "Give the new index a key." } });
    }
    const definition = await searchIndices.checkSearchIndexDefinition(saved, proposed, store);
    const current = draft.fields as unknown as Record<string, unknown>;
    const fields = Object.fromEntries(Object.entries(definition).filter(([field, value]) => !same(value, current[field])));
    if (Object.keys(fields).length === 0) {
      throw new ValidationError("The definition is the same as the open draft: there is nothing to fill.");
    }
    return fields;
  },
};
