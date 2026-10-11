/**
 * The search-index definition as the modeling MCP tools declare it: the
 * input schema a client reads, field by field, with what each field does,
 * its default and its limits.
 *
 * It is MCP's own definition, not the wire-format schema of
 * `core/searchIndex.ts`, and it only describes: the parameter accepts any
 * object, and the service validates it exactly as over REST — every issue
 * at once, and as issues rather than a rejection in the preview. A unit
 * test keeps its fields in step with the wire format.
 */

import { z } from "zod";

import { MAX_INDEX_FIELDS, MAX_RELATION_GROUPS } from "../core/searchIndex.js";
import { MAX_KEY_LENGTH } from "../core/schemas.js";

const keys = (what: string) => z.array(z.string()).describe(what);

const TEMPLATE_RULES =
  "A clause whose placeholder has no value is dropped, up to the next ',', ';', '.' or line " +
  "break; no header or label is added in front. Null or absent: labelled lines.";

export const McpRelationGroup = z.strictObject({
  relationType: z.string().describe("Relation type key; a group follows it one hop from the root."),
  direction: z
    .enum(["outgoing", "incoming"])
    .describe("'outgoing' when the root type is the relation type's source, 'incoming' when it is its target."),
  fields: keys("The relation's own property keys to include. Default [].").optional(),
  target: z
    .record(z.string(), z.array(z.string()))
    .describe(
      "Property keys of the entity at the other end, keyed by that entity's type: {<entityTypeKey>: [keys]}. Default {}.",
    )
    .optional(),
  label: z
    .string()
    .nullable()
    .describe("Heads the semantic text of the group's entries. Null or absent: the relation type's display name.")
    .optional(),
  template: z
    .string()
    .nullable()
    .describe(
      "Prose for the semantic text of each relation entry, instead of labelled lines. {x}: a relation field of " +
        "the group, else an own or header field of the root; {target.x}: a target field. " +
        TEMPLATE_RULES,
    )
    .optional(),
});

export const McpSearchIndexDefinition = z.strictObject({
  key: z
    .string()
    .describe(
      `Index key: a lowercase letter, then lowercase letters, digits or '_'; at most ${MAX_KEY_LENGTH} characters.`,
    ),
  name: z.string().describe("Display name, not blank."),
  description: z.string().describe("What the index finds, not blank; whoever searches chooses indices by it."),
  entityType: z.string().describe("The root entity type key; hits are entities of this type."),
  fields: keys(
    "The root's own property keys whose values the index holds. At most one document property, cut into " +
      "passage entries. Default [].",
  ).optional(),
  header: z
    .array(z.string())
    .nullable()
    .describe(
      "Own property keys of the root that start every relation and passage entry, so it says whose it is; " +
        "a group with a template gets none in front, but its template can use them as {x}. " +
        "Null or absent: the root type's name property; []: no header.",
    )
    .optional(),
  relations: z
    .array(McpRelationGroup)
    .describe(
      `Relation groups, at most ${MAX_RELATION_GROUPS}. Each yields one entry per relation instance, holding ` +
        "that relation's fields and those of the entity it points at. Two groups on one relation type must " +
        "differ in direction. Default [].",
    )
    .optional(),
  semantic: z
    .strictObject({
      enabled: z.boolean().describe("Build semantic (embedding) entries. Default true.").optional(),
      template: z
        .string()
        .nullable()
        .describe("Prose for the semantic text of the entity's own entry; {x}: an own or header field. " + TEMPLATE_RULES)
        .optional(),
    })
    .describe("The semantic representation. Default {enabled: true}.")
    .optional(),
  keyword: z
    .strictObject({
      enabled: z.boolean().describe("Build keyword entries. Default true.").optional(),
    })
    .describe("The keyword representation; it never uses templates. Default {enabled: true}.")
    .optional(),
});

/** Which top-level fields a tool requires: create names the key, update
 * and preview may leave it out. */
const REQUIRED = {
  create: ["key", "name", "description", "entityType"],
  draft: ["name", "description", "entityType"],
} as const;

/**
 * The `definition` parameter of one tool: any object at runtime, passed
 * on whole; the definition above in the published input schema.
 */
export function definitionParameter(kind: keyof typeof REQUIRED) {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(McpSearchIndexDefinition, { io: "input" });
  return z.looseObject({}).meta({
    ...jsonSchema,
    required: [...REQUIRED[kind]],
    description:
      `The search index definition. At most ${MAX_INDEX_FIELDS} fields — own, relation and target fields ` +
      "together; the header does not count — and at least one field or relation group; every group reads at " +
      "least one relation or target field; at least one representation enabled.",
  });
}
