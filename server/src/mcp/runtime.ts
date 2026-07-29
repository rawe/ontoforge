/**
 * Runtime MCP server: instance data through exactly one lens.
 *
 * The lens is resolved per request by the mount (`mount.ts`) — path
 * segment, then `X-Ontology-Key` header, then the configured fallback —
 * and bound into the server factory, so a tool can never name a lens or
 * reach across two (`docs/decisions.md#interfaces`).
 *
 * Tools call the runtime services directly, take snake_case parameters,
 * and CLAMP `limit`/`offset` into range where REST rejects out-of-range
 * values — a documented divergence-by-design between the two entrances.
 * Failures are reported as tool errors with per-field detail flattened
 * into the message text (shared `formatToolError`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

/** Build the runtime MCP server bound to one resolved ontology key. */
export function createRuntimeMcpServer(ontologyKey: string): McpServer {
  const server = new McpServer({ name: "OntoForge Runtime", version: "0.1.0" });

  server.registerTool(
    "get_schema",
    {
      description:
        "Understand the ontology before creating data. Shows available entity types, " +
        "relation types, and their property definitions including data types and " +
        "required flags. Call this first.",
      inputSchema: {},
    },
    wrap("get_schema", async () => {
      const result = await service.getFullSchema(ontologyKey, getRuntimeStore());
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
        ontologyKey,
        args.entity_type_key,
        args.properties,
        getRuntimeStore(),
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
        "(\"name__contains\": \"ali\"). Use 'fields' to select which properties to " +
        "include — only listed fields plus _id are returned. Omit for all fields.",
      inputSchema: {
        entity_type_key: z.string(),
        search: z.string().optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        sort: z.string().optional(),
        order: z.string().optional(),
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
      order?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      fields?: string[] | undefined;
    }) => {
      const strFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.filters ?? {})) {
        // Python `str(v)`: booleans capitalize, everything else stringifies.
        strFilters[k] = typeof v === "boolean" ? (v ? "True" : "False") : String(v);
      }
      const limit = clamp(args.limit ?? 50, 1, 200);
      const offset = Math.max(0, args.offset ?? 0);
      const result = await service.listEntities(
        ontologyKey,
        args.entity_type_key,
        limit,
        offset,
        args.sort ?? "_createdAt",
        args.order ?? "asc",
        args.search ?? null,
        strFilters,
        getRuntimeStore(),
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
        ontologyKey,
        args.entity_type_key,
        args.entity_id,
        getRuntimeStore(),
        args.fields ?? null,
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
        ontologyKey,
        args.entity_type_key,
        args.entity_id,
        args.properties,
        getRuntimeStore(),
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
        ontologyKey,
        args.entity_type_key,
        args.entity_id,
        getRuntimeStore(),
      );
      // The Python tool returns a message DICT here (unlike the modeling
      // delete tools, which return bare strings) — preserved for parity.
      return jsonResult({ message: `Entity '${args.entity_id}' deleted successfully.` });
    }),
  );

  return server;
}
