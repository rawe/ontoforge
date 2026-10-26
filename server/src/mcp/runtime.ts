/**
 * Runtime MCP server: instance data of one ontology through exactly one
 * lens.
 *
 * Both bindings come from the mount URL alone
 * (`/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey`, `mount.ts`)
 * and are fixed into the server factory, so a tool can never name an
 * ontology or a lens, and can never reach across two
 * (`docs/decisions.md#interfaces`). The ruleset mount (`…/rulesets/:rulesetKey`)
 * binds a ruleset the same way.
 *
 * Tools call the runtime services directly, take snake_case parameters,
 * and CLAMP `limit`/`offset` into range where REST rejects out-of-range
 * values — a documented divergence-by-design between the two entrances.
 * Failures are reported as tool errors with per-field detail flattened
 * into the message text (shared `formatToolError`).
 *
 * Changesets: the six entity and relation write tools and the two
 * document edit tools take an optional `changeset_id` that stages the
 * write instead (`runtime/changesets.ts`, the same functions as REST);
 * eleven tools start, list, read, unstage from, rebase, submit, unsubmit,
 * check, commit and discard a changeset and read its staged document text. None is
 * grantable to an agent (`toolNames.ts`). A ruleset mount lists the tools
 * its write access allows (`writeAccess.ts`): at 'propose' the eight write
 * tools require `changeset_id` and `commit_changeset` is not listed; at
 * 'none' only the reads and the changeset reads are.
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
import { roleRefusal } from "../access/authorize.js";
import { ValidationError } from "../core/exceptions.js";
import { getRuntimeStore, type RuntimeStore, type WriteAccess } from "../core/ports.js";
import { getRulesetView, readMountRuleset } from "../runtime/rulesets.js";
import { filterRules } from "../runtime/readHelpers.js";
import * as changesets from "../runtime/changesets.js";
import * as service from "../runtime/service.js";
import {
  allows,
  lower,
  checkOperation,
  listsTool,
  toolOperation,
  type Binding,
  type Operation,
} from "../runtime/writeAccess.js";
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

/** The staged mode of a write tool with `changeset_id`, per kind of
 * write: how it merges into the changeset, what staging checks now and
 * what only the commit does. On a level that cannot write directly,
 * `changeset_id` is required. */
function stagedMode(kind: "create" | "update" | "delete" | "edit", binding: Binding): string {
  const before =
    "For a stored target, the first staging of a key records its stored value as the before: " +
    "if it changes before the commit, the commit is rejected, until rebase accepts the change.";
  const checks = {
    create:
      " A staged create's id is final, and later writes of the same changeset may name it. " +
      "Staging checks the type and the properties; relation ends, parents and the hierarchy " +
      "rules are checked at commit.",
    update:
      " It may name an id a staged create of the same changeset returned. The changeset holds " +
      "one staged value per property: sending a key again replaces its staged value, and an " +
      "update of an entity or relation created in the changeset changes that create. Staging " +
      "checks the type, the properties and that the target exists, stored or created in the " +
      "changeset and not deleted there. " +
      before,
    delete:
      " It may name an id a staged create of the same changeset returned. A delete of an " +
      "object created in the changeset takes that create out; a delete of a stored one drops " +
      "its staged values. Staging checks the type and that the target exists, stored or " +
      "created in the changeset and not deleted there; the parent rules are checked at commit, " +
      "and a target already gone by then is skipped.",
    edit:
      " The edit applies to the staged text of the property, or else the stored text, and the " +
      "whole result is staged as the property's value; it may name an entity created in the " +
      "changeset. Staging checks what the immediate edit checks and that the entity exists, " +
      "stored or created in the changeset and not deleted there. " +
      before,
  }[kind];
  const answer = {
    create: "the answer is {id}",
    update: "the answer is {id}",
    delete: "the answer is {id}",
    edit: "the answer is the edit's answer with id",
  }[kind];
  return (
    (allows(binding.writeAccess, "write")
      ? " 'changeset_id' stages the write into that draft changeset instead: nothing changes now, "
      : ` This connection has write access '${binding.writeAccess}': it only stages, so ` +
        "'changeset_id' is required and the write is staged into that draft changeset; nothing " +
        "changes now, ") +
    `${answer}, and reads never see staged data.` +
    checks +
    (binding.rulesetKey !== null
      ? " If this connection's ruleset sets an anchor, the commit checks that the write stays in " +
        "the anchor's subtree, and staging is refused while the anchor entity no longer exists."
      : "")
  );
}

/** How an entity tool names its entity. */
const ENTITY_ADDRESS =
  " Name the entity by 'entity_id' or by 'entity_identity', exactly one. An entity type with " +
  "identityProperties in the schema gives each entity a readable identity, the _identity its " +
  "reads return; prefer it to the id when the type has one.";

/** The arguments that name an entity. */
interface EntityArgs {
  entity_type_key: string;
  entity_id?: string | undefined;
  entity_identity?: string | undefined;
}

/** The fault of an entity named both by id and by identity, or by
 * neither. */
function exactlyOneOf(idArg: string, identityArg: string): ValidationError {
  const fields = {};
  service.exactlyOneFault(fields, idArg, identityArg);
  return new ValidationError(`Give exactly one of ${idArg} and ${identityArg}`, { fields });
}

/** Open the store of one tool call: on a ruleset mount, after the
 * not-found checks and the call's operation against write access. */
type Open = () => Promise<RuntimeStore>;

/** A tool's handler, given the opener of its call. */
type ToolFactory = <Args>(
  name: string,
  fn: (args: Args, open: Open) => Promise<ToolResult>,
) => (args: Args) => Promise<ToolResult>;

/** Register a tool, listed only when the binding's level allows it. */
type Register = McpServer["registerTool"];

/** The caller's role on the lens, before anything else: a Reader (level
 * `none`) only reads, a Proposer (`propose`) only stages. Authentication
 * off is `full`. */
function checkRole(lensKey: string, roleLevel: WriteAccess, operation: Operation): void {
  if (!allows(roleLevel, operation)) throw roleRefusal(roleLevel, lensKey, operation);
}

/** The binding of the plain lens: no ruleset, full write access. */
const PLAIN_LENS: Binding = { rulesetKey: null, writeAccess: "full" };

/**
 * Build the runtime MCP server bound to one ontology and one lens, and on
 * the ruleset mount to one ruleset. The tool list follows the binding's
 * write access (`listsTool`). On a ruleset mount every tool call first
 * checks ontology, lens and ruleset, in that order, reading the ruleset
 * fresh, then its operation against the ruleset's write access
 * (`writeAccess.ts`, one read per call), so a call its level does not
 * allow is refused whatever list the client holds; the write tools pass
 * the ruleset key to the service; and `get_ruleset`
 * is added. Changesets started here carry the ruleset key, and only the
 * ruleset's are reachable, as on the ruleset REST mirror. A tool with no
 * row in the operation table fails the build.
 *
 * `roleLevel` is the caller's role on the lens (`access/authorize.ts`
 * `lensLevel`): every call first checks its operation against it, so a
 * Reader's write, or a Proposer's direct write or commit, is refused as
 * forbidden. The list keeps only what `listedRoleLevel` allows too, and
 * the tools are described at the lower of it and the binding's level; a
 * tool call's server lists at `full`, so a refused call is refused by the
 * check, not unknown.
 */
export function createRuntimeMcpServer(
  ontologyKey: string,
  lensKey: string,
  binding: Binding = PLAIN_LENS,
  roleLevel: WriteAccess = "full",
  listedRoleLevel: WriteAccess = roleLevel,
): McpServer {
  const server = new McpServer({ name: "OntoForge Runtime", version: "0.1.0" });
  const { rulesetKey } = binding;

  const openStore = async (operation: Operation): Promise<RuntimeStore> => {
    const store = await getRuntimeStore(ontologyKey);
    if (rulesetKey !== null) {
      const record = await readMountRuleset(lensKey, rulesetKey, store);
      checkOperation({ rulesetKey, writeAccess: record.writeAccess }, operation);
    }
    return store;
  };
  const tool: ToolFactory = (name, fn) => {
    toolOperation(name, {}); // a tool without a row throws here
    return wrap(name, (args) => {
      checkRole(lensKey, roleLevel, toolOperation(name, args));
      return fn(args, () => openStore(toolOperation(name, args)));
    });
  };
  // Every tool is built, so a missing row fails at any level; the list
  // keeps the ones both the binding's level and the caller's role allow.
  const lists = (name: string): boolean =>
    listsTool(binding.writeAccess, name) && listsTool(listedRoleLevel, name);
  const register: Register = (name, config, cb) => {
    const registered = server.registerTool(name, config, cb);
    if (!lists(name)) registered.remove();
    return registered;
  };

  // What the list offers: the lower of the binding's level and the caller's role.
  const offered = lower(binding.writeAccess, listedRoleLevel);

  /** The id of the entity an entity tool names (`ENTITY_ADDRESS`): an
   * identity resolved through the lens, as on the REST identity routes. */
  const entityOf = async (args: EntityArgs, store: RuntimeStore): Promise<string> => {
    if (!service.exactlyOne(args.entity_id, args.entity_identity)) throw exactlyOneOf("entity_id", "entity_identity");
    return args.entity_id ?? service.resolveEntityIdentity(lensKey, args.entity_type_key, args.entity_identity!, store);
  };

  /** Stage one write into a changeset of this lens (and ruleset). */
  const stageInto = async (open: Open, changesetId: string, write: changesets.StagedWrite): Promise<ToolResult> =>
    jsonResult(await changesets.stage(lensKey, rulesetKey, changesetId, write, await open()));
  const staged = (kind: "create" | "update" | "delete" | "edit"): string => stagedMode(kind, { rulesetKey, writeAccess: offered });
  // A level that cannot write directly only stages: every write names its changeset.
  const changesetIdParam = allows(offered, "write") ? z.string().optional() : z.string();

  if (rulesetKey !== null) {
    register(
      "get_ruleset",
      {
        description:
          "Read the ruleset of this connection: what it may write. Call this first; read it again " +
          "after a refusal, because a person sets the ruleset and may change it at any time. " +
          "Returns key, writeAccess and anchor. writeAccess 'full': every write this lens allows, " +
          "directly or through a changeset. 'propose': writes only into a changeset, so every " +
          "write needs 'changeset_id'; it can submit the changeset for review but not commit it, " +
          "a person commits it. 'none': read only, no writes; it can read changesets but not " +
          "start, stage into or submit one. The tools this connection lists follow writeAccess. " +
          "anchor null: writes are not limited to a subtree. Otherwise anchor is {type, id, name, " +
          "state, visible, path}: writes to the entity types of the anchor's hierarchy (the types " +
          "joined to it by parent relations) must stay in its subtree, the anchor entity and its " +
          "descendants; other types are written as usual. state 'found': the anchor entity " +
          "exists. state 'deleted': the anchor entity no longer exists, so every write is " +
          "refused, staged or not, until a person sets a new anchor. visible false: this lens " +
          "does not show the anchor entity, so every write is refused. When the anchor entity is " +
          "deleted or not visible, type, id and name are null and path is empty. path lists the " +
          "anchor entity's visible ancestors, root first, ending with the entity. Read-only.",
        inputSchema: {},
      },
      tool("get_ruleset", async () =>
        jsonResult(await getRulesetView(lensKey, rulesetKey, await getRuntimeStore(ontologyKey))),
      ),
    );
  }

  register(
    "get_schema",
    {
      description:
        "Understand the lens before creating data. Shows available entity types, " +
        "relation types, and their property definitions including data types and " +
        "required flags. A relation type's `parent` names the end (`source` or " +
        "`target`) whose entity is the parent of the entity at the other end; null " +
        "means an ordinary relation." +
        (rulesetKey === null ? " Call this first." : " Call this after get_ruleset."),
      inputSchema: {},
    },
    tool("get_schema", async (_args, open) => {
      const result = await service.getLensSchema(lensKey, await open());
      return jsonResult(result);
    }),
  );

  register(
    "create_entity",
    {
      description:
        "Create a new entity instance. Properties must conform to the schema — " +
        "required properties must be present, types must match the property " +
        "definitions. To place the new entity in a hierarchy in the same call, pass " +
        "'parent_relation': 'type' is a parent relation type (one whose `parent` " +
        "names the parent end) whose child end is this entity type; 'parent_id' is " +
        "the parent, which must exist with the entity type at the parent end ('parent_identity' " +
        "names it by its identity instead, exactly one of the two); " +
        "'properties' are the relation's own, held to the same rules as entity " +
        "properties. Its faults are reported together with the entity's, and the " +
        "entity and its parent relation are stored together or not at all." +
        (rulesetKey === null
          ? ""
          : " If this connection's ruleset sets an anchor, an entity of a type in the anchor's " +
            "hierarchy must be created with 'parent_relation', and its parent must be in the " +
            "anchor's subtree: the anchor entity or one of its descendants. A hierarchy type this " +
            "lens shows no parent relation into cannot be created here. Entities of other types " +
            "are created as usual, 'parent_relation' optional.") +
        staged("create") +
        " With 'parent_relation' and 'changeset_id', two objects are staged, the entity and its " +
        "parent relation, and the answer is {id, relation: {id}}; the relation is a staged " +
        "relation like any other, which later writes may name.",
      inputSchema: {
        entity_type_key: z.string(),
        properties: z.record(z.string(), z.unknown()),
        parent_relation: z
          .object({
            type: z.string(),
            parent_id: z.string().optional(),
            parent_identity: z.string().optional(),
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
          | {
              type: string;
              parent_id?: string | undefined;
              parent_identity?: string | undefined;
              properties?: Record<string, unknown> | undefined;
            }
          | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        const parent = args.parent_relation;
        const parentRelation =
          parent === undefined
            ? null
            : {
                type: parent.type,
                parentId: parent.parent_id,
                parentIdentity: parent.parent_identity,
                properties: parent.properties,
              };
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
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
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

  register(
    "get_entity",
    {
      description:
        "Retrieve a specific entity by its _id. Use 'fields' to select which " +
        "properties to include — only listed fields plus _id are returned. " +
        "Omit for all fields. Document properties appear as " +
        '{"document": true, "length": N} stubs — read their content with the ' +
        "get_document tool." + ENTITY_ADDRESS,
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        fields: z.array(z.string()).optional(),
      },
    },
    tool(
      "get_entity",
      async (args: {
        entity_type_key: string;
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        fields?: string[] | undefined;
      }, open) => {
        const store = await open();
        const result = await service.getEntity(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          store,
          args.fields ?? null,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "get_path",
    {
      description:
        "Read where an entity sits in its hierarchy: its path over the parent " +
        "relations as [{type, id, name}], root first and ending with the entity " +
        "itself. A root's path is the entity alone. The path starts below the " +
        "nearest ancestor this connection cannot see, so it names only visible " +
        "entities. name is null when the entity has no name value." + ENTITY_ADDRESS,
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
      },
    },
    tool("get_path", async (args: EntityArgs, open) => {
      const store = await open();
      const result = await service.getPath(lensKey, args.entity_type_key, await entityOf(args, store), store);
      return jsonResult(result);
    }),
  );

  register(
    "get_document",
    {
      description:
        "Read (a slice of) a document property's content. Document properties " +
        "hold large Markdown text and are stubbed by default in other tools " +
        '— they appear as {"document": true, "length": N} stubs. ' +
        "'offset' and 'limit' are character-based; omit both to read the full " +
        "document. Use the charOffset/charLength from a search hit's " +
        "matches, or from a search_by_index passage's matched, to read exactly the matching passage." + ENTITY_ADDRESS,
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        property_key: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    tool(
      "get_document",
      async (args: {
        entity_type_key: string;
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        property_key: string;
        offset?: number | undefined;
        limit?: number | undefined;
      }, open) => {
        const offset = Math.max(0, args.offset ?? 0);
        const limit =
          args.limit === undefined || args.limit === null ? null : Math.max(1, args.limit);
        const store = await open();
        const result = await service.getDocument(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          args.property_key,
          offset,
          limit,
          store,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "update_entity",
    {
      description:
        "Partial update — only provided properties change. Set a property to null " +
        "to remove it (fails for required properties). Document properties are " +
        "replaced whole here — prefer edit_document / write_document for partial edits " +
        "inside a document." +
        ENTITY_ADDRESS +
        staged("update"),
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        properties: z.record(z.string(), z.unknown()),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "update_entity",
      async (args: {
        entity_type_key: string;
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        properties: Record<string, unknown>;
        changeset_id?: string | undefined;
      }, open) => {
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "update_entity",
            typeKey: args.entity_type_key,
            id: args.entity_id,
            identity: args.entity_identity,
            properties: args.properties,
          });
        }
        const store = await open();
        const result = await service.updateEntity(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          args.properties,
          store,
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "edit_document",
    {
      description:
        "Edit a document property by exact string replacement — the preferred " +
        "way to change part of a document. old_string must match the current " +
        "content exactly and uniquely; if it matches more than once, provide a " +
        "longer string with surrounding context, or set replace_all to true to " +
        "replace every occurrence. Returns the new totalLength, the edited " +
        "range, and ~200 chars of context around the edit for verification." +
        ENTITY_ADDRESS +
        staged("edit"),
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        property_key: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "edit_document",
      async (args: {
        entity_type_key: string;
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        property_key: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        const edit: service.DocumentEditBody = {
          op: "str_replace",
          oldString: args.old_string,
          newString: args.new_string,
          replaceAll: args.replace_all ?? false,
        };
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "edit_document",
            typeKey: args.entity_type_key,
            id: args.entity_id,
            identity: args.entity_identity,
            propertyKey: args.property_key,
            edit,
          });
        }
        const store = await open();
        const result = await service.editDocument(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          args.property_key,
          edit,
          store,
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "write_document",
    {
      description:
        "Overwrite a character range of a document property: replaces " +
        "[offset, offset+length) with content. Insert with length=0; append " +
        "with offset=totalLength and length=0. Offsets pair with get_document " +
        "reads and the charOffset/charLength of search matches. Pass " +
        "'expect' (the text currently in the range) to fail safely if the " +
        "document changed since it was read. Returns the new totalLength, the " +
        "edited range, and ~200 chars of context around the edit." +
        ENTITY_ADDRESS +
        staged("edit"),
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        property_key: z.string(),
        offset: z.number(),
        length: z.number(),
        content: z.string(),
        expect: z.string().optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "write_document",
      async (args: {
        entity_type_key: string;
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        property_key: string;
        offset: number;
        length: number;
        content: string;
        expect?: string | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        const edit: service.DocumentEditBody = {
          op: "replace_range",
          offset: args.offset,
          length: args.length,
          content: args.content,
          expect: args.expect ?? null,
        };
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "edit_document",
            typeKey: args.entity_type_key,
            id: args.entity_id,
            identity: args.entity_identity,
            propertyKey: args.property_key,
            edit,
          });
        }
        const store = await open();
        const result = await service.editDocument(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          args.property_key,
          edit,
          store,
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "delete_entity",
    {
      description:
        "Delete an entity and all its connected relations. In an ontology with parent " +
        "relations (relation types whose `parent` names the parent end), an entity that " +
        "still has children is refused: delete its children first, bottom-up. A leaf, " +
        "or any entity in an ontology without parent relations, goes with its relations." +
        ENTITY_ADDRESS +
        staged("delete") +
        " A staged entity delete also takes out every relation staged in the changeset at that " +
        "entity, and the answer lists their ids as cascaded.",
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool("delete_entity", async (args: EntityArgs & { changeset_id?: string | undefined }, open) => {
      if (args.changeset_id !== undefined) {
        return stageInto(open, args.changeset_id, {
          operation: "delete_entity",
          typeKey: args.entity_type_key,
          id: args.entity_id,
          identity: args.entity_identity,
        });
      }
      const store = await open();
      const entityId = await entityOf(args, store);
      await service.deleteEntity(lensKey, args.entity_type_key, entityId, store, rulesetKey);
      // This tool returns a message OBJECT, unlike the modeling delete
      // tools, which return bare strings. Wire contract — do not unify.
      return jsonResult({ message: `Entity '${args.entity_identity ?? entityId}' deleted successfully.` });
    }),
  );

  register(
    "create_relation",
    {
      description:
        "Create a relation between two entities. The entity types must match the " +
        "relation type's source/target definition. For a parent relation (a relation " +
        "type whose `parent` names the parent end), every entity has at most one parent " +
        "across all parent relations and the hierarchy has no cycles: the create is " +
        "refused when the child end already has a parent, or when the parent end is the " +
        "child itself or one of its descendants. For a relation type with `onePerPair`, the " +
        "create is refused when a relation of the type already links this source to this " +
        "target. Name each end by its id ('from_entity_id', " +
        "'to_entity_id') or by its identity ('from_entity_identity', 'to_entity_identity'), " +
        "exactly one per end; prefer the identity when the end's type has one." +
        staged("create"),
      inputSchema: {
        relation_type_key: z.string(),
        from_entity_id: z.string().optional(),
        to_entity_id: z.string().optional(),
        from_entity_identity: z.string().optional(),
        to_entity_identity: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        changeset_id: changesetIdParam,
      },
    },
    tool(
      "create_relation",
      async (args: {
        relation_type_key: string;
        from_entity_id?: string | undefined;
        to_entity_id?: string | undefined;
        from_entity_identity?: string | undefined;
        to_entity_identity?: string | undefined;
        properties?: Record<string, unknown> | undefined;
        changeset_id?: string | undefined;
      }, open) => {
        const ends = {
          fromEntityId: args.from_entity_id,
          toEntityId: args.to_entity_id,
          fromEntityIdentity: args.from_entity_identity,
          toEntityIdentity: args.to_entity_identity,
        };
        if (args.changeset_id !== undefined) {
          return stageInto(open, args.changeset_id, {
            operation: "create_relation",
            typeKey: args.relation_type_key,
            ...ends,
            properties: args.properties ?? {},
          });
        }
        const result = await service.createRelation(
          lensKey,
          args.relation_type_key,
          ends,
          args.properties ?? {},
          await open(),
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
    "list_relations",
    {
      description:
        "List relations of a type, optionally only those from or to one entity " +
        "(from_entity_id, to_entity_id, or by identity from_entity_identity, to_entity_identity; " +
        "not both of a pair). " +
        filterRules({ contains: true, relations: false }) +
        " The properties are the relation's own.",
      inputSchema: {
        relation_type_key: z.string(),
        from_entity_id: z.string().optional(),
        to_entity_id: z.string().optional(),
        from_entity_identity: z.string().optional(),
        to_entity_identity: z.string().optional(),
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
        from_entity_identity?: string | undefined;
        to_entity_identity?: string | undefined;
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
          {
            fromEntityId: args.from_entity_id,
            toEntityId: args.to_entity_id,
            fromEntityIdentity: args.from_entity_identity,
            toEntityIdentity: args.to_entity_identity,
          },
          strFilters,
          await open(),
        );
        return jsonResult(result);
      },
    ),
  );

  register(
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

  register(
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
          rulesetKey,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
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
        rulesetKey,
      );
      return jsonResult({ message: `Relation '${args.relation_id}' deleted successfully.` });
    }),
  );

  register(
    "get_neighbors",
    {
      description:
        "Explore an entity's local neighborhood — discover what it's connected to " +
        "and how. Returns the center entity plus all connected entities with their " +
        "connecting relations. Use 'fields' to project entity properties (neighbor " +
        "entities always include _entityTypeKey). Use 'relation_fields' to project " +
        "relation properties." + ENTITY_ADDRESS,
      inputSchema: {
        entity_type_key: z.string(),
        entity_id: z.string().optional(),
        entity_identity: z.string().optional(),
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
        entity_id?: string | undefined;
        entity_identity?: string | undefined;
        direction?: string | undefined;
        relation_type_key?: string | undefined;
        limit?: number | undefined;
        fields?: string[] | undefined;
        relation_fields?: string[] | undefined;
      }, open) => {
        const limit = clamp(args.limit ?? 50, 1, 200);
        const store = await open();
        const result = await service.getNeighbors(
          lensKey,
          args.entity_type_key,
          await entityOf(args, store),
          args.direction ?? "both",
          args.relation_type_key ?? null,
          limit,
          store,
          args.fields ?? null,
          args.relation_fields ?? null,
        );
        return jsonResult(result);
      },
    ),
  );

  register(
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

  register(
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
    register(
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

  register(
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

  register(
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

  register(
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

  register(
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

  registerChangesetTools(register, lists, lensKey, { rulesetKey, writeAccess: offered }, tool);

  return server;
}

/** Who reaches a changeset through this mount. */
function reach(rulesetKey: string | null): string {
  return rulesetKey !== null
    ? " A changeset_id not started through this ruleset, or committed, discarded or expired, is not found."
    : " A changeset_id this lens does not hold (started through another lens, committed, discarded or expired) is not found.";
}

/** The fields of a changeset in every answer. */
const CHANGESET_FIELDS = "id, number, state, version, note, ruleset, objectCount, createdAt, lastChangeAt and submittedAt";

/** The checks without a lock that submit and commit run first. */
const LOCK_FREE_CHECKS =
  "every updated target still exists, no stored value an update replaces has changed since " +
  "its before was recorded, every end of a staged relation is stored or created in this " +
  "changeset and not deleted in it, and this lens still shows every type and property and " +
  "accepts every value, a create's required ones included";

/** How a violation names what it concerns. */
const VIOLATIONS =
  "its violations (total, then the first 100, each with object, the staged object's id or null " +
  "for the whole changeset, property when it concerns one value, kind and message)";

/**
 * The ten changeset tools: the same service functions as the REST routes,
 * through this mount's lens and ruleset, listed as the level allows
 * (`lists`) and described at `binding`'s level, the one the list offers.
 */
function registerChangesetTools(
  register: Register,
  lists: (name: string) => boolean,
  lensKey: string,
  binding: Binding,
  tool: ToolFactory,
): void {
  const { rulesetKey } = binding;

  register(
    "start_changeset",
    {
      description:
        "Start a changeset: a plan of changes to this lens's data, staged over any time and " +
        "committed later, all or nothing. note: optional, at most 1,000 characters, for whoever " +
        `reviews the plan. Returns the changeset: ${CHANGESET_FIELDS}; state is 'draft'. Next, ` +
        "stage writes by passing its id as 'changeset_id' to create_entity, update_entity, " +
        "delete_entity, create_relation, update_relation, delete_relation, edit_document or " +
        "write_document; reads never see staged data. The changeset is a set, not a history: " +
        "one staged object per entity or relation it touches, with its action (create, update " +
        "or delete) and one staged value per property, each later write merged in. It holds at " +
        `most 10,000 staged objects, and at most ${settings.CHANGESET_MAX_BYTES} bytes of staged ` +
        "values as JSON, document text included. A draft changeset left unchanged for 7 days " +
        "expires and is deleted." +
        (rulesetKey !== null
          ? " It carries this connection's ruleset: it is reached only through this ruleset, or " +
            "through the lens without a ruleset, and if the ruleset sets an anchor, its commit " +
            "keeps every write in the anchor's subtree."
          : " Only connections to this lens without a ruleset reach it."),
      inputSchema: { note: z.string().optional() },
    },
    tool("start_changeset", async (args: { note?: string | undefined }, open) =>
      jsonResult(await changesets.startChangeset(lensKey, rulesetKey, args.note, await open())),
    ),
  );

  register(
    "list_changesets",
    {
      description:
        "List the changesets of this lens" +
        (rulesetKey !== null ? " started through this ruleset" : ", those started through a ruleset included") +
        ", by number, lowest first. Each has id, number (what people call it by: one more than the " +
        "lens's highest when it started; a freed number is given again, and the tools take only " +
        "the id), state ('draft': open " +
        "for staging; 'submitted': frozen and handed over for review), version, note, ruleset " +
        "(the key of the ruleset it was started through, or null), objectCount, operations (staged " +
        "objects counted per '<action>_<kind>', the action create, update or delete and the kind " +
        "entity or relation), types (the type keys its " +
        "objects name that this lens shows), notVisible (how many type keys its objects name " +
        "that this lens no longer shows), " +
        "createdAt, lastChangeAt and submittedAt. A changeset leaves the list when it is " +
        "committed or discarded, or when it expires after 7 days unchanged as a draft. A " +
        "submitted changeset can be neither discarded nor expire, so one that left the list " +
        "was committed.",
      inputSchema: {},
    },
    tool("list_changesets", async (_args, open) =>
      jsonResult(await changesets.listChangesets(lensKey, rulesetKey, await open())),
    ),
  );

  register(
    "get_changeset",
    {
      description:
        "Read a changeset and one page of its staged objects, in the order they were first " +
        "touched: offset (default 0) and limit (default 100, 1–500). Returns " +
        `${CHANGESET_FIELDS}, offset, limit and objects. Each object has id (the entity or ` +
        "relation), kind (entity or relation), type, action (create, update or delete), " +
        "firstTouchedAt, markers and values; an entity adds name, a relation from and to {id, " +
        "name}. values lists its staged values [{property, before, current, after, markers}]: " +
        "after is the staged value (null removes the property); on an update, before is the " +
        "stored value when the property was first staged (or last rebased) and current the " +
        "stored value now, null when absent or the target is gone; on a create both are null; " +
        "a delete has no values. markers [{kind, message}] say what would reject the commit " +
        "now, the hierarchy rules aside. On a value: drift (current differs from before: " +
        (lists("rebase") ? "compare them, then rebase to keep your value, or unstage it" : "compare them") +
        "), replay (a value this lens no longer accepts). On the object: missing (the target " +
        "of an update is gone), " +
        "dangling (an end of a relation is neither stored nor created in this changeset, or " +
        "deleted in it), not_visible (this lens no longer shows its type or a property it " +
        "sets), replay (a value a create requires is missing). Document values in before, " +
        "current and after show as {document: true, length}; get_staged_document reads the " +
        "staged text. Everything is shown through this lens as it is now: what it hides is " +
        "left out, and an object of a type it no longer shows keeps only id, kind, action, " +
        "firstTouchedAt and markers." +
        (lists("commit_changeset") ? " To commit exactly what you read, pass version as expected_version to commit_changeset." : "") +
        reach(rulesetKey),
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
            rulesetKey,
            args.changeset_id,
            Math.max(0, Math.trunc(args.offset ?? 0)),
            clamp(Math.trunc(args.limit ?? 100), 1, 500),
            await open(),
          ),
        ),
    ),
  );

  register(
    "get_staged_document",
    {
      description:
        "Read the text a commit of a changeset would leave in one document property: its staged " +
        "value, on an entity stored or created in this changeset. A staged document value is " +
        "always the whole new text; a staged null reads as empty. get_changeset shows document " +
        "values only as {document: true, length}. 'offset' and 'limit' are character-based, as " +
        "in get_document; omit both to read the whole text. Returns propertyKey, content, " +
        "offset, length (of content) and totalLength. Not found when the changeset stages no " +
        "value of that property, when it deletes the entity, or when this lens does not show " +
        "the entity type or the property." +
        reach(rulesetKey),
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
            rulesetKey,
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

  register(
    "unstage",
    {
      description:
        "Take one staged object out of a draft changeset, with all its staged values, by its " +
        "object_id (the id of the entity or relation); with 'property', cut out only that one " +
        "staged value, and an update left without values goes too. Its version goes up. Nothing " +
        "else changes: a staged relation at an entity whose create was taken out is dangling, " +
        "and a create without a value it requires fails replay, until they are fixed too. " +
        "Taking out a delete brings back nothing it dropped. A submitted changeset refuses it. " +
        "An object or value the changeset does not stage is not found." +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string(), object_id: z.string(), property: z.string().optional() },
    },
    tool(
      "unstage",
      async (args: { changeset_id: string; object_id: string; property?: string | undefined }, open) => {
        await changesets.unstage(
          lensKey,
          rulesetKey,
          args.changeset_id,
          args.object_id,
          args.property ?? null,
          await open(),
        );
        return jsonResult({
          message:
            args.property === undefined
              ? `Staged object '${args.object_id}' removed from changeset '${args.changeset_id}'.`
              : `Staged value '${args.property}' of '${args.object_id}' removed from changeset '${args.changeset_id}'.`,
        });
      },
    ),
  );

  register(
    "rebase",
    {
      description:
        "Accept the stored values now for a staged update of a stored entity or relation in a " +
        "draft changeset: the before of each of its staged values named in 'properties' (all " +
        "of them when omitted) becomes the stored value now, and the staged values stay. Use it " +
        "on drift, after comparing before and current, to keep your value over the change made " +
        "meanwhile. Its version goes up. Refused for a create or a delete, and by a submitted " +
        "changeset; an object, a value or a target that is gone is not found. Returns the object " +
        "as get_changeset shows it." +
        reach(rulesetKey),
      inputSchema: {
        changeset_id: z.string(),
        object_id: z.string(),
        properties: z.array(z.string()).optional(),
      },
    },
    tool(
      "rebase",
      async (args: { changeset_id: string; object_id: string; properties?: string[] | undefined }, open) =>
        jsonResult(
          await changesets.rebase(
            lensKey,
            rulesetKey,
            args.changeset_id,
            args.object_id,
            args.properties ?? null,
            await open(),
          ),
        ),
    ),
  );

  register(
    "submit_changeset",
    {
      description:
        "Hand a draft changeset over for review: it is frozen (no staging, unstaging, rebasing " +
        "or discarding) until it is committed or unsubmitted, and its version goes up. note: " +
        "optional, at most 1,000 characters; it replaces the stored note, and without it the " +
        "note stays. First, with no lock taken, every staged object is checked: " +
        LOCK_FREE_CHECKS +
        `. Any fault refuses the submit, naming ${VIOLATIONS}, and the changeset stays a ` +
        "draft. The hierarchy rules" +
        (rulesetKey !== null ? " and the anchor's subtree" : "") +
        " are checked only at commit and by check_changeset. Also refused when the changeset is already submitted, " +
        "when it changed during the submit, or when its ruleset's anchor entity no longer exists " +
        `or this lens does not show it. Returns the changeset: ${CHANGESET_FIELDS}; state is 'submitted'.` +
        (lists("commit_changeset")
          ? ""
          : ` This connection has write access '${binding.writeAccess}' and cannot commit: submitting hands the ` +
            "changeset to a person, who commits it or sends it back.") +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string(), note: z.string().optional() },
    },
    tool("submit_changeset", async (args: { changeset_id: string; note?: string | undefined }, open) =>
      jsonResult(
        await changesets.submitChangeset(lensKey, rulesetKey, args.changeset_id, args.note, await open()),
      ),
    ),
  );

  register(
    "unsubmit_changeset",
    {
      description:
        "Send a submitted changeset back: it is a draft again with its staged objects kept, so " +
        (lists("commit_changeset")
          ? "it can be staged into, unstaged from, rebased, discarded, submitted or committed " +
            "again; its version goes up. "
          : "it can be staged into, unstaged from, rebased, discarded or submitted again; its " +
            "version goes up. ") +
        "note: required, not blank, at most 1,000 characters; it replaces the stored note, so " +
        "say what should change. A draft changeset is refused." +
        (rulesetKey !== null ? " It works while the ruleset's anchor entity no longer exists." : "") +
        ` Returns the changeset: ${CHANGESET_FIELDS}; state is 'draft'.` +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string(), note: z.string() },
    },
    tool("unsubmit_changeset", async (args: { changeset_id: string; note: string }, open) =>
      jsonResult(
        await changesets.unsubmitChangeset(lensKey, rulesetKey, args.changeset_id, args.note, await open()),
      ),
    ),
  );

  register(
    "check_changeset",
    {
      description:
        "Try a commit of a changeset, draft or submitted, without persisting anything: it runs " +
        "every check and every write of a commit, then rolls all of it back. Nothing " +
        "changes, the changeset's version and last change included. Passed, it returns " +
        "{version, committed, alreadyGone}: the version checked, the number of staged objects " +
        "a commit would persist and the ids of deletes already done. Failed, it names " +
        `${VIOLATIONS} and the version checked, exactly as a commit of that version would be ` +
        "rejected; a commit can still differ when the changeset or the data change meanwhile. " +
        "Refused while another commit or check runs on this ontology or the changeset is busy: " +
        "try again." +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string() },
    },
    tool("check_changeset", async (args: { changeset_id: string }, open) =>
      jsonResult(await changesets.checkChangeset(lensKey, rulesetKey, args.changeset_id, await open())),
    ),
  );

  register(
    "commit_changeset",
    {
      description:
        "Persist every staged object of a changeset, draft or submitted, all or nothing, " +
        "entity creates first and entity deletes last; committing a submitted changeset " +
        "approves it. expected_version: optional, the version you reviewed; if the changeset " +
        "changed since, the commit is refused and " +
        "nothing is written. Omitted, the current version commits. Checked first: " +
        LOCK_FREE_CHECKS +
        ". Then, on the result: every entity has at most one parent, no cycles, relation ends " +
        "of the right types, no entity deleted while it keeps children" +
        (rulesetKey !== null
          ? ", and, if this connection's ruleset sets an anchor, every staged object in the " +
            "anchor's subtree; a deleted ruleset, or an anchor entity that no longer exists, rejects the commit"
          : ", and for a changeset started through a ruleset that sets an anchor, every staged " +
            "object in the anchor's subtree; a deleted ruleset, or an anchor entity that no longer " +
            "exists, rejects it") +
        `. A rejection names ${VIOLATIONS}; nothing is persisted and the changeset stays as it ` +
        "was, draft or submitted. On drift, compare before and current in get_changeset, then " +
        "rebase to keep your value or unstage it. Refused with nothing persisted while another " +
        "commit runs on this ontology or the changeset is busy: try again. Committed, it " +
        "returns {committed, alreadyGone}, the number of staged objects and the ids of deletes " +
        "already done, and the changeset is gone. If the response is lost, tell the " +
        "outcome by reading an id a staged create minted, or by listing the changesets: a " +
        "submitted changeset that is no longer listed was committed, and one still listed is " +
        "not committed." +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string(), expected_version: z.number().int().optional() },
    },
    tool("commit_changeset", async (args: { changeset_id: string; expected_version?: number | undefined }, open) =>
      jsonResult(
        await changesets.commitChangeset(
          lensKey,
          rulesetKey,
          args.changeset_id,
          args.expected_version,
          await open(),
        ),
      ),
    ),
  );

  register(
    "discard_changeset",
    {
      description:
        "Delete a draft changeset and all its staged objects; the data is not touched, and it " +
        "cannot be undone. A submitted changeset is refused until it is unsubmitted." +
        reach(rulesetKey),
      inputSchema: { changeset_id: z.string() },
    },
    tool("discard_changeset", async (args: { changeset_id: string }, open) => {
      await changesets.discardChangeset(lensKey, rulesetKey, args.changeset_id, await open());
      return jsonResult({ message: `Changeset '${args.changeset_id}' discarded.` });
    }),
  );
}
