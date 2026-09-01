/**
 * Runtime MCP server: instance data of one ontology through exactly one
 * lens.
 *
 * Both bindings come from the mount URL alone
 * (`/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey`, `mount.ts`)
 * and are fixed into the server factory, so a tool can never name an
 * ontology or a lens, and can never reach across two
 * (`docs/decisions.md#interfaces`).
 *
 * Tools call the runtime services directly, take snake_case parameters,
 * and CLAMP `limit`/`offset` into range where REST rejects out-of-range
 * values — a documented divergence-by-design between the two entrances.
 * Failures are reported as tool errors with per-field detail flattened
 * into the message text (shared `formatToolError`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { valueToText } from "../core/dataTypes.js";
import { getRuntimeStore } from "../core/ports.js";
import * as service from "../runtime/service.js";
import { formatToolError } from "./modeling.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Build the runtime MCP server bound to one ontology and one lens. */
export function createRuntimeMcpServer(ontologyKey: string, lensKey: string): McpServer {
  const server = new McpServer({ name: "OntoForge Runtime", version: "0.1.0" });

  server.registerTool(
    "get_schema",
    {
      description:
        "Understand the lens before creating data. Shows available entity types, " +
        "relation types, and their property definitions including data types and " +
        "required flags. Call this first.",
      inputSchema: {},
    },
    wrap("get_schema", async () => {
      const result = await service.getFullSchema(lensKey, await getRuntimeStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "create_entity",
    {
      description:
        "Create a new entity instance. Properties must conform to the schema — " +
        "required properties must be present, types must match the property " +
        "definitions.",
      inputSchema: {
        entity_type_key: z.string(),
        properties: z.record(z.string(), z.unknown()),
      },
    },
    wrap("create_entity", async (args: {
      entity_type_key: string;
      properties: Record<string, unknown>;
    }) => {
      const result = await service.createEntity(
        lensKey,
        args.entity_type_key,
        args.properties,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "list_entities",
    {
      description:
        "List entities of a type with optional filtering, search, sorting, and " +
        "pagination. Use 'search' for substring matching across all string properties. " +
        "Use 'filters' for property-based filtering with operators: exact match " +
        '("name": "Alice"), greater than ("age__gt": "25"), greater or equal ("__gte"), ' +
        'less than ("__lt"), less or equal ("__lte"), contains ' +
        "(\"name__contains\": \"ali\"). A filter key may be a query path crossing one " +
        "relation type to a property of the related entity, " +
        "\"<relationTypeKey>.<propertyKey>\", or to a property stored on the relation " +
        "itself, \"<relationTypeKey>@<propertyKey>\": listing persons with " +
        '("works_for.name": "Acme") returns the persons employed by Acme, and with ' +
        '("works_for@role": "CTO") the persons holding a CTO employment; the direction ' +
        "follows the relation type's endpoints, or a \":out\"/\":in\" marker on the relation " +
        'segment, required where source and target are the same type ("manages:out.name": ' +
        '"Bob" for the persons managing a Bob); an entity matches when at least one ' +
        "relation of the type satisfies the condition. Use 'fields' to select which properties " +
        "to include — only listed fields plus _id are returned. Omit for all fields.",
      inputSchema: {
        entity_type_key: z.string(),
        search: z.string().optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        sort: z.string().optional(),
        // A closed enum, matching REST: the direction is never caller text.
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        fields: z.array(z.string()).optional(),
      },
    },
    wrap("list_entities", async (args: {
      entity_type_key: string;
      search?: string | undefined;
      filters?: Record<string, unknown> | undefined;
      sort?: string | undefined;
      order?: "asc" | "desc" | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      fields?: string[] | undefined;
    }) => {
      const strFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.filters ?? {})) {
        // Filter values travel as strings, in the same spelling the write
        // path stores them in.
        strFilters[k] = valueToText(v);
      }
      const limit = clamp(args.limit ?? 50, 1, 200);
      const offset = Math.max(0, args.offset ?? 0);
      const result = await service.listEntities(
        lensKey,
        args.entity_type_key,
        limit,
        offset,
        args.sort ?? "_createdAt",
        args.order ?? "asc",
        args.search ?? null,
        strFilters,
        await getRuntimeStore(ontologyKey),
        args.fields ?? null,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Retrieve a specific entity by its _id. Use 'fields' to select which " +
        "properties to include — only listed fields plus _id are returned. " +
        "Omit for all fields. Document properties appear as " +
        '{"document": true, "length": N} stubs — read their content with the ' +
        "get_document tool.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        fields: z.array(z.string()).optional(),
      },
    },
    wrap("get_entity", async (args: {
      entity_type_key: string;
      entity_id: string;
      fields?: string[] | undefined;
    }) => {
      const result = await service.getEntity(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        await getRuntimeStore(ontologyKey),
        args.fields ?? null,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_document",
    {
      description:
        "Read (a slice of) a document property's content. Document properties " +
        "hold large Markdown text and are never returned inline by other tools " +
        '— they appear as {"document": true, "length": N} stubs. ' +
        "'offset' and 'limit' are character-based; omit both to read the full " +
        "document. Use the charOffset/charLength from a semantic search hit's " +
        "matchedVia to read exactly the matching passage.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        property_key: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    wrap("get_document", async (args: {
      entity_type_key: string;
      entity_id: string;
      property_key: string;
      offset?: number | undefined;
      limit?: number | undefined;
    }) => {
      const offset = Math.max(0, args.offset ?? 0);
      const limit = args.limit === undefined || args.limit === null ? null : Math.max(1, args.limit);
      const result = await service.getDocument(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        args.property_key,
        offset,
        limit,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_entity",
    {
      description:
        "Partial update — only provided properties change. Set a property to null " +
        "to remove it (fails for required properties). Document properties are " +
        "replaced whole here — prefer edit_document / write_document for " +
        "partial edits inside a document.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        properties: z.record(z.string(), z.unknown()),
      },
    },
    wrap("update_entity", async (args: {
      entity_type_key: string;
      entity_id: string;
      properties: Record<string, unknown>;
    }) => {
      const result = await service.updateEntity(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        args.properties,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "edit_document",
    {
      description:
        "Edit a document property by exact string replacement — the preferred " +
        "way to change part of a document. old_string must match the current " +
        "content exactly and uniquely; if it matches more than once, provide a " +
        "longer string with surrounding context, or set replace_all to true to " +
        "replace every occurrence. Returns the new totalLength, the edited " +
        "range, and ~200 chars of context around the edit for verification.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        property_key: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      },
    },
    wrap("edit_document", async (args: {
      entity_type_key: string;
      entity_id: string;
      property_key: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean | undefined;
    }) => {
      const result = await service.editDocument(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        args.property_key,
        {
          op: "str_replace",
          oldString: args.old_string,
          newString: args.new_string,
          replaceAll: args.replace_all ?? false,
        },
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "write_document",
    {
      description:
        "Overwrite a character range of a document property: replaces " +
        "[offset, offset+length) with content. Insert with length=0; append " +
        "with offset=totalLength and length=0. Offsets pair with get_document " +
        "reads and the charOffset/charLength of semantic search hits. Pass " +
        "'expect' (the text currently in the range) to fail safely if the " +
        "document changed since it was read. Returns the new totalLength, the " +
        "edited range, and ~200 chars of context around the edit.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        property_key: z.string(),
        offset: z.number(),
        length: z.number(),
        content: z.string(),
        expect: z.string().optional(),
      },
    },
    wrap("write_document", async (args: {
      entity_type_key: string;
      entity_id: string;
      property_key: string;
      offset: number;
      length: number;
      content: string;
      expect?: string | undefined;
    }) => {
      const result = await service.editDocument(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        args.property_key,
        {
          op: "replace_range",
          offset: args.offset,
          length: args.length,
          content: args.content,
          expect: args.expect ?? null,
        },
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_entity",
    {
      description: "Delete an entity and all its connected relations.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
      },
    },
    wrap("delete_entity", async (args: { entity_type_key: string; entity_id: string }) => {
      await service.deleteEntity(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        await getRuntimeStore(ontologyKey),
      );
      // This tool returns a message OBJECT, unlike the modeling delete
      // tools, which return bare strings. Wire contract — do not unify.
      return jsonResult({ message: `Entity '${args.entity_id}' deleted successfully.` });
    }),
  );

  server.registerTool(
    "create_relation",
    {
      description:
        "Create a relation between two entities. The entity types must match the " +
        "relation type's source/target definition.",
      inputSchema: {
        relation_type_key: z.string(),
        from_entity_id: z.string(),
        to_entity_id: z.string(),
        properties: z.record(z.string(), z.unknown()).optional(),
      },
    },
    wrap("create_relation", async (args: {
      relation_type_key: string;
      from_entity_id: string;
      to_entity_id: string;
      properties?: Record<string, unknown> | undefined;
    }) => {
      const result = await service.createRelation(
        lensKey,
        args.relation_type_key,
        args.from_entity_id,
        args.to_entity_id,
        args.properties ?? {},
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "list_relations",
    {
      description:
        "List relations of a type. Optionally filter by source or target entity.",
      inputSchema: {
        relation_type_key: z.string(),
        from_entity_id: z.string().optional(),
        to_entity_id: z.string().optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        sort: z.string().optional(),
        // A closed enum, matching REST: the direction is never caller text.
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    wrap("list_relations", async (args: {
      relation_type_key: string;
      from_entity_id?: string | undefined;
      to_entity_id?: string | undefined;
      filters?: Record<string, unknown> | undefined;
      sort?: string | undefined;
      order?: "asc" | "desc" | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    }) => {
      const strFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.filters ?? {})) {
        // Filter values travel as strings, in the same spelling the write
        // path stores them in.
        strFilters[k] = valueToText(v);
      }
      const limit = clamp(args.limit ?? 50, 1, 200);
      const offset = Math.max(0, args.offset ?? 0);
      const result = await service.listRelations(
        lensKey,
        args.relation_type_key,
        limit,
        offset,
        args.sort ?? "_createdAt",
        args.order ?? "asc",
        args.from_entity_id ?? null,
        args.to_entity_id ?? null,
        strFilters,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_relation",
    {
      description: "Retrieve a specific relation by its _id.",
      inputSchema: {
        relation_type_key: z.string(),
        relation_id: z.string(),
      },
    },
    wrap("get_relation", async (args: { relation_type_key: string; relation_id: string }) => {
      const result = await service.getRelation(
        lensKey,
        args.relation_type_key,
        args.relation_id,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_relation",
    {
      description:
        "Partial update of relation properties. Cannot change connected entities — " +
        "delete and recreate instead.",
      inputSchema: {
        relation_type_key: z.string(),
        relation_id: z.string(),
        properties: z.record(z.string(), z.unknown()),
      },
    },
    wrap("update_relation", async (args: {
      relation_type_key: string;
      relation_id: string;
      properties: Record<string, unknown>;
    }) => {
      const result = await service.updateRelation(
        lensKey,
        args.relation_type_key,
        args.relation_id,
        args.properties,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "delete_relation",
    {
      description: "Delete a relation. Connected entities are unaffected.",
      inputSchema: {
        relation_type_key: z.string(),
        relation_id: z.string(),
      },
    },
    wrap("delete_relation", async (args: { relation_type_key: string; relation_id: string }) => {
      await service.deleteRelation(
        lensKey,
        args.relation_type_key,
        args.relation_id,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult({ message: `Relation '${args.relation_id}' deleted successfully.` });
    }),
  );

  server.registerTool(
    "get_neighbors",
    {
      description:
        "Explore an entity's local neighborhood — discover what it's connected to " +
        "and how. Returns the center entity plus all connected entities with their " +
        "connecting relations. Use 'fields' to project entity properties (neighbor " +
        "entities always include _entityTypeKey). Use 'relation_fields' to project " +
        "relation properties.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        direction: z.string().optional(),
        relation_type_key: z.string().optional(),
        limit: z.number().optional(),
        fields: z.array(z.string()).optional(),
        relation_fields: z.array(z.string()).optional(),
      },
    },
    wrap("get_neighbors", async (args: {
      entity_type_key: string;
      entity_id: string;
      direction?: string | undefined;
      relation_type_key?: string | undefined;
      limit?: number | undefined;
      fields?: string[] | undefined;
      relation_fields?: string[] | undefined;
    }) => {
      const limit = clamp(args.limit ?? 50, 1, 200);
      const result = await service.getNeighbors(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        args.direction ?? "both",
        args.relation_type_key ?? null,
        limit,
        await getRuntimeStore(ontologyKey),
        args.fields ?? null,
        args.relation_fields ?? null,
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "execute_query",
    {
      description:
        "Execute a read-only OQL query (OQL-style graph pattern syntax) " +
        "against the lens's scoped schema. " +
        "Use schema entity type keys (snake_case) as node labels and relation type " +
        "keys as relationship types. Only MATCH/RETURN queries are allowed — no " +
        "writes, no CALL. " +
        "All node patterns must include a label. Available types and properties can " +
        "be discovered via the get_schema tool. System properties (_id, " +
        "_entityTypeKey, _relationTypeKey, _createdAt, _updatedAt) are always " +
        "available. " +
        "Example: MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, c LIMIT 10",
      inputSchema: {
        query: z.string(),
      },
    },
    wrap("execute_query", async (args: { query: string }) => {
      const result = await service.executeQuery(lensKey, args.query, await getRuntimeStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "semantic_search",
    {
      description:
        "Search entity instances by semantic similarity to a natural language query. " +
        "Returns entities ranked by relevance. " +
        "entity_type_key is optional — omit it to search across all entity types " +
        "at once (each result carries _entityTypeKey), or set it to search a " +
        "single type. 'search_in' selects the ranking: 'entities' (entity " +
        "embeddings), 'documents' (passage-level matches inside document " +
        "properties), or 'all' (default — both, fused via reciprocal rank " +
        "fusion). Every hit carries 'matchedVia': document hits include the " +
        "property key, charOffset/charLength (usable with get_document), a " +
        "~200-char snippet (disable with snippets=false), and the raw cosine " +
        "'similarity'; entity hits carry only source and similarity. " +
        "Use 'filters' for property-based filtering on results " +
        "(requires entity_type_key): exact match " +
        '("location": "Berlin"), operators ("age__gt": "25", "__gte", "__lt", ' +
        '"__lte"). Use \'fields\' to select which entity properties to include — ' +
        "only listed fields plus _id (and _entityTypeKey for cross-type search) " +
        "are returned. Omit for all fields.",
      inputSchema: {
        query: z.string(),
        entity_type_key: z.string().optional(),
        limit: z.number().optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        fields: z.array(z.string()).optional(),
        search_in: z.string().optional(),
        snippets: z.boolean().optional(),
      },
    },
    wrap("semantic_search", async (args: {
      query: string;
      entity_type_key?: string | undefined;
      limit?: number | undefined;
      filters?: Record<string, unknown> | undefined;
      fields?: string[] | undefined;
      search_in?: string | undefined;
      snippets?: boolean | undefined;
    }) => {
      // No min_score on the MCP tool — the documented difference
      // (`docs/capabilities/search.md#through-the-interfaces`): a model
      // that needs a threshold applies it to the reported similarity.
      const limit = clamp(args.limit ?? 10, 1, 100);
      const strFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.filters ?? {})) {
        // Filter values travel as strings, in the same spelling the write
        // path stores them in.
        strFilters[k] = valueToText(v);
      }
      const result = await service.semanticSearch(
        lensKey,
        args.query,
        args.entity_type_key ?? null,
        limit,
        null,
        await getRuntimeStore(ontologyKey),
        {
          filters: strFilters,
          fields: args.fields ?? null,
          searchIn: args.search_in ?? "all",
          snippets: args.snippets ?? true,
        },
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "list_saved_queries",
    {
      description:
        "Discover available pre-defined queries and their required parameters. " +
        "Each saved query has a key, name, description, and parameter definitions " +
        "with name, description, and dataType.",
      inputSchema: {},
    },
    wrap("list_saved_queries", async () => {
      const result = await service.listSavedQueries(lensKey, await getRuntimeStore(ontologyKey));
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "run_saved_query",
    {
      description:
        "Execute a saved query by name with parameter values. " +
        "Use list_saved_queries to discover available queries and their required " +
        "parameters first.",
      inputSchema: {
        query_key: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      },
    },
    wrap("run_saved_query", async (args: {
      query_key: string;
      params?: Record<string, unknown> | undefined;
    }) => {
      const result = await service.executeSavedQuery(
        lensKey,
        args.query_key,
        args.params ?? {},
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "search_saved_queries",
    {
      description:
        "Search saved queries by semantic similarity to a natural language " +
        "description. Returns the most relevant saved queries ranked by how well " +
        "their description matches. Use this to find the right saved query for a " +
        "user's intent.",
      inputSchema: {
        query: z.string(),
      },
    },
    wrap("search_saved_queries", async (args: { query: string }) => {
      const result = await service.searchSavedQueries(
        lensKey,
        args.query,
        3,
        0.7,
        await getRuntimeStore(ontologyKey),
      );
      return jsonResult(result);
    }),
  );

  return server;
}
