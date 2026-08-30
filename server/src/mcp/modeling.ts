/**
 * Modeling MCP server: one ontology's schema surface over MCP.
 *
 * No lens key anywhere — the schema belongs to no lens. Until ticket 17
 * moves the mount under `/mcp/ontologies/:key/model`, every tool binds
 * to the server's sole ontology (`getLegacyModelingStore`). Tools take
 * KEYS (never internal identifiers) plus a `type_kind` discriminator for
 * properties, and resolve keys to internal ids per call (never cached).
 * Tool parameters are snake_case on the wire (`docs/interfaces.md`,
 * "JSON shape").
 *
 * Tools call the modeling services directly — never HTTP to the REST
 * routes; a second path would be a second contract. Failures are reported
 * as tool errors; because a tool error is a single string, per-field
 * detail is flattened into the message text.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodError } from "zod";

import { NotFoundError, ValidationError } from "../core/exceptions.js";
import { getLegacyModelingStore, getLegacyRuntimeStore } from "../core/ports.js";
import type { ModelingStore } from "../core/ports.js";
import type { TypeKind } from "../core/schemas.js";
import {
  AiAgentConfigUpsert,
  EntityTypeCreate,
  EntityTypeUpdate,
  ExportPayload,
  IncludeTypeRequest,
  LensCreate,
  LensUpdate,
  PropertyDefinitionCreate,
  PropertyDefinitionUpdate,
  RelationTypeCreate,
  RelationTypeUpdate,
  SavedQueryUpsert,
  TRANSFER_FORMAT_VERSION,
} from "../modeling/schemas.js";
import * as service from "../modeling/service.js";
import { VALID_AGENT_TOOLS_CSV } from "../runtime/toolNames.js";

// ---------------------------------------------------------------------------
// Error flattening
// ---------------------------------------------------------------------------

/**
 * Flatten an error into one message string: `details.fields` and
 * `details.errors` are appended to the message so a model still sees every
 * offending field in one response. Zod issues (request-shape failures
 * inside a tool) are joined the same way.
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
      const errors = details.errors as unknown[];
      return `${message} — ${errors.map(String).join("; ")}`;
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

// ---------------------------------------------------------------------------
// Server factory (stateless transport: one server per request)
// ---------------------------------------------------------------------------

export function createModelingMcpServer(): McpServer {
  const server = new McpServer({ name: "OntoForge Modeling", version: "0.1.0" });

  server.registerTool(
    "get_schema",
    {
      description:
        "Get the current state of the ontology's schema. Returns all entity types, " +
        "relation types, and their properties.",
      inputSchema: {},
    },
    wrap("get_schema", async () => {
      const result = await service.getSchemaExport(await getLegacyModelingStore());
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "create_entity_type",
    {
      description:
        "Add a new entity type to the schema. Key must be snake_case, unique within the ontology.",
      inputSchema: {
        key: z.string(),
        display_name: z.string(),
        description: z.string().optional(),
      },
    },
    wrap("create_entity_type", async (args: {
      key: string;
      display_name: string;
      description?: string | undefined;
    }) => {
      const body = EntityTypeCreate.parse({
        key: args.key,
        displayName: args.display_name,
        description: args.description ?? null,
      });
      const result = await service.createEntityType(body, await getLegacyModelingStore());
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_entity_type",
    {
      description: "Update an entity type's display name or description. Key is immutable.",
      inputSchema: {
        entity_type_key: z.string(),
        display_name: z.string().optional(),
        description: z.string().optional(),
      },
    },
    wrap("update_entity_type", async (args: {
      entity_type_key: string;
      display_name?: string | undefined;
      description?: string | undefined;
    }) => {
      const store = await getLegacyModelingStore();
      const et = await resolveEntityType(store, args.entity_type_key);
      const body = EntityTypeUpdate.parse({
        displayName: args.display_name ?? null,
        description: args.description ?? null,
      });
      const result = await service.updateEntityType(et.entityTypeId as string, body, store);
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_entity_type",
    {
      description:
        "Remove an entity type and its properties. Use cascade=True to auto-remove " +
        "from any scoped lenses. Fails if any relation type references it.",
      inputSchema: {
        entity_type_key: z.string(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("delete_entity_type", async (args: {
      entity_type_key: string;
      cascade?: boolean | undefined;
    }) => {
      const store = await getLegacyModelingStore();
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
        "specified by entity type key.",
      inputSchema: {
        key: z.string(),
        display_name: z.string(),
        source_entity_type_key: z.string(),
        target_entity_type_key: z.string(),
        description: z.string().optional(),
      },
    },
    wrap("create_relation_type", async (args: {
      key: string;
      display_name: string;
      source_entity_type_key: string;
      target_entity_type_key: string;
      description?: string | undefined;
    }) => {
      const body = RelationTypeCreate.parse({
        key: args.key,
        displayName: args.display_name,
        description: args.description ?? null,
        sourceEntityTypeKey: args.source_entity_type_key,
        targetEntityTypeKey: args.target_entity_type_key,
      });
      const result = await service.createRelationType(body, await getLegacyModelingStore());
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_relation_type",
    {
      description:
        "Update a relation type's display name or description. Source/target " +
        "endpoints are immutable.",
      inputSchema: {
        relation_type_key: z.string(),
        display_name: z.string().optional(),
        description: z.string().optional(),
      },
    },
    wrap("update_relation_type", async (args: {
      relation_type_key: string;
      display_name?: string | undefined;
      description?: string | undefined;
    }) => {
      const store = await getLegacyModelingStore();
      const rt = await resolveRelationType(store, args.relation_type_key);
      const body = RelationTypeUpdate.parse({
        displayName: args.display_name ?? null,
        description: args.description ?? null,
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
        "from any scoped lenses.",
      inputSchema: {
        relation_type_key: z.string(),
        cascade: z.boolean().optional(),
      },
    },
    wrap("delete_relation_type", async (args: {
      relation_type_key: string;
      cascade?: boolean | undefined;
    }) => {
      const store = await getLegacyModelingStore();
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
        "as Markdown; it is chunked for passage-level semantic search when " +
        "embeddings are enabled and is returned as a stub (never inline) by " +
        "runtime reads. Document properties are only allowed on entity types " +
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
      const store = await getLegacyModelingStore();
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
        "type_kind must be 'entity_type' or 'relation_type'.",
      inputSchema: {
        type_kind: z.string(),
        type_key: z.string(),
        property_key: z.string(),
        display_name: z.string().optional(),
        required: z.boolean().optional(),
        default_value: z.string().optional(),
        description: z.string().optional(),
      },
    },
    wrap("update_property", async (args: {
      type_kind: string;
      type_key: string;
      property_key: string;
      display_name?: string | undefined;
      required?: boolean | undefined;
      default_value?: string | undefined;
      description?: string | undefined;
    }) => {
      const store = await getLegacyModelingStore();
      const [ownerId, typeKind] = await resolveOwner(store, args.type_kind, args.type_key);
      const prop = await resolveProperty(store, ownerId, typeKind, args.property_key);
      // Known wart: the tool argument shape cannot distinguish an omitted
      // default_value from an explicit null, so both clear the default.
      const body = PropertyDefinitionUpdate.parse({
        displayName: args.display_name ?? null,
        description: args.description ?? null,
        required: args.required ?? null,
        defaultValue: args.default_value ?? null,
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
        "Use cascade=True to auto-remove from scoped lens property lists.",
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
      const store = await getLegacyModelingStore();
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
      description: "Export the full schema in OntoForge v2.0 transfer format (JSON).",
      inputSchema: {},
    },
    wrap("export_schema", async () => {
      const result = await service.getSchemaExport(await getLegacyModelingStore());
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "import_schema",
    {
      description:
        `Import a v${TRANSFER_FORMAT_VERSION} schema payload. Creates entity types, relation types, ` +
        "and lenses with scope configuration.",
      inputSchema: {
        payload: z.record(z.string(), z.unknown()),
      },
    },
    wrap("import_schema", async (args: { payload: Record<string, unknown> }) => {
      const parsed = ExportPayload.parse(args.payload);
      const result = await service.importSchema(parsed, await getLegacyModelingStore());
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
      const result = await service.validateAll(await getLegacyModelingStore());
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
      const result = await service.createLens(body, await getLegacyModelingStore());
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
      const store = await getLegacyModelingStore();
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
      description: "Delete a lens. Does not affect the schema or other lenses.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("delete_lens", async (args: { lens_key: string }) => {
      const store = await getLegacyModelingStore();
      const lens = await resolveLensByKey(store, args.lens_key);
      await service.deleteLens(lens.lensId as string, store);
      return textResult(`Lens '${args.lens_key}' deleted successfully.`);
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
      const store = await getLegacyModelingStore();
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
      const store = await getLegacyModelingStore();
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
      const store = await getLegacyModelingStore();
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
      const store = await getLegacyModelingStore();
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
    "validate_lens",
    {
      description:
        "Validate a single lens's INCLUDES_TYPE configuration against the schema.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("validate_lens", async (args: { lens_key: string }) => {
      const store = await getLegacyModelingStore();
      const lens = await resolveLensByKey(store, args.lens_key);
      const result = await service.validateLens(lens.lensId as string, store);
      return jsonResult(result);
    }),
  );

  // --- AI Agent Config Tools ---

  server.registerTool(
    "list_ai_agents",
    {
      description: "List all AI agent configurations for a lens.",
      inputSchema: {
        lens_key: z.string(),
      },
    },
    wrap("list_ai_agents", async (args: { lens_key: string }) => {
      const results = await service.listAiAgents(args.lens_key, await getLegacyModelingStore());
      return jsonResult(results);
    }),
  );

  server.registerTool(
    "set_ai_agent",
    {
      description:
        "Create or update an AI agent configuration for a lens. " +
        "Key must match pattern ^[a-z][a-z0-9_-]*$, be at most 64 characters, and cannot be '_default'. " +
        `Tools must be valid tool names (${VALID_AGENT_TOOLS_CSV}). ` +
        "Set tools=null to allow all tools.",
      inputSchema: {
        lens_key: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string().optional(),
        system_prompt: z.string().optional(),
        tools: z.array(z.string()).optional(),
      },
    },
    wrap("set_ai_agent", async (args: {
      lens_key: string;
      key: string;
      name: string;
      description?: string | undefined;
      system_prompt?: string | undefined;
      tools?: string[] | undefined;
    }) => {
      const body = AiAgentConfigUpsert.parse({
        name: args.name,
        description: args.description ?? null,
        systemPrompt: args.system_prompt ?? null,
        tools: args.tools ?? null,
      });
      const [result, created] = await service.upsertAiAgent(
        args.lens_key,
        args.key,
        body,
        await getLegacyModelingStore(),
      );
      return jsonResult({ ...result, created });
    }),
  );

  server.registerTool(
    "delete_ai_agent",
    {
      description: "Delete an AI agent configuration from a lens.",
      inputSchema: {
        lens_key: z.string(),
        agent_key: z.string(),
      },
    },
    wrap("delete_ai_agent", async (args: { lens_key: string; agent_key: string }) => {
      await service.deleteAiAgent(args.lens_key, args.agent_key, await getLegacyModelingStore());
      return textResult(
        `AI agent '${args.agent_key}' deleted from lens '${args.lens_key}'.`,
      );
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
      const results = await service.listSavedQueries(args.lens_key, await getLegacyModelingStore());
      return jsonResult(results);
    }),
  );

  server.registerTool(
    "set_saved_query",
    {
      description:
        "Create or update a saved query pipeline for a lens. " +
        "Key must match pattern ^[a-z][a-z0-9_-]*$ and be at most 64 characters. " +
        "Steps is an ordered array of pipeline steps. Each step requires a unique 'name' and a 'type'. " +
        "Step types: " +
        "'oql' — needs 'oql' field with a read-only OQL query (OQL-style " +
        "pattern syntax over entity/relation type keys) using $param placeholders. " +
        "'semantic_search' — needs 'entityTypeKey' and 'query' (use $param_name to reference a declared parameter). " +
        "Optional: 'limit' (default 10), 'minScore'. " +
        "Data flow: steps can have 'bindings' dict mapping param names to '{{prevStepName.fieldName}}' " +
        "which collects that field from all rows of a previous step's output into a list. " +
        "Parameters define top-level $param placeholders. " +
        "Each parameter needs: name, description, dataType (string/integer/float/boolean/date/datetime). " +
        "Example: steps=[{name:'skills', type:'semantic_search', entityTypeKey:'skill', query:'$q', limit:5}, " +
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
        await getLegacyModelingStore(),
        await getLegacyRuntimeStore(),
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
      await service.deleteSavedQuery(args.lens_key, args.query_key, await getLegacyModelingStore());
      return textResult(
        `Saved query '${args.query_key}' deleted from lens '${args.lens_key}'.`,
      );
    }),
  );

  return server;
}
