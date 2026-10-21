/**
 * Runtime MCP server: instance data of one ontology through exactly one
 * lens.
 *
 * Both bindings come from the mount URL alone
 * (`/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey`, `mount.ts`)
 * and are fixed into the server factory, so a tool can never name an
 * ontology or a lens, and can never reach across two
 * (`docs/decisions.md#interfaces`). The anchored mount (`…/anchors/:anchorKey`)
 * binds an anchor the same way.
 *
 * Tools call the runtime services directly, take snake_case parameters,
 * and CLAMP `limit`/`offset` into range where REST rejects out-of-range
 * values — a documented divergence-by-design between the two entrances.
 * Failures are reported as tool errors with per-field detail flattened
 * into the message text (shared `formatToolError`).
 *
 * Changesets: the six entity and relation write tools take an optional
 * `changeset_id` that stages the write instead (`runtime/changesets.ts`,
 * the same functions as REST); nine tools start, list, read, unstage,
 * submit, unsubmit, commit and discard a changeset and read its staged
 * document text. None is grantable to
 * an agent (`toolNames.ts`). On a staged-only anchor (V9, V29) the six
 * write tools require `changeset_id`, and `commit_changeset`,
 * `edit_document` and `write_document` are not registered (R13);
 * elsewhere those two refuse a `changeset_id` rather than drop it.
 */

import {
  INDEX_SEARCH_GUIDANCE,
  RELATIVE_SCORE_PROMISE,
  SEARCH_EVIDENCE_GUIDANCE,
  SEARCH_RESPONSE,
  TOOL_MIN_SIMILARITY_GUIDANCE,
  toolMinSimilarity,
} from "../runtime/search/strategies.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { settings } from "../config.js";
import { valueToText } from "../core/dataTypes.js";
import { ValidationError } from "../core/exceptions.js";
import { getRuntimeStore, type RuntimeStore } from "../core/ports.js";
import { getRulesetView, readMountRuleset } from "../runtime/rulesets.js";
import { filterRules } from "../runtime/readHelpers.js";
import * as changesets from "../runtime/changesets.js";
import * as service from "../runtime/service.js";
import { checkOperation, toolOperation, type Operation } from "../runtime/writeAccess.js";
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

interface SearchToolArgs {
  query: string;
  entity_type_key?: string;
  limit?: number;
  filters?: Record<string, unknown>;
  fields?: string[];
  property?: string;
}

interface IndexSearchToolArgs {
  query: string;
  index?: string | string[];
  relations?: string[];
  limit?: number;
  filters?: Record<string, unknown>;
  fields?: string[];
}

/** Tool filter values as the text the services coerce, like a query string. */
function filterText(filters: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters ?? {}).map(([key, value]) => [key, valueToText(value)]),
  );
}

/** The staged mode of a write tool with `changeset_id` (V4, V29), per
 * kind of write: what staging checks now and what only the commit does.
 * Staged-only, `changeset_id` is required. */
function stagedMode(kind: "create" | "update" | "delete", anchored: boolean, stagedOnly: boolean): string {
  const checks = {
    create:
      " A staged create's id is final, and later writes of the same changeset may name it. " +
      "Staging checks the type and the properties; relation ends, parents and the hierarchy " +
      "rules are checked at commit.",
    update:
      " It may name an id a staged create of the same changeset returned; that id is final. " +
      "Staging checks the type, the properties and that the target exists, and records the " +
      "stored values of the keys sent as the write's before: if they change before the commit, " +
      "the commit is rejected.",
    delete:
      " It may name an id a staged create of the same changeset returned; that id is final. " +
      "Staging checks the type and that the target exists; the parent rules are checked at " +
      "commit, and a target already gone by then is skipped.",
  }[kind];
  return (
    (stagedOnly
      ? " This connection only stages: 'changeset_id' is required, and the write is staged into " +
        "that draft changeset; nothing changes now, "
      : " 'changeset_id' stages the write into that draft changeset instead: nothing changes now, ") +
    "the answer is {seq, id}, and reads never see staged data." +
    checks +
    (anchored
      ? " The hold to the anchored entity is checked at commit; a dangling anchor refuses staging."
      : "")
  );
}

/** The document edit tools cannot stage (V2). Their schemas keep unknown
 * keys, so a 'changeset_id' is refused here instead of dropped: a write
 * meant for a changeset never happens now. */
function refuseChangesetId(tool: string, args: object): void {
  if ("changeset_id" in args) {
    throw new ValidationError(
      `changeset_id is not accepted: ${tool} always writes immediately and cannot be staged; ` +
        "to stage a document change, pass the whole new value to update_entity with 'changeset_id'",
    );
  }
}

/** Open the store of one tool call: on an anchored mount, after the
 * not-found checks and the call's operation against write access. */
type Open = () => Promise<RuntimeStore>;

/** A tool's handler, given the opener of its call. */
type ToolFactory = <Args>(
  name: string,
  fn: (args: Args, open: Open) => Promise<ToolResult>,
) => (args: Args) => Promise<ToolResult>;

/**
 * Build the runtime MCP server bound to one ontology and one lens, and on
 * the anchored mount to one anchor. Anchored, every tool first checks
 * ontology, lens and anchor, in that order, reading the anchor fresh,
 * then its operation against the ruleset's write access
 * (`writeAccess.ts`, one read per call); the write tools pass the anchor
 * key to the service; and `get_anchor` is added. Changesets started here
 * carry the anchor, and only the anchor's are reachable, as on the
 * anchored REST mirror. A tool with no row in the operation table fails
 * the build.
 */
export function createRuntimeMcpServer(
  ontologyKey: string,
  lensKey: string,
  anchorKey: string | null = null,
  stagedOnly = false,
): McpServer {
  const server = new McpServer({ name: "OntoForge Runtime", version: "0.1.0" });

  const openStore = async (operation: Operation): Promise<RuntimeStore> => {
    const store = await getRuntimeStore(ontologyKey);
    if (anchorKey !== null) {
      const record = await readMountRuleset(lensKey, anchorKey, store);
      checkOperation({ rulesetKey: anchorKey, writeAccess: record.writeAccess }, operation);
    }
    return store;
  };
  const tool: ToolFactory = (name, fn) => {
    toolOperation(name, {}); // a tool without a row throws here
    return wrap(name, (args) => fn(args, () => openStore(toolOperation(name, args))));
  };

  /** Stage one write into a changeset of this lens (and anchor). */
  const stageInto = async (open: Open, changesetId: string, write: changesets.StagedWrite): Promise<ToolResult> =>
    jsonResult(await changesets.stage(lensKey, anchorKey, changesetId, write, await open()));
  const anchored = anchorKey !== null;
  const staged = (kind: "create" | "update" | "delete"): string => stagedMode(kind, anchored, stagedOnly);
  // Staged-only, every write names its changeset (V29).
  const changesetIdParam = stagedOnly ? z.string() : z.string().optional();

  if (anchorKey !== null) {
    server.registerTool(
      "get_anchor",
      {
        description:
          "Read where this connection is anchored. Returns key, state, stagedOnly, visible, " +
          "entity and path. state 'anchored': writes to the anchored entity's hierarchy are held to " +
          "that entity and its descendants; other types are written as usual. " +
          "'unanchored': no restriction. 'dangling': the entity was deleted, and every " +
          "write is refused until a person re-anchors. visible false: this lens does not " +
          "show the entity, and every write is refused. stagedOnly true: this connection only " +
          "stages, whatever the state: every write needs 'changeset_id', and it cannot commit; " +
          "submit the changeset so a person can review and commit it. path lists the entity's visible " +
          "ancestors, root first, ending with the entity. Read-only: a person sets the " +
          "anchor and may change it at any time, so read it again after a refusal.",
        inputSchema: {},
      },
      tool("get_anchor", async () =>
        jsonResult(await getRulesetView(lensKey, anchorKey, await getRuntimeStore(ontologyKey))),
      ),
    );
  }

  server.registerTool(
    "get_schema",
    {
      description:
        "Understand the lens before creating data. Shows available entity types, " +
        "relation types, and their property definitions including data types and " +
        "required flags. A relation type's `parent` names the end (`source` or " +
        "`target`) whose entity is the parent of the entity at the other end; null " +
        "means an ordinary relation. Call this first.",
      inputSchema: {},
    },
    tool("get_schema", async (_args, open) => {
      const result = await service.getLensSchema(lensKey, await open());
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "create_entity",
    {
      description:
        "Create a new entity instance. Properties must conform to the schema — " +
        "required properties must be present, types must match the property " +
        "definitions. To place the new entity in a hierarchy in the same call, pass " +
        "'parent_relation': 'type' is a parent relation type (one whose `parent` " +
        "names the parent end) whose child end is this entity type; 'parent_id' is " +
        "the parent, which must exist with the entity type at the parent end; " +
        "'properties' are the relation's own, held to the same rules as entity " +
        "properties. Its faults are reported together with the entity's, and the " +
        "entity and its parent relation are stored together or not at all." +
        (anchorKey === null
          ? ""
          : " On this anchored connection, an entity of a type in the anchored entity's " +
            "hierarchy must be created with 'parent_relation', and its parent must be the " +
            "anchored entity or one of its descendants; a hierarchy type this lens shows no " +
            "parent relation into cannot be created here. Entities of other types are " +
            "created as usual, 'parent_relation' optional.") +
        staged("create") +
        " With 'parent_relation' and 'changeset_id', two writes are staged, the entity's and then " +
        "its parent relation's, and the answer is {seq, id, relation: {seq, id}}; the relation is a " +
        "staged relation like any other, which later writes may name.",
      inputSchema: {
        entity_type_key: z.string(),
        properties: z.record(z.string(), z.unknown()),
        parent_relation: z
          .object({
            type: z.string(),
            parent_id: z.string(),
            properties: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "create_entity",
      async (args: {
        entity_type_key: string;
        properties: Record<string, unknown>;
        parent_relation?:
          | { type: string; parent_id: string; properties?: Record<string, unknown> | undefined }
          | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        const parent = args.parent_relation;
        const parentRelation =
          parent === undefined
            ? null
            : { type: parent.type, parentId: parent.parent_id, properties: parent.properties };
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "create_entity",
            typeKey: args.entity_type_key,
            properties: args.properties,
            parentRelation,
          });
        }
        const result = await service.createEntity(
          lensKey,
          args.entity_type_key,
          args.properties,
          await open(),
          parentRelation,
          anchorKey,
        );
        return jsonResult(result);
      },
    ),
  );

  server.registerTool(
    "list_entities",
    {
      description:
        "List entities of a type with optional filtering, search, sorting and pagination: " +
        "'limit' (default 50) and 'offset' (items to skip); the response echoes total. Use " +
        "'search' for case-insensitive substring matching across all string properties. " +
        filterRules({ contains: true, relations: true }) +
        " To bind two conditions to one relation use execute_query. 'fields' selects the " +
        "properties returned, plus _id always.",
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
    tool(
      "list_entities",
      async (args: {
        entity_type_key: string;
        search?: string | undefined;
        filters?: Record<string, unknown> | undefined;
        sort?: string | undefined;
        order?: "asc" | "desc" | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
        fields?: string[] | undefined;
      }, open) => {
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
          await open(),
          args.fields ?? null,
        );
        return jsonResult(result);
      },
    ),
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
    tool(
      "get_entity",
      async (args: {
        entity_type_key: string;
        entity_id: string;
        fields?: string[] | undefined;
      }, open) => {
        const result = await service.getEntity(
          lensKey,
          args.entity_type_key,
          args.entity_id,
          await open(),
          args.fields ?? null,
        );
        return jsonResult(result);
      },
    ),
  );

  server.registerTool(
    "get_path",
    {
      description:
        "Read where an entity sits in its hierarchy: its path over the parent " +
        "relations as [{type, id, name}], root first and ending with the entity " +
        "itself. A root's path is the entity alone. The path starts below the " +
        "nearest ancestor this connection cannot see, so it names only visible " +
        "entities. name is null when the entity has no name value.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
      },
    },
    tool("get_path", async (args: { entity_type_key: string; entity_id: string }, open) => {
      const result = await service.getPath(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        await open(),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "get_document",
    {
      description:
        "Read (a slice of) a document property's content. Document properties " +
        "hold large Markdown text and are stubbed by default in other tools " +
        '— they appear as {"document": true, "length": N} stubs. ' +
        "'offset' and 'limit' are character-based; omit both to read the full " +
        "document. Use the charOffset/charLength from a search hit's " +
        "matches, or from a search_by_index passage's matched, to read exactly the matching passage.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        property_key: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    tool(
      "get_document",
      async (args: {
        entity_type_key: string;
        entity_id: string;
        property_key: string;
        offset?: number | undefined;
        limit?: number | undefined;
      }, open) => {
        const offset = Math.max(0, args.offset ?? 0);
        const limit =
          args.limit === undefined || args.limit === null ? null : Math.max(1, args.limit);
        const result = await service.getDocument(
          lensKey,
          args.entity_type_key,
          args.entity_id,
          args.property_key,
          offset,
          limit,
          await open(),
        );
        return jsonResult(result);
      },
    ),
  );

  server.registerTool(
    "update_entity",
    {
      description:
        "Partial update — only provided properties change. Set a property to null " +
        "to remove it (fails for required properties). Document properties are " +
        (stagedOnly
          ? "replaced whole: send the complete new text."
          : "replaced whole here — prefer edit_document / write_document for " +
            "partial edits inside a document; in a changeset, where those cannot stage, replace " +
            "it whole here.") +
        staged("update"),
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        properties: z.record(z.string(), z.unknown()),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "update_entity",
      async (args: {
        entity_type_key: string;
        entity_id: string;
        properties: Record<string, unknown>;
        changeset_id?: string | undefined;
      }, open) => {
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "update_entity",
            typeKey: args.entity_type_key,
            id: args.entity_id,
            properties: args.properties,
          });
        }
        const result = await service.updateEntity(
          lensKey,
          args.entity_type_key,
          args.entity_id,
          args.properties,
          await open(),
          anchorKey,
        );
        return jsonResult(result);
      },
    ),
  );

  // They cannot stage (V2): not offered where every write must (R13).
  if (!stagedOnly) {
    server.registerTool(
      "edit_document",
      {
        description:
          "Edit a document property by exact string replacement — the preferred " +
          "way to change part of a document. old_string must match the current " +
          "content exactly and uniquely; if it matches more than once, provide a " +
          "longer string with surrounding context, or set replace_all to true to " +
          "replace every occurrence. Returns the new totalLength, the edited " +
          "range, and ~200 chars of context around the edit for verification. It always " +
          "writes immediately and cannot be staged into a changeset: a 'changeset_id' is " +
          "refused and nothing is written; to stage a document change, pass the whole new " +
          "value to update_entity with 'changeset_id'.",
        inputSchema: z.looseObject({
          entity_type_key: z.string(),
          entity_id: z.string(),
          property_key: z.string(),
          old_string: z.string(),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        }),
      },
      tool(
        "edit_document",
        async (args: {
          entity_type_key: string;
          entity_id: string;
          property_key: string;
          old_string: string;
          new_string: string;
          replace_all?: boolean | undefined;
        }, open) => {
          refuseChangesetId("edit_document", args);
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
            await open(),
            anchorKey,
          );
          return jsonResult(result);
        },
      ),
    );

    server.registerTool(
      "write_document",
      {
        description:
          "Overwrite a character range of a document property: replaces " +
          "[offset, offset+length) with content. Insert with length=0; append " +
          "with offset=totalLength and length=0. Offsets pair with get_document " +
          "reads and the charOffset/charLength of search matches. Pass " +
          "'expect' (the text currently in the range) to fail safely if the " +
          "document changed since it was read. Returns the new totalLength, the " +
          "edited range, and ~200 chars of context around the edit. It always writes " +
          "immediately and cannot be staged into a changeset: a 'changeset_id' is refused and " +
          "nothing is written; to stage a document change, pass the whole new value to " +
          "update_entity with 'changeset_id'.",
        inputSchema: z.looseObject({
          entity_type_key: z.string(),
          entity_id: z.string(),
          property_key: z.string(),
          offset: z.number(),
          length: z.number(),
          content: z.string(),
          expect: z.string().optional(),
        }),
      },
      tool(
        "write_document",
        async (args: {
          entity_type_key: string;
          entity_id: string;
          property_key: string;
          offset: number;
          length: number;
          content: string;
          expect?: string | undefined;
        }, open) => {
          refuseChangesetId("write_document", args);
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
            await open(),
            anchorKey,
          );
          return jsonResult(result);
        },
      ),
    );
  }

  server.registerTool(
    "delete_entity",
    {
      description:
        "Delete an entity and all its connected relations. In an ontology with parent " +
        "relations (relation types whose `parent` names the parent end), an entity that " +
        "still has children is refused: delete its children first, bottom-up. A leaf, " +
        "or any entity in an ontology without parent relations, goes with its relations." +
        staged("delete"),
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string(),
        changeset_id: changesetIdParam,
      },
    },
    tool("delete_entity", async (args: { entity_type_key: string; entity_id: string; changeset_id?: string | undefined }, open) => {
      if (args.changeset_id !== undefined) {
        return stageInto(open, args.changeset_id, {
          operation: "delete_entity",
          typeKey: args.entity_type_key,
          id: args.entity_id,
        });
      }
      await service.deleteEntity(
        lensKey,
        args.entity_type_key,
        args.entity_id,
        await open(),
        anchorKey,
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
        "relation type's source/target definition. For a parent relation (a relation " +
        "type whose `parent` names the parent end), every entity has at most one parent " +
        "across all parent relations and the hierarchy has no cycles: the create is " +
        "refused when the child end already has a parent, or when the parent end is the " +
        "child itself or one of its descendants." +
        staged("create"),
      inputSchema: {
        relation_type_key: z.string(),
        from_entity_id: z.string(),
        to_entity_id: z.string(),
        properties: z.record(z.string(), z.unknown()).optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "create_relation",
      async (args: {
        relation_type_key: string;
        from_entity_id: string;
        to_entity_id: string;
        properties?: Record<string, unknown> | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "create_relation",
            typeKey: args.relation_type_key,
            fromEntityId: args.from_entity_id,
            toEntityId: args.to_entity_id,
            properties: args.properties ?? {},
          });
        }
        const result = await service.createRelation(
          lensKey,
          args.relation_type_key,
          args.from_entity_id,
          args.to_entity_id,
          args.properties ?? {},
          await open(),
          anchorKey,
        );
        return jsonResult(result);
      },
    ),
  );

  server.registerTool(
    "list_relations",
    {
      description:
        "List relations of a type, optionally only those from or to one entity " +
        "(from_entity_id, to_entity_id). " +
        filterRules({ contains: true, relations: false }) +
        " The properties are the relation's own.",
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
    tool(
      "list_relations",
      async (args: {
        relation_type_key: string;
        from_entity_id?: string | undefined;
        to_entity_id?: string | undefined;
        filters?: Record<string, unknown> | undefined;
        sort?: string | undefined;
        order?: "asc" | "desc" | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
      }, open) => {
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
          await open(),
        );
        return jsonResult(result);
      },
    ),
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
    tool("get_relation", async (args: { relation_type_key: string; relation_id: string }, open) => {
      const result = await service.getRelation(
        lensKey,
        args.relation_type_key,
        args.relation_id,
        await open(),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "update_relation",
    {
      description:
        "Partial update of relation properties. Cannot change connected entities — " +
        "delete and recreate instead." +
        staged("update"),
      inputSchema: {
        relation_type_key: z.string(),
        relation_id: z.string(),
        properties: z.record(z.string(), z.unknown()),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "update_relation",
      async (args: {
        relation_type_key: string;
        relation_id: string;
        properties: Record<string, unknown>;
        changeset_id?: string | undefined;
      }, open) => {
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "update_relation",
            typeKey: args.relation_type_key,
            id: args.relation_id,
            properties: args.properties,
          });
        }
        const result = await service.updateRelation(
          lensKey,
          args.relation_type_key,
          args.relation_id,
          args.properties,
          await open(),
          anchorKey,
        );
        return jsonResult(result);
      },
    ),
  );

  server.registerTool(
    "delete_relation",
    {
      description: "Delete a relation. Connected entities are unaffected." + staged("delete"),
      inputSchema: {
        relation_type_key: z.string(),
        relation_id: z.string(),
        changeset_id: changesetIdParam,
      },
    },
    tool("delete_relation", async (args: { relation_type_key: string; relation_id: string; changeset_id?: string | undefined }, open) => {
      if (args.changeset_id !== undefined) {
        return stageInto(open, args.changeset_id, {
          operation: "delete_relation",
          typeKey: args.relation_type_key,
          id: args.relation_id,
        });
      }
      await service.deleteRelation(
        lensKey,
        args.relation_type_key,
        args.relation_id,
        await open(),
        anchorKey,
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
    tool(
      "get_neighbors",
      async (args: {
        entity_type_key: string;
        entity_id: string;
        direction?: string | undefined;
        relation_type_key?: string | undefined;
        limit?: number | undefined;
        fields?: string[] | undefined;
        relation_fields?: string[] | undefined;
      }, open) => {
        const limit = clamp(args.limit ?? 50, 1, 200);
        const result = await service.getNeighbors(
          lensKey,
          args.entity_type_key,
          args.entity_id,
          args.direction ?? "both",
          args.relation_type_key ?? null,
          limit,
          await open(),
          args.fields ?? null,
          args.relation_fields ?? null,
        );
        return jsonResult(result);
      },
    ),
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
    tool("execute_query", async (args: { query: string }, open) => {
      const result = await service.executeQuery(
        lensKey,
        args.query,
        await open(),
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "list_search_indices",
    {
      description:
        "List the search indices this lens can search, to choose indices for search_by_index's index argument. " +
        "Each has key, kind (default: an entity type's own text; passage: one document's passages; " +
        "custom: designed fields and relation groups), name, description (what it finds — choose by it), " +
        "entityType (hits are always entities of this type), fields, relations (the relation groups: " +
        "relationType — the key search_by_index's relations argument takes — direction and label), " +
        "documentProperty (the property_key for get_document after a passage match), modes and " +
        "status (ready, building, stale, failed, unavailable; an index not yet built finds nothing).",
      inputSchema: {},
    },
    tool("list_search_indices", async (_args, open) =>
      jsonResult(await service.searchIndexCatalog(lensKey, await open())),
    ),
  );

  for (const document of [false, true]) {
    const name = document ? "search_documents" : "search";
    server.registerTool(
      name,
      {
        description:
          (document
            ? "Find entities whose document text matches; property restricts it to one document property key. Hits carry passage matches to read with get_document. "
            : "Find entities for a text across properties and documents; to find them through what they are related to, or through chosen search indices, use search_by_index. ") +
          "Omit entity_type_key to search all exposed types. " +
          filterRules({ contains: false, relations: true }) +
          " Filters narrow the hits, never list what the query misses; across types they keep only the types every key applies to. " +
          "fields projects each entity; limit: an integer 1–100, default 10. " +
          SEARCH_RESPONSE + " " + TOOL_MIN_SIMILARITY_GUIDANCE + " relativeScore: " +
          RELATIVE_SCORE_PROMISE + " " + SEARCH_EVIDENCE_GUIDANCE,
        inputSchema: {
          query: z.string(),
          entity_type_key: z.string().optional(),
          limit: z.number().optional(),
          filters: z.record(z.string(), z.unknown()).optional(),
          fields: z.array(z.string()).optional(),
          ...(document ? { property: z.string().optional() } : {}),
        },
      },
      tool(name, async (args: SearchToolArgs, open) => {
        const store = await open();
        return jsonResult(
          await service.search(
            lensKey,
            {
              query: args.query,
              type: args.entity_type_key ?? null,
              limit: clamp(args.limit ?? 10, 1, 100),
              minSimilarity: toolMinSimilarity(store),
              filter: filterText(args.filters),
              fields: args.fields ?? null,
              ...(document
                ? { in: ["document" as const], document: { property: args.property } }
                : {}),
            },
            store,
          ),
        );
      }),
    );
  }

  server.registerTool(
    "search_by_index",
    {
      description:
        "Find entities for a text through search indices (keys from list_search_indices). " +
        "A custom index with relation groups also finds an entity through its relations. " +
        "index: one key or a non-empty list; omit it for every index of this lens. " +
        "relations: relation types whose entries count ([] none); own fields and passages always do. " +
        filterRules({ contains: false, relations: true }) +
        " Filters narrow the hits, never list what the query misses, and keep only indices whose type every key applies to. " +
        "fields projects each entity; limit: an integer 1–100, default 10. " +
        "Returns query, mode (hybrid: semantic+keyword), minSimilarity and hits; each hit has entity, relativeScore and " +
        "matched, its best entry: index, partKind (self/relation/passage), a relation's relationType, relationId and " +
        "target (other end: id, type, label), snippet (the entry's start), a passage's charOffset and charLength " +
        "— for get_document use the index's documentProperty as property_key. " +
        TOOL_MIN_SIMILARITY_GUIDANCE + " relativeScore: " +
        RELATIVE_SCORE_PROMISE + " " + INDEX_SEARCH_GUIDANCE,
      inputSchema: {
        query: z.string(),
        index: z.union([z.string(), z.array(z.string())]).optional(),
        relations: z.array(z.string()).optional(),
        limit: z.number().optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        fields: z.array(z.string()).optional(),
      },
    },
    tool("search_by_index", async (args: IndexSearchToolArgs, open) => {
      const store = await open();
      const minSimilarity = toolMinSimilarity(store);
      const response = await service.searchByIndices(
        lensKey,
        {
          indices: args.index === undefined ? null : [args.index].flat(),
          relations: args.relations ?? null,
          query: args.query,
          filters: filterText(args.filters),
          minScore: minSimilarity,
          limit: clamp(args.limit ?? 10, 1, 100),
          fields: args.fields ?? null,
        },
        store,
      );
      return jsonResult({ query: response.query, mode: response.mode, minSimilarity, hits: response.hits });
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
    tool("list_saved_queries", async (_args, open) => {
      const result = await service.listSavedQueries(lensKey, await open());
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
    tool(
      "run_saved_query",
      async (args: { query_key: string; params?: Record<string, unknown> | undefined }, open) => {
        const result = await service.executeSavedQuery(
          lensKey,
          args.query_key,
          args.params ?? {},
          await open(),
        );
        return jsonResult(result);
      },
    ),
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
    tool("search_saved_queries", async (args: { query: string }, open) => {
      const result = await service.searchSavedQueries(
        lensKey,
        args.query,
        3,
        0.7,
        await open(),
      );
      return jsonResult(result);
    }),
  );

  registerChangesetTools(server, lensKey, anchorKey, stagedOnly, tool);

  return server;
}

/** Who reaches a changeset through this mount (V8 A, V17, R4). */
function reach(anchored: boolean): string {
  return anchored
    ? " A changeset_id not started through this anchor, or committed, discarded or expired, is not found."
    : " A changeset_id this lens does not hold (started through another lens, committed, discarded or expired) is not found.";
}

/** The fields of a changeset in every answer. */
const CHANGESET_FIELDS = "id, state, version, note, anchor, writeCount, createdAt, lastChangeAt and submittedAt";

/** The checks without a lock that submit and commit run first (V19). */
const LOCK_FREE_CHECKS =
  "every target still exists, no value an update replaces has changed since staging, every " +
  "id a write names is stored or created in this changeset, and this lens still shows every " +
  "type and accepts every value";

/**
 * The nine changeset tools (V33): the same service functions as the REST
 * routes, through this mount's lens and anchor. Staged-only, no
 * `commit_changeset` (V9).
 */
function registerChangesetTools(
  server: McpServer,
  lensKey: string,
  anchorKey: string | null,
  stagedOnly: boolean,
  tool: ToolFactory,
): void {
  const anchored = anchorKey !== null;

  server.registerTool(
    "start_changeset",
    {
      description:
        "Start a changeset: a plan of writes to this lens's data, staged over any time and " +
        "committed later, all or nothing. note: optional, at most 1,000 characters, for whoever " +
        `reviews the plan. Returns the changeset: ${CHANGESET_FIELDS}; state is 'draft'. Next, ` +
        "stage writes by passing its id as 'changeset_id' to create_entity, update_entity, " +
        "delete_entity, create_relation, update_relation or delete_relation; reads never see " +
        "staged data. A changeset holds at most 10,000 writes, and at most " +
        `${settings.CHANGESET_MAX_BYTES} bytes of them as JSON, document text included. A draft ` +
        "changeset left unchanged for 7 days expires and is deleted." +
        (anchored
          ? " It carries this connection's anchor: it is reached only through this anchor, or " +
            "through the lens without an anchor, and its commit holds its writes to the " +
            "anchored entity and its descendants."
          : " Only connections to this lens without an anchor reach it."),
      inputSchema: { note: z.string().optional() },
    },
    tool("start_changeset", async (args: { note?: string | undefined }, open) =>
      jsonResult(await changesets.startChangeset(lensKey, anchorKey, args.note, await open())),
    ),
  );

  server.registerTool(
    "list_changesets",
    {
      description:
        "List the changesets of this lens" +
        (anchored ? " started through this anchor" : ", those started through an anchor included") +
        ", submitted first, then by last change, newest first. Each has id, state ('draft': open " +
        "for staging; 'submitted': frozen and handed over for review), version, note, anchor " +
        "(the anchor key it was started through, or null), writeCount, operations (staged " +
        "writes per operation), types (the type keys its writes name that this lens shows), " +
        "notVisible (how many type keys its writes name that this lens no longer shows), " +
        "createdAt, lastChangeAt and submittedAt. A changeset leaves the list when it is " +
        "committed or discarded, or when it expires after 7 days unchanged as a draft. A " +
        "submitted changeset can be neither discarded nor expire, so one that left the list " +
        "was committed.",
      inputSchema: {},
    },
    tool("list_changesets", async (_args, open) =>
      jsonResult(await changesets.listChangesets(lensKey, anchorKey, await open())),
    ),
  );

  server.registerTool(
    "get_changeset",
    {
      description:
        "Read a changeset and one page of its staged writes by seq: offset (default 0) and " +
        `limit (default 100, 1–500). Returns ${CHANGESET_FIELDS}, offset, limit and writes. ` +
        "Each write has seq (seqs may skip numbers), operation, type, id (the id a create " +
        "minted, or the target) and createdAt; entity writes add name; relation " +
        "writes add from and to {id, name}; before (an " +
        "update's stored values of the keys it sets, as they were when it was staged), current " +
        "(those values now; null when the target is gone), both " +
        "null when the target is created in this changeset; after (the values it sets), and " +
        "markers [{kind, message}]: what would reject the commit now, the hierarchy rules aside: " +
        "drift (current differs from before: compare them, and restage only if your change " +
        "still applies), missing (its target is gone), dangling (an id " +
        "neither stored nor created in this changeset), not_visible (this lens no longer shows " +
        "its type), replay (a value this lens no longer accepts). Document values in before, " +
        "current and after show as {document: true, length}; get_staged_document reads the " +
        "staged text. Everything is shown through this lens as it is now: what it hides is " +
        "left out, and a write of a type it no longer shows keeps only seq, operation, " +
        "createdAt and markers." +
        (stagedOnly ? "" : " To commit exactly what you read, pass version as expected_version to commit_changeset.") +
        reach(anchored),
      inputSchema: {
        changeset_id: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    tool(
      "get_changeset",
      async (args: { changeset_id: string; offset?: number | undefined; limit?: number | undefined }, open) =>
        jsonResult(
          await changesets.getChangeset(
            lensKey,
            anchorKey,
            args.changeset_id,
            Math.max(0, Math.trunc(args.offset ?? 0)),
            clamp(Math.trunc(args.limit ?? 100), 1, 500),
            await open(),
          ),
        ),
    ),
  );

  server.registerTool(
    "get_staged_document",
    {
      description:
        "Read the text a commit of a changeset would leave in one document property, as set by " +
        "the last write staged in it that sets that property: a create of the entity (one " +
        "created in this changeset included) or an update of it. A staged document value is " +
        "always the whole new text; a staged null reads as empty. get_changeset shows document " +
        "values only as {document: true, length}. 'offset' and 'limit' are character-based, as " +
        "in get_document; omit both to read the whole text. Returns propertyKey, content, " +
        "offset, length (of content) and totalLength. Not found when no staged write of this " +
        "changeset sets that property, when a later staged write deletes the entity, or when " +
        "this lens does not show the entity type or the property." +
        reach(anchored),
      inputSchema: {
        changeset_id: z.string(),
        entity_type_key: z.string(),
        entity_id: z.string(),
        property_key: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    tool(
      "get_staged_document",
      async (args: {
        changeset_id: string;
        entity_type_key: string;
        entity_id: string;
        property_key: string;
        offset?: number | undefined;
        limit?: number | undefined;
      }, open) =>
        jsonResult(
          await changesets.getStagedDocument(
            lensKey,
            anchorKey,
            args.changeset_id,
            args.entity_type_key,
            args.entity_id,
            args.property_key,
            Math.max(0, args.offset ?? 0),
            args.limit === undefined || args.limit === null ? null : Math.max(1, args.limit),
            await open(),
          ),
        ),
    ),
  );

  server.registerTool(
    "unstage",
    {
      description:
        "Remove one staged write, by its seq, from a draft changeset; its version goes up. " +
        "Writes that depend on it stay staged: a write naming an id that a removed create " +
        "minted is dangling, and submit and commit reject it until it is removed too or the " +
        "create is staged again. A staged write cannot be edited: to change one, a drifted " +
        "update included, unstage it and stage it again. A submitted changeset refuses it. A " +
        "seq the changeset does not hold is not found." +
        reach(anchored),
      inputSchema: { changeset_id: z.string(), seq: z.number().int() },
    },
    tool("unstage", async (args: { changeset_id: string; seq: number }, open) => {
      await changesets.unstage(lensKey, anchorKey, args.changeset_id, args.seq, await open());
      return jsonResult({ message: `Staged write ${args.seq} removed from changeset '${args.changeset_id}'.` });
    }),
  );

  server.registerTool(
    "submit_changeset",
    {
      description:
        "Hand a draft changeset over for review: it is frozen (no staging, unstaging or " +
        "discarding) until it is committed or unsubmitted, and its version goes up. note: " +
        "optional, at most 1,000 characters; it replaces the stored note, and without it the " +
        "note stays. First, with no lock taken, every write is checked: " +
        LOCK_FREE_CHECKS +
        ". Any fault refuses the submit, naming its violations (total, then the first 100, " +
        "each with seq, kind and message), and the changeset stays a draft. The hierarchy rules" +
        (anchored ? " and the hold to the anchored entity" : "") +
        " are checked only at commit. Also refused when the changeset is already submitted, " +
        "when it changed during the submit, or when its anchor is dangling or at an entity " +
        `this lens hides. Returns the changeset: ${CHANGESET_FIELDS}; state is 'submitted'.` +
        (stagedOnly
          ? " This connection cannot commit: submitting hands the changeset to a person, who " +
            "commits it or sends it back."
          : "") +
        reach(anchored),
      inputSchema: { changeset_id: z.string(), note: z.string().optional() },
    },
    tool("submit_changeset", async (args: { changeset_id: string; note?: string | undefined }, open) =>
      jsonResult(
        await changesets.submitChangeset(lensKey, anchorKey, args.changeset_id, args.note, await open()),
      ),
    ),
  );

  server.registerTool(
    "unsubmit_changeset",
    {
      description:
        "Send a submitted changeset back: it is a draft again with its writes kept, so it can be " +
        (stagedOnly
          ? "staged into, unstaged, discarded or submitted again; its version goes up. "
          : "staged into, unstaged, discarded, submitted or committed again; its version goes up. ") +
        "note: required, not blank, at most 1,000 characters; it replaces the stored note, so " +
        "say what should change. A draft changeset is refused." +
        (anchored ? " It works while the anchor is dangling." : "") +
        ` Returns the changeset: ${CHANGESET_FIELDS}; state is 'draft'.` +
        reach(anchored),
      inputSchema: { changeset_id: z.string(), note: z.string() },
    },
    tool("unsubmit_changeset", async (args: { changeset_id: string; note: string }, open) =>
      jsonResult(
        await changesets.unsubmitChangeset(lensKey, anchorKey, args.changeset_id, args.note, await open()),
      ),
    ),
  );

  if (!stagedOnly) {
    server.registerTool(
      "commit_changeset",
      {
        description:
          "Persist every staged write of a changeset, draft or submitted, in seq order, all or " +
          "nothing; committing a submitted changeset approves it. expected_version: optional, the " +
          "version you reviewed; if the changeset changed since, the commit is refused and " +
          "nothing is written. Omitted, the current version commits. Checked first: " +
          LOCK_FREE_CHECKS +
          ". Then, on the result: every entity has at most one parent, no cycles, relation ends " +
          "of the right types, no entity deleted while it keeps children" +
          (anchored
            ? ", and every write held to the anchored entity and its descendants; a dangling or " +
              "deleted anchor rejects the commit"
            : ", and for a changeset started through an anchor, every write held to the anchored " +
              "entity and its descendants; a dangling or deleted anchor rejects it") +
          ". A rejection names its violations (total, then the first 100, each with seq, kind " +
          "and message); nothing is persisted and the changeset stays as it was, draft or submitted. " +
          "On drift, compare before and current in get_changeset, and restage only if your " +
          "change still applies. Refused with nothing persisted while another " +
          "commit runs on this ontology or the changeset is busy: try again. Committed, it " +
          "returns {committed, alreadyGone}, the number of writes and the seqs of deletes whose " +
          "target was already gone, and the changeset is gone. If the response is lost, tell the " +
          "outcome by reading an id a staged create minted, or by listing the changesets: a " +
          "submitted changeset that is no longer listed was committed, and one still listed is " +
          "not committed." +
          reach(anchored),
        inputSchema: { changeset_id: z.string(), expected_version: z.number().int().optional() },
      },
      tool("commit_changeset", async (args: { changeset_id: string; expected_version?: number | undefined }, open) =>
        jsonResult(
          await changesets.commitChangeset(
            lensKey,
            anchorKey,
            args.changeset_id,
            args.expected_version,
            await open(),
          ),
        ),
      ),
    );
  }

  server.registerTool(
    "discard_changeset",
    {
      description:
        "Delete a draft changeset and all its staged writes; the data is not touched, and it " +
        "cannot be undone. A submitted changeset is refused until it is unsubmitted." +
        reach(anchored),
      inputSchema: { changeset_id: z.string() },
    },
    tool("discard_changeset", async (args: { changeset_id: string }, open) => {
      await changesets.discardChangeset(lensKey, anchorKey, args.changeset_id, await open());
      return jsonResult({ message: `Changeset '${args.changeset_id}' discarded.` });
    }),
  );
}
