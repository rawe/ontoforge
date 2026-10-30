/**
 * Modeling MCP server: one ontology's schema surface over MCP.
 *
 * The server is bound to the ontology its mount URL names
 * (`/mcp/ontologies/:ontologyKey/model`) — the URL is the only binding
 * channel, and no tool takes an ontology parameter, so a bound client
 * can never reach, list, or infer another ontology's existence. The one
 * registry-touching tool is the argument-less `ensure_ontology`, which
 * creates the mount's own ontology if missing; every other tool fails
 * with not-found until the ontology exists. No lens key anywhere — the
 * schema belongs to no lens. Tools take KEYS (never internal
 * identifiers) plus a `type_kind` discriminator for properties, and
 * resolve keys to internal ids per call (never cached). Tool parameters
 * are snake_case on the wire (`docs/interfaces/`, "JSON shape").
 *
 * Tools call the modeling services directly — never HTTP to the REST
 * routes; a second path would be a second contract. Failures are reported
 * as tool errors; because a tool error is a single string, per-field
 * detail is flattened into the message text.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodError } from "zod";

import type { AccessActor } from "../access/store.js";
import { NotFoundError, ValidationError } from "../core/exceptions.js";
import { getModelingStore, getOntologyRegistry, getRuntimeStore } from "../core/ports.js";
import type { ModelingStore } from "../core/ports.js";
import {
  DEFAULT_ANSWER_FIELD_CHARACTERS,
  DEFAULT_THRESHOLD,
  MAX_RETRIEVER_FILTERS,
  MAX_RETRIEVER_INDICES,
  MAX_ANSWER_FIELDS,
  MAX_FILTER_HOPS,
  RETRIEVER_CONFIG_VERSION,
} from "../core/retriever.js";
import {
  LENS_RESOURCE_KEY_PATTERN,
  MAX_KEY_LENGTH,
  PARENT_ENDS,
  type ParentEnd,
  type TypeKind,
} from "../core/schemas.js";
import { OntologyCreate } from "../registry/schemas.js";
import * as registryService from "../registry/service.js";
import {
  AgentConfigUpsert,
  EntityTypeCreate,
  EntityTypeUpdate,
  IncludeTypeRequest,
  LensCreate,
  LensUpdate,
  PropertyDefinitionCreate,
  PropertyDefinitionUpdate,
  RelationTypeCreate,
  RelationTypeUpdate,
  SavedQueryUpsert,
  SearchSettingsUpdate,
  TRANSFER_FORMAT_VERSION,
} from "../modeling/schemas.js";
import * as retrievers from "../modeling/retrievers.js";
import { IMPORTABLE_FORMAT_VERSIONS } from "../modeling/transfer/upgrades.js";
import * as searchIndices from "../modeling/searchIndices.js";
import * as service from "../modeling/service.js";
import { VALID_AGENT_TOOLS_CSV } from "../runtime/toolNames.js";
import { definitionParameter } from "./searchIndexDefinition.js";

// ---------------------------------------------------------------------------
// Error flattening
// ---------------------------------------------------------------------------

/**
 * Flatten an error into one message string: `details.fields` and
 * `details.errors` are appended to the message so a model still sees every
 * offending field in one response, and so are a rejected changeset's
 * `details.violations` with their `total`. Zod issues (request-shape
 * failures inside a tool) are joined the same way.
 */
export function formatToolError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");
  }
  if (error instanceof ValidationError) {
    const message = error.message;
    const details = error.details;
    if (!details) {
      return message;
    }
    if ("fields" in details) {
      const fields = details.fields as Record<string, unknown>;
      const fieldErrors = Object.entries(fields)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("; ");
      return `${message} — ${fieldErrors}`;
    }
    if ("errors" in details) {
      const errors = (details.errors as unknown[]).map(String).join("; ");
      // Some messages already carry their errors; never repeat them.
      return message.includes(errors) ? message : `${message} — ${errors}`;
    }
    if ("violations" in details) {
      const violations = details.violations as { object: string | null; property?: string; kind: string; message: string }[];
      const total = details.total as number;
      const at = (v: (typeof violations)[number]): string =>
        (v.object === null ? "changeset" : `object ${v.object}`) + (v.property === undefined ? "" : ` property ${v.property}`);
      const listed = violations.map((v) => `${at(v)} ${v.kind}: ${v.message}`).join("; ");
      const shown = total > violations.length ? `, the first ${violations.length} shown` : "";
      return `${message} — ${total} violation${total === 1 ? "" : "s"}${shown}: ${listed}`;
    }
    return message;
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Result and handler plumbing
// ---------------------------------------------------------------------------

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Run a tool body; any failure becomes a flattened tool error. */
function wrap<Args>(
  name: string,
  fn: (args: Args) => Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Error executing tool ${name}: ${formatToolError(error)}` },
        ],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Key resolution (per call, never cached)
// ---------------------------------------------------------------------------

async function resolveEntityType(
  store: ModelingStore,
  entityTypeKey: string,
): Promise<Record<string, unknown>> {
  const data = await store.getEntityTypeByKey(entityTypeKey);
  if (!data) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }
  return data;
}

async function resolveRelationType(
  store: ModelingStore,
  relationTypeKey: string,
): Promise<Record<string, unknown>> {
  const data = await store.getRelationTypeByKey(relationTypeKey);
  if (!data) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }
  return data;
}

async function resolveProperty(
  store: ModelingStore,
  ownerId: string,
  typeKind: TypeKind,
  propertyKey: string,
): Promise<Record<string, unknown>> {
  const data = await store.getPropertyByKey(ownerId, typeKind, propertyKey);
  if (!data) {
    throw new NotFoundError(`Property '${propertyKey}' not found`);
  }
  return data;
}

async function resolveLensByKey(
  store: ModelingStore,
  lensKey: string,
): Promise<Record<string, unknown>> {
  const data = await store.getLensByKey(lensKey);
  if (!data) {
    throw new NotFoundError(`Lens '${lensKey}' not found`);
  }
  return data;
}

/** Map the MCP wire value (`entity_type`/`relation_type`) to the port's
 * owner-kind vocabulary. */
function resolveTypeKind(wireTypeKind: string): TypeKind {
  if (wireTypeKind === "entity_type") {
    return "EntityType";
  }
  if (wireTypeKind === "relation_type") {
    return "RelationType";
  }
  throw new ValidationError(
    `Invalid type_kind '${wireTypeKind}'. Must be 'entity_type' or 'relation_type'.`,
  );
}

async function resolveOwner(
  store: ModelingStore,
  wireTypeKind: string,
  typeKey: string,
): Promise<[string, TypeKind]> {
  const typeKind = resolveTypeKind(wireTypeKind);
  if (typeKind === "EntityType") {
    const owner = await resolveEntityType(store, typeKey);
    return [owner.entityTypeId as string, typeKind];
  }
  const owner = await resolveRelationType(store, typeKey);
  return [owner.relationTypeId as string, typeKind];
}

/** A search index's build status, as the tools that return one state it. */
const SEARCH_INDEX_STATUS =
  "Status: state (ready, building, stale, failed, disabled or unavailable); representations, " +
  "each with representation, state, build ({done, total} of the build filling a new " +
  "generation, null when none is), pending (queued changes not yet indexed) and failed " +
  "(items whose retries are used up, retried by a rebuild or a new write of their entity); " +
  "lastErrors (entityId, partKind, message, at).";

/** A search index as the read tools return it. */
const SEARCH_INDEX_RECORD =
  "An index has key, kind (default, passage or custom), enabled (false for a switched-off " +
  "managed index), definition, documentProperty, status, createdAt and updatedAt. " +
  SEARCH_INDEX_STATUS;

// ---------------------------------------------------------------------------
// Server factory (stateless transport: one server per request)
// ---------------------------------------------------------------------------

/** Build the modeling MCP server bound to one ontology key. */
/**
 * The modeling server of one ontology. With authentication on — `actor`,
 * the calling administrator — every tool needs the ontology's
 * administrator (the mount's route check, which answers not found for a
 * missing ontology), so `ensure_ontology` never creates one: an ontology
 * is created over REST, where its creator becomes its administrator.
 */
export function createModelingMcpServer(ontologyKey: string, actor: AccessActor | null = null): McpServer {
  const server = new McpServer({ name: "OntoForge Modeling", version: "0.1.0" });
  const authentication = actor !== null;

  // The ONE registry-touching tool over MCP (`docs/interfaces/mcp.md#how-a-mount-is-bound`): with
  // no arguments it can only ever act on the binding the client already
  // holds — it cannot list, reach, rename, or delete anything.
  server.registerTool(
    "ensure_ontology",
    {
      description:
        "Create the ontology this mount is bound to if it does not exist yet; " +
        "no-op if it does. Takes no arguments — it acts only on the mount's own " +
        "ontology — and reports the ontology key and whether it created. A " +
        "created ontology starts bare (no types, no lenses, no data) and " +
        "without a display name; naming happens over REST/UI." +
        (authentication
          ? " This server requires sign-in: it creates no ontology; a missing one is created " +
            "through the REST API or the web client."
          : ""),
      inputSchema: {},
    },
    wrap("ensure_ontology", async () => {
      const registry = getOntologyRegistry();
      if ((await registry.getOntology(ontologyKey)) !== null) {
        return jsonResult({ key: ontologyKey, created: false });
      }
      const body = OntologyCreate.parse({ key: ontologyKey });
      await registryService.createOntology(body, registry);
      return jsonResult({ key: ontologyKey, created: true });
    }),
  );

  server.registerTool(
    "get_schema",
    {
      description:
        "Get the current state of the ontology's schema. Returns all entity types, " +
        "relation types, and their properties, the keyword language set, the search " +
        "indices (custom definitions and switched-off managed indices) and the lenses with " +
        "their type and search-index inclusions, assistants (agents, retrievers and navigators) and saved queries.",
      inputSchema: {},
    },
    wrap("get_schema", async () => {
      const result = await service.getSchemaExport(await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "create_entity_type",
    {
      description:
        "Add a new entity type to the schema. Key must be snake_case, unique within the ontology. " +
        "Also creates the type's name property — the string property that names its " +
        "entities — under name_property (default 'name'). Optional " +
        "identity_properties: the ordered keys (1 to 5) of the type's own string, integer or date " +
        "properties whose values, joined with '~', name each entity uniquely within the type. They " +
        "must be required with no default and shown by every lens allowlist for the type; with " +
        "cascade=True the server makes them so, otherwise the call is refused. Refused too when " +
        "stored entities lack a value or would share an identity.",
      inputSchema: {
        key: z.string(),
        display_name: z.string(),
        description: z.string().optional(),
        name_property: z.string().optional(),
        identity_properties: z.array(z.string()).optional(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("create_entity_type", async (args: {
      key: string;
      display_name: string;
      description?: string | undefined;
      name_property?: string | undefined;
      identity_properties?: string[] | undefined;
      cascade?: boolean | undefined;
    }) => {
      const body = EntityTypeCreate.parse({
        key: args.key,
        displayName: args.display_name,
        description: args.description ?? null,
        nameProperty: args.name_property,
        identityProperties: args.identity_properties ?? null,
      });
      const result = await service.createEntityType(
        body,
        await getModelingStore(ontologyKey),
        args.cascade ?? false,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_entity_type",
    {
      description:
        "Update an entity type's display name, description, name property or identity. Key is " +
        "immutable. name_property must be the key of an existing string property of the type. " +
        "identity_properties: the ordered keys (1 to 5) of the type's own string, integer or date " +
        "properties whose values, joined with '~', name each entity uniquely within the type. They " +
        "must be required with no default and shown by every lens allowlist for the type; with " +
        "cascade=True the server makes them so, otherwise the call is refused. Refused too when " +
        "stored entities lack a value or would share an identity. null clears the identity; omitted leaves it unchanged. Changing the " +
        "identity renames every entity's identity.",
      inputSchema: {
        entity_type_key: z.string(),
        display_name: z.string().optional(),
        description: z.string().optional(),
        name_property: z.string().optional(),
        identity_properties: z.array(z.string()).nullable().optional(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("update_entity_type", async (args: {
      entity_type_key: string;
      display_name?: string | undefined;
      description?: string | undefined;
      name_property?: string | undefined;
      identity_properties?: string[] | null | undefined;
      cascade?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const et = await resolveEntityType(store, args.entity_type_key);
      const body = EntityTypeUpdate.parse({
        displayName: args.display_name ?? null,
        description: args.description ?? null,
        nameProperty: args.name_property ?? null,
        identityProperties: args.identity_properties,
      });
      const result = await service.updateEntityType(
        et.entityTypeId as string,
        body,
        store,
        args.cascade ?? false,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_entity_type",
    {
      description:
        "Remove an entity type and its properties. Use cascade=True to auto-remove " +
        "from any scoped lenses and custom search indices (indices rooted on it are " +
        "deleted). Fails if any relation type references it.",
      inputSchema: {
        entity_type_key: z.string(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("delete_entity_type", async (args: {
      entity_type_key: string;
      cascade?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const et = await resolveEntityType(store, args.entity_type_key);
      await service.deleteEntityType(et.entityTypeId as string, args.cascade ?? false, store);
      return textResult(`Entity type '${args.entity_type_key}' deleted successfully.`);
    }),
  );

  server.registerTool(
    "create_relation_type",
    {
      description:
        "Add a new relation type connecting two entity types. Source and target are " +
        "specified by entity type key. parent ('source' or 'target') makes it a parent " +
        "relation: the entity at that end is the parent of the entity at the other. " +
        "Omit it for an ordinary relation type. one_per_pair true allows at most one " +
        "relation of the type from one source entity to one target entity; a parent " +
        "relation always has it, and false is refused with a parent end. A parent end is " +
        "refused when relations already stored under the key would give an entity two " +
        "parents or form a cycle, and one_per_pair when they link one pair twice.",
      inputSchema: {
        key: z.string(),
        display_name: z.string(),
        source_entity_type_key: z.string(),
        target_entity_type_key: z.string(),
        description: z.string().optional(),
        parent: z.enum(PARENT_ENDS).optional(),
        one_per_pair: z.boolean().optional(),
      },
    },
    wrap("create_relation_type", async (args: {
      key: string;
      display_name: string;
      source_entity_type_key: string;
      target_entity_type_key: string;
      description?: string | undefined;
      parent?: ParentEnd | undefined;
      one_per_pair?: boolean | undefined;
    }) => {
      const body = RelationTypeCreate.parse({
        key: args.key,
        displayName: args.display_name,
        description: args.description ?? null,
        sourceEntityTypeKey: args.source_entity_type_key,
        targetEntityTypeKey: args.target_entity_type_key,
        parent: args.parent ?? null,
        onePerPair: args.one_per_pair,
      });
      const result = await service.createRelationType(body, await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_relation_type",
    {
      description:
        "Update a relation type's display name, description, parent end or one per pair. " +
        "Source/target endpoints are immutable. parent 'source' or 'target' sets the " +
        "parent end, null clears it (an ordinary relation type again), and omitting it " +
        "leaves it unchanged. one_per_pair true allows at most one relation of the type " +
        "from one source entity to one target entity, false allows any number; omitting " +
        "it leaves it unchanged. A parent relation always has one_per_pair: setting a " +
        "parent end turns it on, clearing the parent end keeps it on, and false is refused " +
        "while a parent end is set. Setting or changing the parent end is refused when the " +
        "stored relations would then give an entity two parents or form a cycle, and " +
        "turning one_per_pair on when they link one pair twice; clearing either is never " +
        "refused.",
      inputSchema: {
        relation_type_key: z.string(),
        display_name: z.string().optional(),
        description: z.string().optional(),
        parent: z.enum(PARENT_ENDS).nullable().optional(),
        one_per_pair: z.boolean().optional(),
      },
    },
    wrap("update_relation_type", async (args: {
      relation_type_key: string;
      display_name?: string | undefined;
      description?: string | undefined;
      parent?: ParentEnd | null | undefined;
      one_per_pair?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const rt = await resolveRelationType(store, args.relation_type_key);
      const body = RelationTypeUpdate.parse({
        displayName: args.display_name ?? null,
        description: args.description ?? null,
        parent: args.parent,
        onePerPair: args.one_per_pair,
      });
      const result = await service.updateRelationType(rt.relationTypeId as string, body, store);
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_relation_type",
    {
      description:
        "Remove a relation type and its properties. Use cascade=True to auto-remove " +
        "from any scoped lenses and the relation groups of custom search indices.",
      inputSchema: {
        relation_type_key: z.string(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("delete_relation_type", async (args: {
      relation_type_key: string;
      cascade?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const rt = await resolveRelationType(store, args.relation_type_key);
      await service.deleteRelationType(
        rt.relationTypeId as string,
        args.cascade ?? false,
        store,
      );
      return textResult(`Relation type '${args.relation_type_key}' deleted successfully.`);
    }),
  );

  server.registerTool(
    "add_property",
    {
      description:
        "Add a property definition to an entity type or relation type. " +
        "type_kind must be 'entity_type' or 'relation_type'. " +
        "data_type must be one of: string, integer, float, boolean, date, " +
        "datetime, document. The 'document' type holds large text interpreted " +
        "as Markdown; it is always chunked for passage-level search with optional " +
        "embeddings and is returned as a stub by default in runtime reads. Document properties are only allowed on entity types " +
        "— on relation types they are rejected. " +
        "Use cascade=True to auto-add required properties to scoped lens property lists.",
      inputSchema: {
        type_kind: z.string(),
        type_key: z.string(),
        key: z.string(),
        display_name: z.string(),
        data_type: z.string(),
        required: z.boolean().optional(),
        default_value: z.string().optional(),
        description: z.string().optional(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("add_property", async (args: {
      type_kind: string;
      type_key: string;
      key: string;
      display_name: string;
      data_type: string;
      required?: boolean | undefined;
      default_value?: string | undefined;
      description?: string | undefined;
      cascade?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const [ownerId, typeKind] = await resolveOwner(store, args.type_kind, args.type_key);
      const body = PropertyDefinitionCreate.parse({
        key: args.key,
        displayName: args.display_name,
        description: args.description ?? null,
        dataType: args.data_type,
        required: args.required ?? false,
        defaultValue: args.default_value ?? null,
      });
      const result = await service.createProperty(
        ownerId,
        typeKind,
        body,
        args.cascade ?? false,
        store,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_property",
    {
      description:
        "Update a property's metadata. Key and data type are immutable after creation. " +
        "type_kind must be 'entity_type' or 'relation_type'. " +
        "Omitted arguments stay unchanged; pass default_value as null to remove a default. " +
        "A property in its entity type's identity cannot become optional or take a default.",
      inputSchema: {
        type_kind: z.string(),
        type_key: z.string(),
        property_key: z.string(),
        display_name: z.string().optional(),
        required: z.boolean().optional(),
        default_value: z.string().nullable().optional(),
        description: z.string().optional(),
      },
    },
    wrap("update_property", async (args: {
      type_kind: string;
      type_key: string;
      property_key: string;
      display_name?: string | undefined;
      required?: boolean | undefined;
      default_value?: string | null | undefined;
      description?: string | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const [ownerId, typeKind] = await resolveOwner(store, args.type_kind, args.type_key);
      const prop = await resolveProperty(store, ownerId, typeKind, args.property_key);
      // Sparse update: an omitted argument is `undefined` and stays
      // unchanged; only an explicit null default_value clears the default.
      const body = PropertyDefinitionUpdate.parse({
        displayName: args.display_name,
        description: args.description,
        required: args.required,
        defaultValue: args.default_value,
      });
      const result = await service.updateProperty(
        ownerId,
        typeKind,
        prop.propertyId as string,
        body,
        store,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_property",
    {
      description:
        "Remove a property definition from an entity type or relation type. " +
        "type_kind must be 'entity_type' or 'relation_type'. " +
        "Use cascade=True to auto-remove from scoped lens property lists and from the " +
        "custom search indices that read it (required when an index reads it). " +
        "An entity type's name property cannot be removed; reassign it first. Nor can a " +
        "property in the type's identity; change the identity first.",
      inputSchema: {
        type_kind: z.string(),
        type_key: z.string(),
        property_key: z.string(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("delete_property", async (args: {
      type_kind: string;
      type_key: string;
      property_key: string;
      cascade?: boolean | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const [ownerId, typeKind] = await resolveOwner(store, args.type_kind, args.type_key);
      const prop = await resolveProperty(store, ownerId, typeKind, args.property_key);
      await service.deleteProperty(
        ownerId,
        typeKind,
        prop.propertyId as string,
        args.cascade ?? false,
        store,
      );
      return textResult(
        `Property '${args.property_key}' deleted from ${args.type_kind} '${args.type_key}'.`,
      );
    }),
  );

  server.registerTool(
    "export_schema",
    {
      description:
        `Export the full schema in the OntoForge v${TRANSFER_FORMAT_VERSION} transfer format ` +
        "(JSON), including the keyword language set, the search indices and each lens's " +
        "assistants (agents, retrievers and navigators) and saved queries.",
      inputSchema: {},
    },
    wrap("export_schema", async () => {
      const result = await service.getSchemaExport(await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "import_schema",
    {
      description:
        `Import a v${TRANSFER_FORMAT_VERSION} schema payload (also accepted, upgraded on the way in: ` +
        IMPORTABLE_FORMAT_VERSIONS.filter((v) => v !== TRANSFER_FORMAT_VERSION).map((v) => `v${v}`).join(", ") +
        "). Creates entity types, relation types, and lenses with scope configuration, " +
        "assistants and saved queries. Answers with the created lenses and leftOutSavedQueries: " +
        "the saved queries ({lens, key}) of an older payload the upgrade could not convert.",
      inputSchema: {
        payload: z.record(z.string(), z.unknown()),
      },
    },
    wrap("import_schema", async (args: { payload: Record<string, unknown> }) => {
      const result = await service.importSchema(args.payload, await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_search_settings",
    {
      description:
        "Get the search settings: the keyword language set keyword search stems in " +
        "(german, english or both) and the managed search indices switched off.",
      inputSchema: {},
    },
    wrap("get_search_settings", async () => {
      const result = await service.getSearchSettings(await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "set_search_settings",
    {
      description:
        "Change the search settings; an omitted argument stays as it is. " +
        "keyword_languages: a non-empty set of 'german' and/or 'english' — changing it " +
        "rebuilds every index's keyword entries in the background. disabled_indices: " +
        "exactly the managed index keys (e.g. 'person~default') to switch off; every other " +
        "managed index is on.",
      inputSchema: {
        keyword_languages: z.array(z.string()).optional(),
        disabled_indices: z.array(z.string()).optional(),
      },
    },
    wrap("set_search_settings", async (args: {
      keyword_languages?: string[] | undefined;
      disabled_indices?: string[] | undefined;
    }) => {
      const body = SearchSettingsUpdate.parse({
        keywordLanguages: args.keyword_languages,
        disabledIndices: args.disabled_indices,
      });
      const result = await service.updateSearchSettings(body, await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  // --- Search indices ---
  // A definition travels in the index wire format (camelCase, as in REST
  // and the transfer format), like `import_schema`'s payload; its input
  // schema is MCP's own (`searchIndexDefinition.ts`). The status fields are
  // stated in every tool that returns them.

  server.registerTool(
    "list_search_indices",
    {
      description:
        "List the ontology's search indices — managed (default and passage, keys with '~', " +
        "switched in search settings) and custom. " + SEARCH_INDEX_RECORD,
      inputSchema: {},
    },
    wrap("list_search_indices", async () => {
      const result = await searchIndices.listSearchIndices(await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_search_index",
    {
      description:
        "Get one search index. " + SEARCH_INDEX_RECORD,
      inputSchema: { index_key: z.string() },
    },
    wrap("get_search_index", async (args: { index_key: string }) => {
      const result = await searchIndices.getSearchIndex(
        args.index_key,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "preview_search_index",
    {
      description:
        "Validate a draft search index definition without saving it and estimate the cost of " +
        "building it (entities, entries, seconds per representation), and outline the entries " +
        "it holds per entity — their semantic and keyword text with ⟦root.x⟧, ⟦relation.x⟧, " +
        "⟦target.x⟧ and ⟦passage⟧ standing in for the values (outline notation only, not " +
        "template syntax). definition: as the input schema describes it; the key may be " +
        "omitted. Returns {valid, issues, estimate, outline}.",
      inputSchema: { definition: definitionParameter("draft") },
    },
    wrap("preview_search_index", async (args: { definition: Record<string, unknown> }) => {
      const result = await searchIndices.previewSearchIndex(
        args.definition,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "create_search_index",
    {
      description:
        "Create a custom search index from definition, as the input schema describes it. " +
        "An invalid definition is refused with every issue at once. Building starts in the " +
        "background.",
      inputSchema: { definition: definitionParameter("create") },
    },
    wrap("create_search_index", async (args: { definition: Record<string, unknown> }) => {
      const result = await searchIndices.createSearchIndex(
        args.definition,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_search_index",
    {
      description:
        "Replace a custom search index's whole definition, as the input schema describes it; " +
        "the key cannot change, so definition.key may be omitted or must equal index_key. " +
        "An invalid definition is refused with every issue at once. A changed definition is " +
        "rebuilt in the background; the current entries serve until then. Managed indices can " +
        "only be switched (set_search_settings).",
      inputSchema: { index_key: z.string(), definition: definitionParameter("draft") },
    },
    wrap("update_search_index", async (args: {
      index_key: string;
      definition: Record<string, unknown>;
    }) => {
      const result = await searchIndices.updateSearchIndex(
        args.index_key,
        args.definition,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_search_index",
    {
      description:
        "Delete a custom search index with its entries. Use cascade=True to also remove it " +
        "from the scoped lenses that include it.",
      inputSchema: { index_key: z.string(), cascade: z.boolean().optional() },
    },
    wrap("delete_search_index", async (args: { index_key: string; cascade?: boolean | undefined }) => {
      await searchIndices.deleteSearchIndex(
        args.index_key,
        args.cascade ?? false,
        await getModelingStore(ontologyKey),
      );
      return textResult(`Search index '${args.index_key}' deleted.`);
    }),
  );

  server.registerTool(
    "get_search_index_status",
    {
      description:
        "Get a search index's build status. " + SEARCH_INDEX_STATUS,
      inputSchema: { index_key: z.string() },
    },
    wrap("get_search_index_status", async (args: { index_key: string }) => {
      const result = await searchIndices.getSearchIndexStatusBody(
        args.index_key,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "rebuild_search_index",
    {
      description:
        "Rebuild a search index from scratch in the background (retries failed items) and " +
        "return its status.",
      inputSchema: { index_key: z.string() },
    },
    wrap("rebuild_search_index", async (args: { index_key: string }) => {
      const result = await searchIndices.rebuildSearchIndex(
        args.index_key,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "validate_schema",
    {
      description: "Check the whole schema + all scoped lenses for consistency.",
      inputSchema: {},
    },
    wrap("validate_schema", async () => {
      const result = await service.validateAll(await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  // --- Lens Management ---

  server.registerTool(
    "create_lens",
    {
      description: "Create a new lens (named view over the schema).",
      inputSchema: {
        key: z.string(),
        name: z.string(),
        description: z.string().optional(),
      },
    },
    wrap("create_lens", async (args: {
      key: string;
      name: string;
      description?: string | undefined;
    }) => {
      const body = LensCreate.parse({
        key: args.key,
        name: args.name,
        description: args.description ?? null,
      });
      const result = await service.createLens(body, await getModelingStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_lens",
    {
      description: "Update a lens's display name or description.",
      inputSchema: {
        lens_key: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
    },
    wrap("update_lens", async (args: {
      lens_key: string;
      name?: string | undefined;
      description?: string | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const body = LensUpdate.parse({
        name: args.name ?? null,
        description: args.description ?? null,
      });
      const result = await service.updateLens(lens.lensId as string, body, store);
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_lens",
    {
      description:
        "Delete a lens, with its agents, saved queries and changesets (changes staged and not yet committed). " +
        "Does not affect the schema, the instance data or other lenses. The result states how many changesets were deleted.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("delete_lens", async (args: { lens_key: string }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const { changesetsDeleted } = await service.deleteLens(
        lens.lensId as string,
        store,
        await getRuntimeStore(ontologyKey),
        actor,
      );
      return textResult(
        `Lens '${args.lens_key}' deleted successfully. Changesets deleted with it: ${changesetsDeleted}.`,
      );
    }),
  );

  // There is deliberately no update-inclusion tool: adding an inclusion
  // again with a different allowlist is how an allowlist is changed over
  // MCP, which works because adding is an upsert.

  server.registerTool(
    "add_entity_type_to_lens",
    {
      description:
        "Add an entity type to a lens's scope. Properties=null means all " +
        "properties. Properties=[...] means only listed properties are exposed.",
      inputSchema: {
        lens_key: z.string(),
        entity_type_key: z.string(),
        properties: z.array(z.string()).optional(),
      },
    },
    wrap("add_entity_type_to_lens", async (args: {
      lens_key: string;
      entity_type_key: string;
      properties?: string[] | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const body = IncludeTypeRequest.parse({
        key: args.entity_type_key,
        properties: args.properties ?? null,
      });
      const result = await service.addIncludesEntityType(
        lens.lensId as string,
        body,
        store,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "remove_entity_type_from_lens",
    {
      description: "Remove an entity type from a lens's scope.",
      inputSchema: {
        lens_key: z.string(),
        entity_type_key: z.string(),
      },
    },
    wrap("remove_entity_type_from_lens", async (args: {
      lens_key: string;
      entity_type_key: string;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const et = await resolveEntityType(store, args.entity_type_key);
      await service.removeIncludesEntityType(
        lens.lensId as string,
        et.entityTypeId as string,
        store,
      );
      return textResult(
        `Entity type '${args.entity_type_key}' removed from lens '${args.lens_key}'.`,
      );
    }),
  );

  server.registerTool(
    "add_relation_type_to_lens",
    {
      description:
        "Add a relation type to a lens's scope. Properties=null means all " +
        "properties. Properties=[...] means only listed properties are exposed.",
      inputSchema: {
        lens_key: z.string(),
        relation_type_key: z.string(),
        properties: z.array(z.string()).optional(),
      },
    },
    wrap("add_relation_type_to_lens", async (args: {
      lens_key: string;
      relation_type_key: string;
      properties?: string[] | undefined;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const body = IncludeTypeRequest.parse({
        key: args.relation_type_key,
        properties: args.properties ?? null,
      });
      const result = await service.addIncludesRelationType(
        lens.lensId as string,
        body,
        store,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "remove_relation_type_from_lens",
    {
      description: "Remove a relation type from a lens's scope.",
      inputSchema: {
        lens_key: z.string(),
        relation_type_key: z.string(),
      },
    },
    wrap("remove_relation_type_from_lens", async (args: {
      lens_key: string;
      relation_type_key: string;
    }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const rt = await resolveRelationType(store, args.relation_type_key);
      await service.removeIncludesRelationType(
        lens.lensId as string,
        rt.relationTypeId as string,
        store,
      );
      return textResult(
        `Relation type '${args.relation_type_key}' removed from lens '${args.lens_key}'.`,
      );
    }),
  );

  server.registerTool(
    "add_search_index_to_lens",
    {
      description:
        "Include a search index in a lens, by index key. A scoped lens must include the " +
        "index's root entity type. Index inclusions never make a lens scoped; an unscoped " +
        "lens searches every index. get_schema lists each lens's index inclusions.",
      inputSchema: {
        lens_key: z.string(),
        index_key: z.string(),
      },
    },
    wrap("add_search_index_to_lens", async (args: { lens_key: string; index_key: string }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const result = await searchIndices.includeIndexInLens(
        lens.lensId as string,
        { key: args.index_key },
        store,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "remove_search_index_from_lens",
    {
      description: "Remove a search index from a lens, by index key.",
      inputSchema: {
        lens_key: z.string(),
        index_key: z.string(),
      },
    },
    wrap("remove_search_index_from_lens", async (args: { lens_key: string; index_key: string }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      await searchIndices.excludeIndexFromLens(lens.lensId as string, args.index_key, store);
      return textResult(`Search index '${args.index_key}' removed from lens '${args.lens_key}'.`);
    }),
  );

  server.registerTool(
    "validate_lens",
    {
      description:
        "Validate a single lens's INCLUDES_TYPE configuration against the schema. " +
        "Warnings name what limits the search indices it includes: a root type it does not " +
        "include, properties an index reads that it hides.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("validate_lens", async (args: { lens_key: string }) => {
      const store = await getModelingStore(ontologyKey);
      const lens = await resolveLensByKey(store, args.lens_key);
      const result = await service.validateLens(lens.lensId as string, store);
      return jsonResult(result);
    }),
  );

  // --- Assistants: the base set per kind (agents, retrievers) ---
  // Copy, move, export and import of a retriever stay REST-only.

  server.registerTool(
    "list_agents",
    {
      description: "List a lens's agents (tool-using chat assistants).",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("list_agents", async (args: { lens_key: string }) => {
      const results = await service.listAgents(args.lens_key, await getModelingStore(ontologyKey));
      return jsonResult(results);
    }),
  );

  server.registerTool(
    "get_agent",
    {
      description: "Read one agent of a lens by key.",
      inputSchema: {
        lens_key: z.string(),
        agent_key: z.string(),
      },
    },
    wrap("get_agent", async (args: { lens_key: string; agent_key: string }) => {
      const result = await service.getAgent(
        args.lens_key,
        args.agent_key,
        await getModelingStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "set_agent",
    {
      description:
        "Create or replace an agent of a lens. " +
        `Key must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} and be at most ${MAX_KEY_LENGTH} characters. ` +
        `Tools must be valid tool names (${VALID_AGENT_TOOLS_CSV}). ` +
        "Omit tools to allow all tools.",
      inputSchema: {
        lens_key: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string().optional(),
        system_prompt: z.string().optional(),
        tools: z.array(z.string()).optional(),
      },
    },
    wrap("set_agent", async (args: {
      lens_key: string;
      key: string;
      name: string;
      description?: string | undefined;
      system_prompt?: string | undefined;
      tools?: string[] | undefined;
    }) => {
      const body = AgentConfigUpsert.parse({
        name: args.name,
        description: args.description ?? null,
        systemPrompt: args.system_prompt ?? null,
        tools: args.tools ?? null,
      });
      const [result, created] = await service.upsertAgent(
        args.lens_key,
        args.key,
        body,
        await getModelingStore(ontologyKey),
      );
      return jsonResult({ ...result, created });
    }),
  );

  server.registerTool(
    "delete_agent",
    {
      description: "Delete an agent from a lens.",
      inputSchema: {
        lens_key: z.string(),
        agent_key: z.string(),
      },
    },
    wrap("delete_agent", async (args: { lens_key: string; agent_key: string }) => {
      await service.deleteAgent(args.lens_key, args.agent_key, await getModelingStore(ontologyKey));
      return textResult(`Agent '${args.agent_key}' deleted from lens '${args.lens_key}'.`);
    }),
  );

  // Retrievers search search indices.

  server.registerTool(
    "list_retrievers",
    {
      description:
        "List a lens's retrievers (assistants that answer questions over search indices), " +
        "each with its configuration and its current validation against the lens.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("list_retrievers", async (args: { lens_key: string }) => {
      const results = await retrievers.listRetrievers(
        args.lens_key,
        await getModelingStore(ontologyKey),
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(results);
    }),
  );

  server.registerTool(
    "get_retriever",
    {
      description:
        "Read one retriever of a lens by key, with its configuration and its current " +
        "validation against the lens ({valid, errors, warnings}).",
      inputSchema: {
        lens_key: z.string(),
        retriever_key: z.string(),
      },
    },
    wrap("get_retriever", async (args: { lens_key: string; retriever_key: string }) => {
      const result = await retrievers.getRetriever(
        args.lens_key,
        args.retriever_key,
        await getModelingStore(ontologyKey),
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "set_retriever",
    {
      description:
        "Create or replace a retriever of a lens: an assistant that answers questions over the " +
        "lens's search indices. " +
        `Key must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} and be at most ${MAX_KEY_LENGTH} characters. ` +
        `config is a configuration version ${RETRIEVER_CONFIG_VERSION} object (camelCase): ` +
        `indices — 1 to ${MAX_RETRIEVER_INDICES} search indices it searches, each once, as {index, relations?}: ` +
        "index is a key from list_search_indices (managed '<entityType>~default' or " +
        "'<entityType>~<documentProperty>', or custom) that the lens can search — a scoped lens " +
        "must include it and expose its root entity type; a switched-off managed index is not " +
        "searchable. relations optionally narrows to relation types of the index's relation " +
        "groups (omit for every group the lens shows). The root entity types of the chosen " +
        "indices are the result types: the retriever finds entities of those types only. " +
        `filters (optional, default []) — up to ${MAX_RETRIEVER_FILTERS} exact conditions a question may set, ` +
        "as {id, entityType, path, field}: id unique in the retriever, entityType a result type, " +
        `path 0 to ${MAX_FILTER_HOPS} hops [{relationTypeKey, direction: 'outgoing'|'incoming'}] from it ` +
        "through relation types the lens shows, field a property visible on the entity type the " +
        "path reaches. answerFields — {<resultType>: [property keys]}: for every result type, " +
        `and no other type, 1 to ${MAX_ANSWER_FIELDS} properties visible on it that the answer model ` +
        "receives. threshold (optional) — the cosine similarity a semantic match must reach, " +
        `-1 to 1, default ${DEFAULT_THRESHOLD}. answerFieldCharacters (optional) — characters of one ` +
        `answer field passed to the answer model, 100 to 2000, default ${DEFAULT_ANSWER_FIELD_CHARACTERS}. ` +
        "Example: {indices: [{index: 'person~default'}], filters: [{id: 'city', entityType: " +
        "'person', path: [{relationTypeKey: 'lives_in', direction: 'outgoing'}], field: 'name'}], " +
        "answerFields: {person: ['name', 'email']}}. The configuration is checked against the " +
        "lens; an invalid one is refused with every error at once and nothing is saved.",
      inputSchema: {
        lens_key: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string().optional(),
        config: z.record(z.string(), z.unknown()),
      },
    },
    wrap("set_retriever", async (args: {
      lens_key: string;
      key: string;
      name: string;
      description?: string | undefined;
      config: Record<string, unknown>;
    }) => {
      const [result, created] = await retrievers.saveRetriever(
        args.lens_key,
        args.key,
        {
          name: args.name,
          description: args.description ?? null,
          configVersion: RETRIEVER_CONFIG_VERSION,
          config: args.config,
        },
        await getModelingStore(ontologyKey),
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult({ ...result, created });
    }),
  );

  server.registerTool(
    "delete_retriever",
    {
      description: "Delete a retriever from a lens.",
      inputSchema: {
        lens_key: z.string(),
        retriever_key: z.string(),
      },
    },
    wrap("delete_retriever", async (args: { lens_key: string; retriever_key: string }) => {
      await retrievers.deleteRetriever(
        args.lens_key,
        args.retriever_key,
        await getModelingStore(ontologyKey),
      );
      return textResult(`Retriever '${args.retriever_key}' deleted from lens '${args.lens_key}'.`);
    }),
  );

  // --- Saved Query Config Tools ---

  server.registerTool(
    "list_saved_queries",
    {
      description: "List all saved queries for a lens.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("list_saved_queries", async (args: { lens_key: string }) => {
      const results = await service.listSavedQueries(args.lens_key, await getModelingStore(ontologyKey));
      return jsonResult(results);
    }),
  );

  server.registerTool(
    "set_saved_query",
    {
      description:
        "Create or update a saved query pipeline for a lens. " +
        `Key must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} and be at most ${MAX_KEY_LENGTH} characters. ` +
        "Steps is an ordered array of pipeline steps. Each step requires a unique 'name' and a 'type'. " +
        "Step types: " +
        "'oql' — needs 'oql' field with a read-only OQL query (OQL-style " +
        "pattern syntax over entity/relation type keys) using $param placeholders. " +
        "'search' — an entity search: needs 'query', the search text (use $param_name to reference a " +
        "declared parameter; only here). Optional: 'types' (entity type keys) or 'indices' (search index " +
        "keys), not both — neither searches every type of the lens; 'keyword' {match:'any'|'all'} and/or " +
        "'semantic' {minSimilarity: 0..1} choose the methods — neither runs what the server can; 'filter' " +
        "{key: value}, all must hold: key is a property or '<relation>.<property>', with an optional suffix " +
        "__ne/__gt/__gte/__lt/__lte, or __exists/__missing (true/false), e.g. {year__gte:'2020'}; a type lacking a key is " +
        "left out; 'limit' (1-100, default 10). Checked against the lens on save. A final search step returns {ran, items, " +
        "limitations}; later steps can bind only '_id', '_entityTypeKey' and 'name' of its entities. " +
        "Data flow: steps can have 'bindings' dict mapping param names to '{{prevStepName.fieldName}}' " +
        "which collects that field from all rows of a previous step's output into a list. " +
        "Parameters define top-level $param placeholders. " +
        "Each parameter needs: name, description, dataType (string/integer/float/boolean/date/datetime). " +
        "Example: steps=[{name:'skills', type:'search', types:['skill'], query:'$q', limit:5}, " +
        "{name:'results', type:'oql', oql:'MATCH (p:person)-[:has_skill]->(s:skill) " +
        "WHERE s._id IN $ids RETURN p', bindings:{ids:'{{skills._id}}'}}], parameters=[{name:'q', ...}]",
      inputSchema: {
        lens_key: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string(),
        steps: z.array(z.record(z.string(), z.unknown())),
        parameters: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    wrap("set_saved_query", async (args: {
      lens_key: string;
      key: string;
      name: string;
      description: string;
      steps: Record<string, unknown>[];
      parameters?: Record<string, unknown>[] | undefined;
    }) => {
      const body = SavedQueryUpsert.parse({
        name: args.name,
        description: args.description,
        steps: args.steps,
        parameters: args.parameters ?? [],
      });
      const [result, created] = await service.upsertSavedQuery(
        args.lens_key,
        args.key,
        body,
        await getModelingStore(ontologyKey),
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult({ ...result, created });
    }),
  );

  server.registerTool(
    "delete_saved_query",
    {
      description: "Delete a saved query from a lens.",
      inputSchema: {
        lens_key: z.string(),
        query_key: z.string(),
      },
    },
    wrap("delete_saved_query", async (args: { lens_key: string; query_key: string }) => {
      await service.deleteSavedQuery(args.lens_key, args.query_key, await getModelingStore(ontologyKey));
      return textResult(
        `Saved query '${args.query_key}' deleted from lens '${args.lens_key}'.`,
      );
    }),
  );

  return server;
}
