/**
 * The Studio helper's tools: reads of one ontology's design — its schema,
 * lenses with their scope, search indices, and the two validations. No
 * tool reads instance data or anything derived from it: no records, no
 * counts, no build cost estimate, no index build progress or errors. Each
 * calls the same modeling service read REST and MCP use; a not-found,
 * validation or conflict error goes back to the model as the call's result.
 */

import { z } from "zod";

import type { Tool } from "../../assistants/index.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/exceptions.js";
import type { ModelingStore } from "../../core/ports.js";
import * as searchIndices from "../searchIndices.js";
import * as service from "../service.js";

type Row = Record<string, unknown>;

/** An expected modeling error as the model reads it; undefined for any other. */
export function expectedError(error: unknown): { error: Row } | undefined {
  const code = error instanceof NotFoundError ? "RESOURCE_NOT_FOUND"
    : error instanceof ValidationError ? "VALIDATION_ERROR"
      : error instanceof ConflictError ? "RESOURCE_CONFLICT"
        : null;
  if (code === null) return undefined;
  const { message, details } = error as NotFoundError;
  return { error: { code, message, ...(details === null ? {} : { details }) } };
}

/** The design as the transfer format exports it — no instance data. */
export const readDesign = (store: ModelingStore): Promise<Row> => service.getSchemaExport(store);

/** A lens's scope as the tools and the briefing state it: `includes` null
 * for a lens that shows the whole schema. */
export function lensScope(lens: Row): Row {
  return {
    key: lens.key,
    name: lens.name,
    description: lens.description ?? null,
    includes: lens.includes ?? null,
    searchIndices: lens.indexInclusions ?? [],
  };
}

interface DesignTool {
  name: string;
  description: string;
  input: z.ZodType;
  run(store: ModelingStore, args: Row): Promise<unknown>;
}

const DESIGN_TOOLS: DesignTool[] = [
  {
    name: "get_schema",
    description:
      "Get the ontology's schema: every entity type and relation type with its properties. An entity " +
      "type has key, displayName, description, nameProperty, identityProperties (when it has an identity) " +
      "and properties. A relation type has key, displayName, description, fromEntityTypeKey, " +
      "toEntityTypeKey, parent (the end that is the parent, or null), onePerPair (when set) and " +
      "properties. A property has key, displayName, description, dataType, required and defaultValue.",
    input: z.object({}),
    run: async (store) => {
      const { entityTypes, relationTypes } = await readDesign(store);
      return { entityTypes, relationTypes };
    },
  },
  {
    name: "list_lenses",
    description:
      "List the ontology's lenses with their scope. Each lens has key, name, description, includes and " +
      "searchIndices. includes is null for a lens that shows the whole schema; otherwise it lists the " +
      "entityTypes and relationTypes the lens shows, each with key and properties (null: every property " +
      "of the type). searchIndices are the keys of the search indices the lens includes.",
    input: z.object({}),
    run: async (store) => ((await readDesign(store)).lenses as Row[]).map(lensScope),
  },
  {
    name: "list_search_indices",
    description:
      "List the ontology's search indices: the managed ones (keys with '~', one default and one passage " +
      "index per entity type, switched on or off in the search settings) and the custom ones. Each has key, " +
      "kind (default, passage or custom), enabled (false for a switched-off managed index), definition, " +
      "documentProperty and state (ready, building, stale, failed, disabled or unavailable).",
    input: z.object({}),
    run: async (store) => (await searchIndices.listSearchIndices(store)).map((index) => ({
      key: index.key,
      kind: index.kind,
      enabled: index.enabled,
      definition: index.definition,
      documentProperty: index.documentProperty,
      state: index.status.state,
    })),
  },
  {
    name: "validate_schema",
    description:
      "Check the whole schema and every lens for consistency. Returns {valid, errors, warnings}; each " +
      "issue names its path and a message. Warnings never make the design invalid.",
    input: z.object({}),
    run: (store) => service.validateAll(store),
  },
  {
    name: "validate_lens",
    description:
      "Check one lens's scope against the schema. lens_key: the lens's key. Returns {valid, errors, " +
      "warnings}; each issue names its path and a message. Warnings name what limits the search indices " +
      "the lens includes: a root type it does not show, properties an index reads that it hides.",
    input: z.object({ lens_key: z.string() }),
    run: async (store, args) => {
      const lens = await store.getLensByKey(args.lens_key as string);
      if (!lens) throw new NotFoundError(`Lens '${String(args.lens_key)}' not found`);
      return service.validateLens(lens.lensId as string, store);
    },
  },
];

/** The design tools, bound to one ontology's store. */
export function designTools(store: ModelingStore): Tool<null>[] {
  return DESIGN_TOOLS.map((def) => ({
    name: def.name,
    description: def.description,
    input: def.input,
    run: (args: Row) => def.run(store, args),
    expected: expectedError,
  }));
}
