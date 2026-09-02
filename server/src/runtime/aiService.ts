/**
 * AI-powered runtime operations (`docs/capabilities/ai-agents.md`): ask,
 * extract, chat, agent discovery, and A2A cards and tasks. The engine is
 * LangChain.js / LangGraph.js (approved stack).
 *
 * Each operation builds a fresh agent per request with a scoped tool
 * subset. Tools invoke the same runtime service functions the MCP tools
 * use — no HTTP hop. A tool failure that is a not-found or validation
 * error is returned to the model as the tool's result so it can correct
 * itself and retry (`docs/capabilities/oql.md#self-correction-hints`);
 * any other error aborts the run.
 */

import { randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool, ToolInputParsingException, type StructuredToolInterface } from "@langchain/core/tools";
import { ToolNode, createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

import { DEFAULT_AGENT_CONFIG, getAiModel, type AgentConfig } from "../core/ai.js";
import { valueToText } from "../core/dataTypes.js";
import { getEmbeddingProvider } from "../core/embedding.js";
import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { RuntimeStore } from "../core/ports.js";
import { loadSchema, type SchemaCacheValue } from "./schemaCache.js";
import * as service from "./service.js";
import {
  TOOL_EXECUTE_QUERY,
  TOOL_GET_ENTITY,
  TOOL_GET_NEIGHBORS,
  TOOL_GET_SCHEMA,
  TOOL_LIST_ENTITIES,
  TOOL_LIST_RELATIONS,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_SAVED_QUERIES,
  TOOL_SEMANTIC_SEARCH,
} from "./toolNames.js";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tool allowlists — controls which tools each AI feature can use
// ---------------------------------------------------------------------------

export const QUERY_TOOLS = [TOOL_EXECUTE_QUERY];
export const CHAT_TOOLS = [
  TOOL_GET_SCHEMA,
  TOOL_LIST_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_LIST_RELATIONS,
  TOOL_GET_NEIGHBORS,
  TOOL_SEMANTIC_SEARCH,
  TOOL_EXECUTE_QUERY,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_SAVED_QUERIES,
];

const EMBEDDING_TOOLS: ReadonlySet<string> = new Set([
  TOOL_SEMANTIC_SEARCH,
  TOOL_SEARCH_SAVED_QUERIES,
]);

// ---------------------------------------------------------------------------
// Schema description builder (for system prompts)
// ---------------------------------------------------------------------------

/** Build a concise text description of the scoped schema for the LLM. */
export function describeSchema(schema: SchemaCacheValue): string {
  const lines = [`Lens: ${schema.lensName} (key: ${schema.lensKey})`];
  if (schema.lensDescription) {
    lines.push(`Description: ${schema.lensDescription}`);
  }

  lines.push("\nSystem properties (available on all entities and relations):");
  lines.push("  - _id: string (unique identifier)");
  lines.push("  - _createdAt: datetime");
  lines.push("  - _updatedAt: datetime");

  lines.push("\nEntity types:");
  for (const et of Object.values(schema.entityTypes)) {
    let desc = `  - ${et.key}`;
    if (et.description) {
      desc += `: ${et.description}`;
    }
    lines.push(desc);
    for (const p of Object.values(et.properties)) {
      const req = p.required ? " (required)" : "";
      lines.push(`    - ${p.key}: ${p.dataType}${req}`);
      if (p.description) {
        lines.push(`      ${p.description}`);
      }
    }
  }

  lines.push("\nRelation types:");
  for (const rt of Object.values(schema.relationTypes)) {
    let desc = `  - ${rt.key}: ${rt.fromEntityTypeKey} -> ${rt.toEntityTypeKey}`;
    if (rt.description) {
      desc += ` (${rt.description})`;
    }
    lines.push(desc);
    for (const p of Object.values(rt.properties)) {
      const req = p.required ? " (required)" : "";
      lines.push(`    - ${p.key}: ${p.dataType}${req}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definitions — instantiated selectively per run
// ---------------------------------------------------------------------------

/** One recorded tool invocation: the call as the model made it, plus the
 * value handed back (a domain error becomes an `{error}` result). */
export interface ToolCallRecord {
  tool: string;
  args: Row;
  result?: unknown;
}

interface AgentToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (lensKey: string, store: RuntimeStore, args: Row) => Promise<unknown>;
}

const clampLimit = (limit: unknown, fallback: number, max: number): number =>
  Math.min(typeof limit === "number" ? limit : fallback, max);

const AGENT_TOOL_DEFS: AgentToolDef[] = [
  {
    name: TOOL_GET_SCHEMA,
    description:
      "Get the full lens schema including entity types, relation types, " +
      "and their property definitions with data types and required flags. " +
      "Call this if you need to verify available types or properties.",
    schema: z.object({}),
    run: async (lensKey, store) => {
      const loaded = await loadSchema(lensKey, store);
      return describeSchema(loaded.scoped);
    },
  },
  {
    name: TOOL_LIST_ENTITIES,
    description:
      "List entities of a type with optional filtering and search. " +
      "Use 'search' to match a term across ALL string properties at once. " +
      "Use 'filters' to filter on specific properties: exact match " +
      '("name": "Alice"), greater than ("age__gt": "25"), greater or equal ' +
      '("__gte"), less than ("__lt"), less or equal ("__lte"), contains ' +
      '("name__contains": "ali"). All filter values must be strings. ' +
      "A filter key may also reach through ONE relation type, which answers a " +
      "question about connections in a single call — use it instead of listing " +
      "relations and matching ids by hand. Write the relation type key, then a " +
      "dot for a property of the entity at the other end, or an at sign for a " +
      'property of the relation itself. Listing person: ("works_for.name": ' +
      '"Acme") are the people employed by Acme, ("works_for@role": "CTO") those ' +
      'whose employment role is CTO, ("works_for@since__gte": "2021-01-01") ' +
      "those employed since 2021. The direction follows the relation type's " +
      "endpoints, so it needs no marker. A relation type that joins one type to " +
      "itself is the exception: there the direction cannot be derived, and the " +
      "error tells you which marker to add.",
    schema: z.object({
      entity_type_key: z.string(),
      search: z.string().nullish(),
      filters: z.record(z.string(), z.string()).nullish(),
      limit: z.number().int().nullish(),
    }),
    run: async (lensKey, store, args) =>
      service.listEntities(
        lensKey,
        args.entity_type_key as string,
        clampLimit(args.limit, 20, 50),
        0,
        "_createdAt",
        "asc",
        (args.search as string | null | undefined) ?? null,
        (args.filters as Record<string, string> | null | undefined) ?? {},
        store,
      ),
  },
  {
    name: TOOL_GET_ENTITY,
    description: "Retrieve a specific entity by its _id. Returns all properties.",
    schema: z.object({
      entity_type_key: z.string(),
      entity_id: z.string(),
    }),
    run: async (lensKey, store, args) =>
      service.getEntity(
        lensKey,
        args.entity_type_key as string,
        args.entity_id as string,
        store,
      ),
  },
  {
    name: TOOL_LIST_RELATIONS,
    description:
      "List relations of a type. Each result includes _id, source and target " +
      "entity IDs, and relation properties.",
    schema: z.object({
      relation_type_key: z.string(),
      limit: z.number().int().nullish(),
    }),
    run: async (lensKey, store, args) =>
      service.listRelations(
        lensKey,
        args.relation_type_key as string,
        clampLimit(args.limit, 20, 50),
        0,
        "_createdAt",
        "asc",
        null,
        null,
        {},
        store,
      ),
  },
  {
    name: TOOL_GET_NEIGHBORS,
    description:
      "Explore an entity's connections. Returns the entity plus all connected " +
      "entities with their connecting relations. Use this to answer 'what is X " +
      "connected to?' questions. Direction: 'outgoing', 'incoming', or 'both'.",
    schema: z.object({
      entity_type_key: z.string(),
      entity_id: z.string(),
      direction: z.string().nullish(),
      limit: z.number().int().nullish(),
    }),
    run: async (lensKey, store, args) =>
      service.getNeighbors(
        lensKey,
        args.entity_type_key as string,
        args.entity_id as string,
        (args.direction as string | null | undefined) ?? "both",
        null,
        clampLimit(args.limit, 20, 50),
        store,
      ),
  },
  {
    name: TOOL_SEMANTIC_SEARCH,
    description:
      "Search entities by semantic similarity to a natural language query. " +
      "Returns entities ranked by relevance with similarity scores. " +
      "Best for finding entities when you don't know exact property values.",
    schema: z.object({
      query: z.string(),
      entity_type_key: z.string(),
      limit: z.number().int().nullish(),
    }),
    run: async (lensKey, store, args) =>
      service.semanticSearch(
        lensKey,
        args.query as string,
        args.entity_type_key as string,
        clampLimit(args.limit, 10, 20),
        null,
        store,
      ),
  },
  {
    name: TOOL_EXECUTE_QUERY,
    description:
      "Execute a read-only OQL query (openCypher-style graph pattern syntax) " +
      "against the knowledge graph. " +
      "Use entity type keys (snake_case) as node labels and relation type keys " +
      "as relationship types. ALL node patterns MUST have a label. Only " +
      "MATCH/RETURN — no writes, no CALL. Use CONTAINS for substring matching " +
      "(not regex). If the query fails, read the error — it lists available " +
      "types and properties. " +
      "Examples: " +
      "MATCH (p:person {name: 'Alice'}) RETURN p | " +
      "MATCH (p:person)-[r:works_for]->(c:company) RETURN p.name, c.name | " +
      "MATCH (p:person) WHERE p.age > 30 RETURN p.name, p.age LIMIT 10",
    schema: z.object({
      query: z.string(),
    }),
    run: async (lensKey, store, args) =>
      service.executeQuery(lensKey, args.query as string, store),
  },
  {
    name: TOOL_LIST_SAVED_QUERIES,
    description:
      "List available saved queries with their parameters. " +
      "Each query has a key, name, description, and parameter definitions.",
    schema: z.object({}),
    run: async (lensKey, store) => {
      const loaded = await loadSchema(lensKey, store);
      return Object.values(loaded.savedQueries).map((sq) => ({
        key: sq.key,
        name: sq.name,
        description: sq.description,
        parameters: sq.parameters.map((p) => ({
          name: p.name,
          description: p.description,
          dataType: p.dataType,
        })),
      }));
    },
  },
  {
    name: TOOL_RUN_SAVED_QUERY,
    description:
      "Execute a saved query by key with parameter values. " +
      "Use list_saved_queries first to discover available queries and " +
      "their required parameters.",
    schema: z.object({
      query_key: z.string(),
      params: z.record(z.string(), z.unknown()).nullish(),
    }),
    run: async (lensKey, store, args) =>
      service.executeSavedQuery(
        lensKey,
        args.query_key as string,
        (args.params as Row | null | undefined) ?? {},
        store,
      ),
  },
  {
    name: TOOL_SEARCH_SAVED_QUERIES,
    description:
      "Search saved queries by semantic similarity to a natural language query. " +
      "Returns the most relevant saved queries ranked by how well their " +
      "description matches your query. Use this to find the right saved query " +
      "for a user's intent instead of listing all queries.",
    schema: z.object({
      query: z.string(),
    }),
    run: async (lensKey, store, args) =>
      service.searchSavedQueries(lensKey, args.query as string, 3, 0.7, store),
  },
];

const AGENT_TOOL_DEFS_BY_NAME: ReadonlyMap<string, AgentToolDef> = new Map(
  AGENT_TOOL_DEFS.map((def) => [def.name, def]),
);

/** Every instantiable tool name. */
export const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(AGENT_TOOL_DEFS_BY_NAME.keys());

/**
 * Instantiate the named tools bound to one lens and one recorder. A tool
 * failure that is a not-found or validation error becomes the tool's
 * result (`{"error": message}`) so the model self-corrects; model-supplied
 * arguments that fail the tool's schema are fed back the same way.
 * Anything else is rethrown and aborts the run.
 */
export function buildTools(
  lensKey: string,
  store: RuntimeStore,
  toolNames: string[],
  recorder: ToolCallRecord[],
): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [];
  for (const name of toolNames) {
    const def = AGENT_TOOL_DEFS_BY_NAME.get(name);
    if (def === undefined) {
      continue;
    }
    const structured = tool(
      async (args: unknown) => {
        const record: ToolCallRecord = { tool: def.name, args: (args ?? {}) as Row };
        recorder.push(record);
        let result: unknown;
        try {
          result = await def.run(lensKey, store, (args ?? {}) as Row);
        } catch (error) {
          if (error instanceof NotFoundError || error instanceof ValidationError) {
            result = { error: error.message };
          } else {
            throw error;
          }
        }
        record.result = result;
        return typeof result === "string" ? result : JSON.stringify(result);
      },
      { name: def.name, description: def.description, schema: def.schema },
    ) as StructuredToolInterface;
    tools.push(withArgumentSelfCorrection(structured, def.name, recorder));
  }
  return tools;
}

/**
 * Argument parsing happens inside the tool's `invoke`, before the handler
 * runs, so a schema-invalid tool call from the model would escape the
 * self-correction path in `buildTools` and abort the run. Catch it there
 * and return the validation failure as the tool's result instead.
 */
function withArgumentSelfCorrection(
  structured: StructuredToolInterface,
  toolName: string,
  recorder: ToolCallRecord[],
): StructuredToolInterface {
  const baseInvoke = structured.invoke.bind(structured);
  structured.invoke = async (...invokeArgs: Parameters<typeof baseInvoke>) => {
    try {
      return await baseInvoke(...invokeArgs);
    } catch (error) {
      if (!(error instanceof ToolInputParsingException)) {
        throw error;
      }
      const [input] = invokeArgs;
      const isToolCall =
        input !== null && typeof input === "object" && "args" in (input as object);
      const args = ((isToolCall ? (input as { args?: unknown }).args : input) ?? {}) as Row;
      const result = { error: `Invalid arguments for ${toolName}: ${error.message}` };
      recorder.push({ tool: toolName, args, result });
      const content = JSON.stringify(result);
      if (isToolCall) {
        return new ToolMessage({
          content,
          name: toolName,
          tool_call_id: String((input as { id?: unknown }).id ?? ""),
        });
      }
      return content;
    }
  };
  return structured;
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

/** The active model, or the FEATURE_DISABLED rejection. */
function requireModel(): BaseChatModel {
  const model = getAiModel();
  if (model === null) {
    throw new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", {
      code: "FEATURE_DISABLED",
    });
  }
  return model;
}

/** Flatten a message's content to plain text. */
function messageText(message: BaseMessage | undefined): string {
  if (message === undefined) {
    return "";
  }
  const content = message.content as unknown;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part !== null && typeof part === "object" && (part as Row).type === "text") {
          return String((part as Row).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

// A budget of roughly 50 model calls: one LangGraph step per model call
// plus one per tool batch.
const RECURSION_LIMIT = 100;

/**
 * One ReAct-style run: system prompt, the given messages, the given tools.
 * Tool errors outside the self-correction paths abort (`handleToolErrors`
 * off — the wrappers in `buildTools` already feed domain and argument
 * errors back). Returns the final reply text.
 */
async function runReactAgent(
  model: BaseChatModel,
  systemPrompt: string,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
): Promise<string> {
  if (tools.length === 0) {
    // No tools: a plain model call is the same conversation without the
    // tool loop (binding an empty toolset is rejected by providers).
    const response = await model.invoke([new SystemMessage(systemPrompt), ...messages]);
    return messageText(response);
  }
  const agent = createReactAgent({
    llm: model,
    tools: new ToolNode(tools, { handleToolErrors: false }),
    prompt: systemPrompt,
  });
  const state = await agent.invoke({ messages }, { recursionLimit: RECURSION_LIMIT });
  const finalMessages = state.messages as BaseMessage[];
  return messageText(finalMessages[finalMessages.length - 1]);
}

// ---------------------------------------------------------------------------
// Feature: NL → OQL Query
// ---------------------------------------------------------------------------

const QUERY_SYSTEM_PROMPT = `You are a query assistant for a knowledge graph.
You translate natural language questions into read-only OQL queries (openCypher-style graph pattern syntax).

RULES:
- Use entity type keys (snake_case) as node labels: e.g., person, company
- Use relation type keys (snake_case) as relationship types: e.g., works_for
- ALL node patterns MUST have a label — never use bare (n) patterns
- Only generate read queries (MATCH/RETURN) — no writes
- Use the execute_query tool to run your query
- After getting results, provide a clear natural language answer

{schema}
`;

function isPlainObject(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Translate a natural language question to OQL, execute it, and summarize. */
export async function aiQuery(
  lensKey: string,
  question: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const schemaDesc = describeSchema(loaded.scoped);
  const model = requireModel();

  const recorder: ToolCallRecord[] = [];
  const tools = buildTools(lensKey, store, QUERY_TOOLS, recorder);
  const answer = await runReactAgent(
    model,
    QUERY_SYSTEM_PROMPT.replace("{schema}", schemaDesc),
    tools,
    [new HumanMessage(question)],
  );

  // Extract the executed query and results from the recorded tool calls —
  // the last call wins.
  let queryUsed: unknown = null;
  let queryResults: unknown = null;
  for (const record of recorder) {
    if (record.tool.includes(TOOL_EXECUTE_QUERY)) {
      queryUsed = record.args.query ?? null;
      if (isPlainObject(record.result)) {
        queryResults = record.result;
      }
    }
  }

  return { answer, query: queryUsed, results: queryResults };
}

// ---------------------------------------------------------------------------
// Feature: Entity Extraction
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  entityTypeKey: string;
  properties: Row;
}

export interface ExtractedRelationEndpoint {
  entityTypeKey: string;
  match: Row;
}

export interface ExtractedRelation {
  relationTypeKey: string;
  source: ExtractedRelationEndpoint;
  target: ExtractedRelationEndpoint;
  properties: Row;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/** The structured-output contract shown to the model — the JSON schema of
 * one `ExtractionResult` endpoint, by alias. */
const EXTRACTION_ENDPOINT_SCHEMA = {
  type: "object",
  properties: {
    entityTypeKey: { type: "string" },
    match: { type: "object", additionalProperties: true },
  },
  required: ["entityTypeKey", "match"],
} as const;

const EXTRACTION_JSON_SCHEMA = {
  title: "ExtractionResult",
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityTypeKey: { type: "string" },
          properties: { type: "object", additionalProperties: true },
        },
        required: ["entityTypeKey", "properties"],
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          relationTypeKey: { type: "string" },
          source: EXTRACTION_ENDPOINT_SCHEMA,
          target: EXTRACTION_ENDPOINT_SCHEMA,
          properties: { type: "object", additionalProperties: true },
        },
        required: ["relationTypeKey", "source", "target"],
      },
    },
  },
  required: ["entities", "relations"],
} as const;

const EXTRACT_SYSTEM_PROMPT = `You are an entity extraction assistant for a knowledge graph.
Given unstructured text, extract entities and relations that match the lens schema.

RULES:
- Only extract entities whose types exist in the schema below
- Only extract relations whose types exist in the schema below
- Map properties to the correct data types defined in the schema
- For relations, provide 'match' fields that uniquely identify the source and target entities
- If a property cannot be determined from the text, omit it (unless required)
- Be precise — only extract what the text clearly states

{schema}
`;

function malformed(): never {
  throw new Error("Model returned malformed extraction output");
}

function pickKey(obj: Row, camel: string, snake: string): unknown {
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

function normalizeEndpoint(raw: unknown): ExtractedRelationEndpoint {
  if (!isPlainObject(raw)) malformed();
  const entityTypeKey = pickKey(raw, "entityTypeKey", "entity_type_key");
  const match = raw.match;
  if (typeof entityTypeKey !== "string" || !isPlainObject(match)) malformed();
  return { entityTypeKey, match };
}

/** Validate the model's raw structured output into an `ExtractionResult`.
 * Both the alias (`entityTypeKey`) and the snake_case field name
 * (`entity_type_key`) are accepted, because models emit either. */
export function normalizeExtraction(raw: unknown): ExtractionResult {
  if (!isPlainObject(raw)) malformed();
  const entitiesRaw = raw.entities ?? [];
  const relationsRaw = raw.relations ?? [];
  if (!Array.isArray(entitiesRaw) || !Array.isArray(relationsRaw)) malformed();

  const entities: ExtractedEntity[] = entitiesRaw.map((e) => {
    if (!isPlainObject(e)) malformed();
    const entityTypeKey = pickKey(e, "entityTypeKey", "entity_type_key");
    const properties = e.properties;
    if (typeof entityTypeKey !== "string" || !isPlainObject(properties)) malformed();
    return { entityTypeKey, properties };
  });

  const relations: ExtractedRelation[] = relationsRaw.map((r) => {
    if (!isPlainObject(r)) malformed();
    const relationTypeKey = pickKey(r, "relationTypeKey", "relation_type_key");
    if (typeof relationTypeKey !== "string") malformed();
    const properties = r.properties ?? {};
    if (!isPlainObject(properties)) malformed();
    return {
      relationTypeKey,
      source: normalizeEndpoint(r.source),
      target: normalizeEndpoint(r.target),
      properties,
    };
  });

  return { entities, relations };
}

/** One entity created during a persisting extraction, with the type it was
 * created as — the endpoint resolver needs both. */
interface CreatedEntity {
  entityTypeKey: string;
  entity: Row;
}

/**
 * Resolve one relation endpoint against the entities created in this call.
 *
 * The match map is a SUBSET of the entity's written properties: an endpoint
 * naming `{name}` resolves an entity that also carries an age. Comparison is
 * against what the write pipeline stored, not what the model proposed, so
 * coercion cannot cause a near-miss.
 *
 * Two endpoints never resolve: one that matches nothing, and one that
 * matches more than one entity. An ambiguous endpoint is dropped rather than
 * guessed — a relation attached to the wrong entity is worse than a missing
 * one, because nothing downstream can tell it was wrong. An empty match map
 * matches nothing for the same reason.
 */
function resolveEndpoint(
  created: CreatedEntity[],
  endpoint: ExtractedRelationEndpoint,
): { entity: Row } | { reason: string } {
  const wanted = Object.entries(endpoint.match);
  if (wanted.length === 0) return { reason: "carried no match properties" };

  const matches = created.filter(
    (candidate) =>
      candidate.entityTypeKey === endpoint.entityTypeKey &&
      // Compared as text: the match map comes from the model as raw JSON
      // while the entity's properties have been through the write pipeline,
      // so `28` must equal `"28"` and a coerced datetime must equal the ISO
      // string the model wrote.
      wanted.every(([key, value]) => valueToText(candidate.entity[key]) === valueToText(value)),
  );

  if (matches.length === 1) return { entity: matches[0]!.entity };
  if (matches.length === 0) return { reason: "matched no entity created in this call" };
  return { reason: `matched ${matches.length} entities created in this call` };
}

/** Extract entities and relations from text using the lens schema. */
export async function aiExtract(
  lensKey: string,
  text: string,
  store: RuntimeStore,
  entityTypes: string[] | null = null,
  create = false,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const schemaDesc = describeSchema(loaded.scoped);

  let promptExtra = "";
  if (entityTypes && entityTypes.length > 0) {
    promptExtra = `\nFocus on these entity types: ${entityTypes.join(", ")}`;
  }

  const model = requireModel();
  // The schema travels as the parameters of a single forced tool call
  // rather than in `response_format`: a `json_schema` response format is
  // validated against OpenAI's strict subset, which rejects the open
  // `additionalProperties: true` maps this schema needs — property names
  // come from the ontology, so the key set is not knowable statically.
  // Tool parameters carry no such restriction, and the guarantee is
  // unchanged: LangChain emits a `tool_choice` naming that one function,
  // so the model cannot answer in prose.
  //
  // This is a stopgap. It rests on tool-parameter schemas not being
  // strictly validated, which holds today but is not promised. The durable
  // fix is to generate a strict-compliant schema from the lens's scoped
  // ontology per request; that work is tracked separately.
  const structured = model.withStructuredOutput(
    EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    { method: "functionCalling" },
  );
  const raw = await structured.invoke([
    new SystemMessage(EXTRACT_SYSTEM_PROMPT.replace("{schema}", schemaDesc) + promptExtra),
    new HumanMessage(`Extract entities and relations from this text:\n\n${text}`),
  ]);
  const extraction = normalizeExtraction(raw);

  const response: Row = {
    entities: extraction.entities.map((e) => ({
      entityTypeKey: e.entityTypeKey,
      properties: e.properties,
    })),
    relations: extraction.relations.map((r) => ({
      relationTypeKey: r.relationTypeKey,
      source: { entityTypeKey: r.source.entityTypeKey, match: r.source.match },
      target: { entityTypeKey: r.target.entityTypeKey, match: r.target.match },
      properties: r.properties,
    })),
    created: false,
    droppedRelations: [],
  };

  if (create) {
    // Entities first; relation endpoints resolve ONLY against entities
    // created in this same call. No dedup against existing data.
    const createdEntities: CreatedEntity[] = [];
    for (const entity of extraction.entities) {
      const created = await service.createEntity(
        lensKey,
        entity.entityTypeKey,
        entity.properties,
        store,
      );
      createdEntities.push({ entityTypeKey: entity.entityTypeKey, entity: created });
    }

    // An unresolvable endpoint drops its relation without failing the call,
    // but never silently: every drop is reported with the reason, so a run
    // that wrote entities and no relations says so instead of looking clean.
    const dropped: Row[] = [];
    for (const relation of extraction.relations) {
      const source = resolveEndpoint(createdEntities, relation.source);
      const target = resolveEndpoint(createdEntities, relation.target);

      if ("reason" in source || "reason" in target) {
        dropped.push({
          relationTypeKey: relation.relationTypeKey,
          source: { entityTypeKey: relation.source.entityTypeKey, match: relation.source.match },
          target: { entityTypeKey: relation.target.entityTypeKey, match: relation.target.match },
          reason: [
            "reason" in source ? `source ${source.reason}` : null,
            "reason" in target ? `target ${target.reason}` : null,
          ]
            .filter((part) => part !== null)
            .join("; "),
        });
        continue;
      }

      await service.createRelation(
        lensKey,
        relation.relationTypeKey,
        source.entity._id as string,
        target.entity._id as string,
        relation.properties,
        store,
      );
    }

    response.created = true;
    response.droppedRelations = dropped;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Feature: Schema-Aware Chat
// ---------------------------------------------------------------------------

const CHAT_SYSTEM_PROMPT = `You are a knowledge graph assistant. You answer questions by querying data with the available tools. You can only read data, not create or modify it.

SCHEMA:
{schema}

STRATEGY — use the exact keys from the schema as tool arguments (e.g. entity_type_key="person"):
1. For questions about connections or relationships, use execute_query with a
   relationship pattern. Example: "What does Lena do?" →
   MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name CONTAINS 'Lena' RETURN p.name, c.name
2. For counting, filtering, or combining conditions, use execute_query.
3. For fuzzy or "find something like..." questions, use semantic_search.
4. For exploring an entity's connections when you have its _id, use get_neighbors.
5. For browsing entities of a type, use list_entities.

Never make up answers — only use data from tool results. If the data doesn't contain the answer, say so. Be concise.
`;

export interface ChatHistoryEntry {
  role: string;
  content: string;
}

/** Effective toolset: allowlist ∩ available. Embedding-dependent tools are
 * dropped without an embedding provider — for the default agent and
 * explicit allowlists alike. */
export function resolveChatToolNames(agentConfig: AgentConfig): string[] {
  const hasEmbedding = getEmbeddingProvider() !== null;
  if (agentConfig.tools !== null) {
    return agentConfig.tools.filter(
      (t) => ALL_TOOL_NAMES.has(t) && (!EMBEDDING_TOOLS.has(t) || hasEmbedding),
    );
  }
  return CHAT_TOOLS.filter((t) => !EMBEDDING_TOOLS.has(t) || hasEmbedding);
}

/** Unified engine function for agent-powered chat. */
export async function runAgentChat(
  agentConfig: AgentConfig,
  lensKey: string,
  message: string,
  store: RuntimeStore,
  history: ChatHistoryEntry[] | null = null,
  includeToolCalls = false,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const schemaDesc = describeSchema(loaded.scoped);

  // Resolve system prompt: a custom prompt gets the schema appended; no
  // prompt gets the built-in one. The schema is in the prompt either way.
  let systemPrompt = agentConfig.systemPrompt ?? CHAT_SYSTEM_PROMPT.replace("{schema}", schemaDesc);
  if (agentConfig.systemPrompt) {
    systemPrompt += "\n\nSCHEMA:\n" + schemaDesc;
  }

  const toolNames = resolveChatToolNames(agentConfig);
  const model = requireModel();
  const recorder: ToolCallRecord[] = [];
  const tools = buildTools(lensKey, store, toolNames, recorder);

  // Stateless history: caller-supplied user/assistant turns, text only.
  const messages: BaseMessage[] = [];
  for (const entry of history ?? []) {
    if (entry.role === "user") {
      messages.push(new HumanMessage(entry.content));
    } else if (entry.role === "assistant") {
      messages.push(new AIMessage(entry.content));
    }
  }
  messages.push(new HumanMessage(message));

  const reply = await runReactAgent(model, systemPrompt, tools, messages);

  const response: Row = { reply, toolCalls: null };
  if (includeToolCalls) {
    response.toolCalls = recorder.map((record) => ({ tool: record.tool, args: record.args }));
  }
  return response;
}

/** Chat with the knowledge graph using AI and tools (default agent). */
export async function aiChat(
  lensKey: string,
  message: string,
  store: RuntimeStore,
  history: ChatHistoryEntry[] | null = null,
  includeToolCalls = false,
): Promise<Row> {
  return runAgentChat(DEFAULT_AGENT_CONFIG, lensKey, message, store, history, includeToolCalls);
}

/** Chat using a configured agent. */
export async function aiAgentChat(
  lensKey: string,
  agentKey: string,
  message: string,
  store: RuntimeStore,
  history: ChatHistoryEntry[] | null = null,
  includeToolCalls = false,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const config = loaded.agentConfigs[agentKey];
  if (!config) {
    throw new NotFoundError(`AI agent '${agentKey}' not found`);
  }
  return runAgentChat(config, lensKey, message, store, history, includeToolCalls);
}

// ---------------------------------------------------------------------------
// Agent discovery and A2A
// ---------------------------------------------------------------------------

/** List all agents (default + configured) for a lens. */
export async function listRuntimeAgents(
  lensKey: string,
  store: RuntimeStore,
): Promise<Row[]> {
  const loaded = await loadSchema(lensKey, store);
  const agents: Row[] = [
    {
      key: DEFAULT_AGENT_CONFIG.key,
      name: DEFAULT_AGENT_CONFIG.name,
      description: DEFAULT_AGENT_CONFIG.description,
    },
  ];
  for (const config of Object.values(loaded.agentConfigs)) {
    agents.push({
      key: config.key,
      name: config.name,
      description: config.description,
    });
  }
  return agents;
}

/** Generate an A2A agent card JSON. The advertised task URL names the
 * ontology and lens, mirroring the runtime tree the card is served from. */
export function buildAgentCard(
  agentConfig: AgentConfig,
  ontologyKey: string,
  schemaCache: SchemaCacheValue,
  baseUrl: string,
): Row {
  let description = agentConfig.description;
  if (!description) {
    const entityTypes = Object.keys(schemaCache.entityTypes);
    const relationTypes = Object.keys(schemaCache.relationTypes);
    description =
      `Knowledge assistant for ${schemaCache.lensName}. ` +
      `Entity types: ${entityTypes.join(", ")}. ` +
      `Relation types: ${relationTypes.join(", ")}.`;
  }

  const lensUrl = `${baseUrl}/api/ontologies/${ontologyKey}/runtime/lenses/${schemaCache.lensKey}`;
  const url =
    agentConfig.key === "_default"
      ? `${lensUrl}/ai/a2a`
      : `${lensUrl}/ai/agents/${agentConfig.key}/a2a`;

  return {
    name: agentConfig.name,
    description,
    url,
    version: "0.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      {
        id: "chat",
        name: "Knowledge Graph Chat",
        description: `Chat with the ${schemaCache.lensName} knowledge graph`,
      },
    ],
  };
}

/** Handle an A2A JSON-RPC `tasks/send` request. */
export async function handleA2aTask(
  agentConfig: AgentConfig,
  lensKey: string,
  requestBody: Row,
  store: RuntimeStore,
): Promise<Row> {
  const requestId = requestBody.id ?? null;
  const method = requestBody.method;
  if (method !== "tasks/send") {
    return {
      jsonrpc: "2.0",
      id: requestId,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    };
  }

  const params = isPlainObject(requestBody.params) ? requestBody.params : {};
  const taskId = "id" in params ? params.id : randomUUID();

  // Extract text message from parts.
  let messageText = "";
  const message = isPlainObject(params.message) ? params.message : {};
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const part of parts) {
    if (isPlainObject(part) && part.type === "text") {
      messageText += String(part.text ?? "");
    }
  }

  if (!messageText) {
    return {
      jsonrpc: "2.0",
      id: requestId,
      error: { code: -32602, message: "No text message found in request" },
    };
  }

  const result = await runAgentChat(agentConfig, lensKey, messageText, store);

  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: taskId,
      status: { state: "completed" },
      artifacts: [
        {
          parts: [{ type: "text", text: result.reply }],
        },
      ],
    },
  };
}
