/**
 * Decision search (prototype). A decision model first routes the question
 * to one handling path, then steers that path; the language model writes
 * text only where text is needed (a query, parameter values, the answer).
 * Every step is streamed as an event. Read-only: nothing is created,
 * updated or deleted.
 *
 * Paths:
 * - `walk` — search, pick the best hit, walk the graph hop by hop, keep
 *   entities as evidence, answer from the kept evidence.
 * - `query` — the decision model narrows the entity types, the language
 *   model writes one read-only OQL query (one retry on an invalid query), the answer
 *   comes from the rows.
 * - `saved_query` — the decision model picks a saved query, the language
 *   model fills its parameters, the answer comes from the rows.
 * - `schema` — the answer comes from the scoped type and property definitions.
 * - `none` — a short honest reply after checking for an explicitly named search hit.
 *
 * The decision model only ever sees the question, the short routing view
 * of the lens and short entity summaries — never result sets, full
 * document text or the full schema.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getAiModel } from "../core/ai.js";
import {
  getDecisionModel,
  type ChoiceAnswer,
  type DecisionAnswer,
  type DecisionModel,
  type DecisionQuestion,
  type NoulAnswer,
} from "../core/decision.js";
import { NotFoundError, ValidationError } from "../core/exceptions.js";
import { limitQueryResults } from "../core/oql/index.js";
import type { Row, RuntimeStore } from "../core/ports.js";
import type { StreamEvent } from "./chatStream.js";
import { loadSchema, type LoadedSchema } from "./schemaCache.js";
import type { SearchMatch } from "./search/entry.js";
import * as service from "./service.js";

// --- Route ---------------------------------------------------------------

/** The handling paths. Fixed code, identical for every ontology. */
const PATHS = {
  walk: "How to do something, how to fix a problem, or a fact about one named thing and what it belongs to.",
  query: "How many, list all, which has the most or fewest, or which items match a condition.",
  saved_query: "A question that one of the listed saved queries answers.",
  schema: "Definitions of entity types, property definitions or allowed relationship types. Not facts, property values or connections of a specific named record.",
  none: "Unrelated to everything stored here.",
} as const;
type Path = keyof typeof PATHS;
const ROUTE_INSTRUCTIONS = "Which kind of question did the user ask?";
/** Helper asked in the route call; decides walk vs query when the route is not confident. */
const MANY_INSTRUCTIONS =
  "Does the question ask for many items (a count, a list, a ranking or a filter) rather than one item?";
/** Top-minus-second route probability at or above this counts as confident. */
const ROUTE_MARGIN = 0.25;
/** `many` at or above this sends a not-confident route to `query`, else to `walk`. */
const MANY_THRESHOLD = 0.18;
/** A schema route must not discard a clear question about an instance. */
const INSTANCE_THRESHOLD = 0.5;

// --- Query path ----------------------------------------------------------

/** max(about, mentions) at or above this puts an entity type in focus. */
const FOCUS_THRESHOLD = 0.5;
/** Rows handed to the language model; the event carries fewer. */
const ANSWER_ROWS = 200;
const EVENT_ROWS = 50;
/** Serialized data budgets, independent of row count (one cell can hold a document). */
const ANSWER_DATA_CHARS = 40_000;
const EVENT_DATA_CHARS = 20_000;

// --- Saved-query path ----------------------------------------------------

/** The chosen saved query's probability must reach this, else `query` (as when a parameter is missing). */
const SAVED_QUERY_THRESHOLD = 0.7;
/** A single candidate is judged for yes/no relevance, not relative to other options. */
const SAVED_FIT_THRESHOLD = 0.5;

// --- Walk path -----------------------------------------------------------

/** Search hits offered to the decision model. */
const SEARCH_LIMIT = 10;
/** Neighbours read per hop (both directions). */
const NEIGHBOR_LIMIT = 25;
/** Hops walked at most, the starting hit included. */
const MAX_HOPS = 3;
/** `keep` at or above this passes the current entity to the language model. */
const KEEP_THRESHOLD = 0.5;
/** `enough` at or above this stops the walk. */
const ENOUGH_THRESHOLD = 0.6;
/** Top-minus-second probability at or above this counts as a confident pick. */
const CONFIDENT_MARGIN = 0.15;
/** Characters of short text in an entity summary. */
const SUMMARY_CHARS = 200;
/** Characters of the leading excerpt of each document property in a summary. */
const EXCERPT_CHARS = 160;
/** Characters of each document property handed to the language model. */
const DOCUMENT_CHARS = 4000;

export interface DecisionExecution {
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => Promise<void>;
}

interface Models {
  decision: DecisionModel;
  llm: BaseChatModel;
}

interface Ctx {
  lensKey: string;
  question: string;
  store: RuntimeStore;
  loaded: LoadedSchema;
  view: string;
  models: Models;
  signal: AbortSignal;
  emit: (event: StreamEvent) => Promise<void>;
  matches: Map<string, SearchMatch[]>;
  documents: Map<string, Promise<string>>;
  search: Promise<Awaited<ReturnType<typeof service.search>>> | null;
}

/** The language-model prompt a path ends with. */
interface AnswerPrompt {
  system: string;
  human: string;
}

interface EntityRef {
  id: string;
  entityTypeKey: string;
  label: string;
}

/** Both models, or the FEATURE_DISABLED rejection. Called before the stream starts. */
export function requireDecisionModels(): Models {
  const decision = getDecisionModel();
  const llm = getAiModel();
  if (decision === null || llm === null) {
    throw new ValidationError(
      "Decision search is disabled (DECISION_BASE_URL or AI_PROVIDER not configured)",
      { code: "FEATURE_DISABLED" },
    );
  }
  return { decision, llm };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** `name` → `title` → `label` → `display_name` → first string property → id. */
function labelOf(entity: Row): string {
  for (const key of ["name", "title", "label", "display_name"]) {
    const value = entity[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith("_") && typeof value === "string" && value.trim() !== "") return value;
  }
  return String(entity._id).slice(0, 12);
}

function refOf(entity: Row): EntityRef {
  return {
    id: String(entity._id),
    entityTypeKey: String(entity._entityTypeKey),
    label: labelOf(entity),
  };
}

const isDocStub = (value: unknown): boolean =>
  value !== null && typeof value === "object" && (value as Row).document === true;

/** Descriptions lead with what the thing is; the rest is guidance a router does not need. */
function firstSentence(text: string): string {
  const m = text.match(/^.*?(?<!\be\.g)(?<!\bi\.e)(?<!\betc)[.!?](?=$|\s+[A-Z0-9"'(])/s);
  return (m ? m[0] : text).trim();
}

function flat(text: string): string {
  return text.replace(/[#*`>_|]+/g, " ").replace(/\s+/g, " ").trim();
}

function margin(probabilities: Record<string, number>): number {
  const [top = 0, second = 0] = Object.values(probabilities).sort((a, b) => b - a);
  return top - second;
}

/** A choice with a single option is taken without asking. */
function onlyOption(key: string): ChoiceAnswer {
  return { type: "choice", choice: key, probabilities: { [key]: 1 }, confidence: 1 };
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  return [result, Math.round(performance.now() - start)];
}

/** One decision call, announced with a `deciding` event (the caller emits the result with `ms`). */
async function decide(
  ctx: Ctx,
  deciding: Row,
  state: unknown,
  questions: Record<string, DecisionQuestion>,
): Promise<[Record<string, DecisionAnswer>, number]> {
  await ctx.emit({ type: "deciding", ...deciding });
  return timed(async () => {
    const entries = Object.entries(questions);
    const answers: Record<string, DecisionAnswer> = {};
    for (let i = 0; i < entries.length; i += 32) {
      ctx.signal.throwIfAborted();
      Object.assign(answers, await ctx.models.decision.decide(
        state, Object.fromEntries(entries.slice(i, i + 32)), ctx.signal,
      ));
    }
    return answers;
  });
}

function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part !== null && typeof part === "object" && (part as Row).type === "text"
            ? String((part as Row).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

async function llmText(ctx: Ctx, system: string, human: string): Promise<string> {
  ctx.signal.throwIfAborted();
  const message = await ctx.models.llm.invoke(
    [new SystemMessage(system), new HumanMessage(human)],
    { signal: ctx.signal },
  );
  ctx.signal.throwIfAborted();
  return chunkText(message.content);
}

/** A domain error as text for the language model (validation details included). */
function errorText(error: unknown): string {
  if (error instanceof ValidationError) {
    const details = error.details as { errors?: unknown } | null;
    const list = Array.isArray(details?.errors) ? details.errors.map(String) : [];
    return [error.message, ...list].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

const isDomainError = (error: unknown) =>
  error instanceof ValidationError || error instanceof NotFoundError;

// ---------------------------------------------------------------------------
// Routing view — what the decision model is told about the lens
// ---------------------------------------------------------------------------

/**
 * A short rendering of the lens for routing: lens name and description,
 * each entity type with a one-sentence gloss and which properties hold long
 * text, relations as `from verb to` triples, saved queries as name(inputs):
 * first sentence of the description. Scalar property names help recognize
 * instance questions; property types and descriptions are omitted.
 */
function routingView(loaded: LoadedSchema): string {
  const s = loaded.scoped;
  const lines = [
    `Lens "${s.lensName}"${s.lensDescription ? `: ${firstSentence(s.lensDescription)}` : ""}`,
    "",
    "Kinds of thing in this lens:",
  ];
  for (const et of Object.values(s.entityTypes).sort((a, b) => a.key.localeCompare(b.key))) {
    const docs = Object.values(et.properties).filter((p) => p.dataType === "document").map((p) => p.key);
    const gloss = et.description ? `: ${firstSentence(et.description)}` : "";
    const facts = Object.values(et.properties).filter((p) => p.dataType !== "document").map((p) => p.key);
    lines.push(`  - ${et.key}${gloss}${facts.length ? ` (properties: ${facts.join(", ")})` : ""}${docs.length ? ` — has long text: ${docs.join(", ")}` : ""}`);
  }
  const relations = Object.values(s.relationTypes);
  if (relations.length) {
    lines.push("", "How they connect:");
    for (const rt of relations) lines.push(`  - ${rt.fromEntityTypeKey} ${rt.key} ${rt.toEntityTypeKey}`);
  }
  const saved = Object.values(loaded.savedQueries);
  lines.push("", saved.length ? "Validated saved queries available:" : "No saved queries in this lens.");
  for (const q of saved) {
    const params = q.parameters.map((p) => p.name).join(", ");
    lines.push(`  - ${q.key}(${params}): ${firstSentence(q.description || q.name)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runDecisionSearch(
  lensKey: string,
  question: string,
  store: RuntimeStore,
  models: Models,
  execution: DecisionExecution,
): Promise<Row> {
  execution.signal.throwIfAborted();
  const loaded = await loadSchema(lensKey, store);
  execution.signal.throwIfAborted();
  const ctx: Ctx = {
    lensKey, question, store, loaded, view: routingView(loaded), models,
    signal: execution.signal, emit: execution.onEvent,
    matches: new Map(), documents: new Map(), search: null,
  };

  let path = await route(ctx);
  let prompt: AnswerPrompt | null = null;
  if (path === "saved_query") {
    const result = await savedQueryPath(ctx);
    if (typeof result === "string") path = result;
    else prompt = result;
  }
  if (prompt === null) {
    switch (path) {
      case "none": prompt = nonePrompt(ctx); break;
      case "schema": prompt = schemaPrompt(ctx); break;
      case "query": prompt = await queryPath(ctx); break;
      default: prompt = await walkPath(ctx); break;
    }
  }

  await ctx.emit({ type: "answering" });
  let reply = "";
  const stream = await models.llm.stream(
    [new SystemMessage(prompt.system), new HumanMessage(prompt.human)],
    { signal: ctx.signal },
  );
  for await (const chunk of stream) {
    const text = chunkText(chunk.content);
    if (text === "") continue;
    reply += text;
    await ctx.emit({ type: "token", text });
  }
  ctx.signal.throwIfAborted();
  return { reply };
}

/** Walk or query, by the `many` helper — the fallback for anything not clearly decided. */
const walkOrQuery = (many: number): Path => (many >= MANY_THRESHOLD ? "query" : "walk");

/** Whole normalized label matching avoids treating a substring as a named subject. */
function mentionsName(question: string, name: string): boolean {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const label = normalize(name);
  return label.length >= 3 && ` ${normalize(question)} `.includes(` ${label} `);
}

/** One decision call picks the handling path; not confident → walk or query by `many`. */
async function route(ctx: Ctx): Promise<Path> {
  const namesSavedQuery = Object.values(ctx.loaded.savedQueries).some((q) =>
    mentionsName(ctx.question, q.name) || mentionsName(ctx.question, q.key));
  const instructions = ROUTE_INSTRUCTIONS + (namesSavedQuery
    ? " If the user explicitly asks to use or run one of the named saved queries listed in the lens, choose saved_query."
    : "");
  const [answers, ms] = await decide(ctx, { stage: "route" }, { lens: ctx.view, question: ctx.question }, {
    path: { type: "choice", instructions, criteria: { ...PATHS } },
    many: { type: "noul", instructions: MANY_INSTRUCTIONS },
    instance: { type: "noul", instructions:
      "Does the question ask for facts about a particular named item or person, rather than definitions of entity types, properties, or relationship types?" },
  });
  const choice = answers.path as ChoiceAnswer;
  const many = (answers.many as NoulAnswer).noul;
  const instance = (answers.instance as NoulAnswer).noul;
  const m = margin(choice.probabilities);
  const confident = m >= ROUTE_MARGIN;
  let path = confident ? (choice.choice as Path) : walkOrQuery(many);
  let fallbackReason: string | null = null;
  if (path === "schema" && instance >= INSTANCE_THRESHOLD) {
    path = walkOrQuery(many);
    fallbackReason = "The question asks about a particular stored item, so instance evidence is needed.";
  }
  // A routing view describes types, not every stored name. Before rejecting
  // the question, check whether it explicitly names a retrieved entity.
  if (path === "none") {
    try {
      const found = await search(ctx);
      if (found.hits.some((hit) => mentionsName(ctx.question, labelOf(hit.entity)))) {
        path = walkOrQuery(many);
        fallbackReason = "Search found a stored item explicitly named in the question.";
      }
    } catch (error) {
      // The route remains usable without a configured search strategy.
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  await ctx.emit({
    type: "route",
    choice: choice.choice,
    path,
    probabilities: choice.probabilities,
    confidence: choice.confidence,
    margin: m,
    confident,
    fallback: confident && path === choice.choice ? null : path,
    fallbackReason,
    helpers: { many, instance },
    thresholds: { margin: ROUTE_MARGIN, many: MANY_THRESHOLD, instance: INSTANCE_THRESHOLD },
    ms,
  });
  return path;
}

// ---------------------------------------------------------------------------
// none / schema
// ---------------------------------------------------------------------------

function nonePrompt(ctx: Ctx): AnswerPrompt {
  const s = ctx.loaded.scoped;
  return {
    system:
      "You are the assistant of a knowledge base. The question below was judged to be outside " +
      "what this knowledge base holds, so nothing was looked up. Reply in one or two sentences: " +
      "say plainly that the knowledge base has no information about it, and say what it does cover. " +
      "Never answer from general knowledge. Reply in the language of the question.",
    human:
      `Knowledge base: ${s.lensName}${s.lensDescription ? ` — ${firstSentence(s.lensDescription)}` : ""}\n\n` +
      `Question: ${ctx.question}`,
  };
}

function schemaPrompt(ctx: Ctx): AnswerPrompt {
  return {
    system:
      "You answer questions about the structure of a knowledge base: what kinds of things it " +
      "stores and how they connect. Use only the description below; name every kind of thing " +
      "that is relevant. Be concise. Reply in the language of the question.",
    human: `${focusedSchema(ctx, new Set(Object.keys(ctx.loaded.scoped.entityTypes)), new Map())}\n\nQuestion: ${ctx.question}`,
  };
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

const QUERY_WRITER_PROMPT = `You write ONE read-only OQL query (openCypher-style graph pattern syntax) that answers the question.

RULES:
- Node labels are entity type keys and relationship types are relation type keys, exactly as listed. Every node pattern needs a label.
- Relations have the direction listed: (from)-[:relation]->(to).
- Only MATCH, OPTIONAL MATCH, WHERE, at most one WITH, RETURN, ORDER BY, SKIP, LIMIT. No DISTINCT, no writes, no CALL.
- In WITH, give every item that is not a plain variable an alias (WITH c._id AS id, c.name AS name).
- The only functions are count, sum, avg, min, max, collect. No string or date functions.
- When the question names a stored item listed under the stored names, match it with = and that exact spelling, on the type it is listed under. Otherwise match text with CONTAINS on the most distinctive single word or code from the question, not on a whole phrase. Matching is case-sensitive. Compare dates as 'YYYY-MM-DD' strings.
- Return property values, not whole nodes. Return names or titles, not only ids.
- When counting or grouping per item, return the item's _id AND its name, so items that share a name stay apart. To list items without repeats, group them the same way (RETURN c._id AS id, c.name AS name, count(*) AS matches).
- For a ranking, use ASC for lowest/fewest and DESC for highest/most. For minimum or maximum questions, even when phrased in the singular, return up to 10 rows (LIMIT 10), never LIMIT 1, so ties are visible. Honor an explicitly numbered top-N request. A limit may still omit ties; never claim all ties are included.
- For "how many", return a count.
- _createdAt and _updatedAt are when a record was stored, not when something happened.

Example (for a schema with person -works_for-> company):
MATCH (p:person)-[:works_for]->(c:company) RETURN c._id AS id, c.name AS company, count(p) AS people ORDER BY people DESC LIMIT 10

Reply with the query only, in one \`\`\`oql code block.`;

const QUERY_ANSWER_PROMPT = `You answer a question from the result of a database query over a knowledge graph.
The rows are the output of the shown query, not a guarantee of complete coverage. Respect its filters and limits. A limit may omit matching items or ties; say when the answer is partial.

Rules:
- Use only the rows. Give the exact numbers and names from them.
- Rows with the same name but a different id are different items.
- If several items tie, name all of them.
- State counts as numbers ("0 problems", "17 guides").
- If nothing matches, say what this query found; do not conclude that a named item or fact does not exist elsewhere in the graph. Name what was asked for ("No projects are in maintenance status.").
- If the question depends on something the data does not record (for example a date that no property holds, so the query used _createdAt, which is only when the record was stored), say so plainly.
Be concise. Reply in the language of the question.`;

/** The chosen entity types plus the types on shortest relation paths joining them (undirected). */
function connect(ctx: Ctx, chosen: Set<string>): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const rt of Object.values(ctx.loaded.scoped.relationTypes)) {
    if (!adj.has(rt.fromEntityTypeKey)) adj.set(rt.fromEntityTypeKey, new Set());
    if (!adj.has(rt.toEntityTypeKey)) adj.set(rt.toEntityTypeKey, new Set());
    adj.get(rt.fromEntityTypeKey)!.add(rt.toEntityTypeKey);
    adj.get(rt.toEntityTypeKey)!.add(rt.fromEntityTypeKey);
  }
  const result = new Set<string>();
  const [first, ...rest] = [...chosen];
  if (first === undefined) return result;
  result.add(first);
  for (const target of rest) {
    if (result.has(target)) continue;
    // BFS from the target to the nearest type already in the result.
    const prev = new Map<string, string | null>([[target, null]]);
    const queue = [target];
    let hit: string | null = null;
    while (queue.length && hit === null) {
      const node = queue.shift()!;
      for (const next of adj.get(node) ?? []) {
        if (prev.has(next)) continue;
        prev.set(next, node);
        if (result.has(next)) { hit = next; break; }
        queue.push(next);
      }
    }
    if (hit === null) { result.add(target); continue; }
    for (let n: string | null = prev.get(hit)!; n !== null; n = prev.get(n) ?? null) result.add(n);
  }
  return result;
}

/** Reuse bounded cross-type retrieval; give literal codes a keyword path into the candidates. */
function search(ctx: Ctx): Promise<Awaited<ReturnType<typeof service.search>>> {
  ctx.signal.throwIfAborted();
  ctx.search ??= (async () => {
    const result = await service.search(ctx.lensKey, { query: ctx.question, limit: SEARCH_LIMIT }, ctx.store);
    const codes = [...new Set(ctx.question.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])]
      .filter((term) => /\p{N}/u.test(term)).slice(0, 4);
    if (!codes.length) return result;
    ctx.signal.throwIfAborted();
    try {
      const literal = await service.search(ctx.lensKey, {
        query: codes.join(" "), strategy: "keyword-any", limit: SEARCH_LIMIT,
      }, ctx.store);
      const hits = new Map<string, typeof result.hits[number]>();
      for (const hit of [...literal.hits, ...result.hits]) {
        const id = String(hit.entity._id);
        const existing = hits.get(id);
        if (existing) existing.matches = [...existing.matches, ...(hit.matches ?? [])];
        else hits.set(id, { ...hit, matches: hit.matches ?? [] });
      }
      return { ...result, hits: [...hits.values()].slice(0, SEARCH_LIMIT) };
    } catch (error) {
      // Adapters without keyword search retain their normal retrieval strategy.
      if (!(error instanceof ValidationError)) throw error;
      return result;
    }
  })();
  return ctx.search;
}

async function candidateNames(ctx: Ctx): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  try {
    const result = await search(ctx);
    for (const hit of result.hits) {
      const key = String(hit.entity._entityTypeKey);
      const labels = names.get(key) ?? [];
      const label = labelOf(hit.entity);
      if (!labels.includes(label)) labels.push(label);
      names.set(key, labels);
    }
  } catch (error) {
    // Querying remains available on deployments without a search strategy.
    if (!(error instanceof ValidationError)) throw error;
  }
  return names;
}

/** Full detail for focus types, abbreviated other types, relation facts and candidate names. */
function focusedSchema(ctx: Ctx, focus: Set<string>, names: Map<string, string[]>): string {
  const s = ctx.loaded.scoped;
  const lines = ["Entity types in focus:"];
  const others: string[] = [];
  for (const et of Object.values(s.entityTypes)) {
    if (!focus.has(et.key)) {
      const gloss = et.description ? `: ${firstSentence(et.description)}` : "";
      others.push(`  - ${et.key}${gloss} (properties: ${Object.keys(et.properties).join(", ")})`);
      continue;
    }
    lines.push(`  - ${et.key}${et.description ? `: ${et.description}` : ""}`);
    for (const p of Object.values(et.properties)) {
      lines.push(`    - ${p.key}: ${p.dataType}${p.description ? ` — ${p.description}` : ""}`);
    }
  }
  if (others.length) lines.push("", "Other entity types:", ...others);
  lines.push("", "Relation types:");
  for (const rt of Object.values(s.relationTypes)) {
    lines.push(`  - (${rt.fromEntityTypeKey})-[:${rt.key}]->(${rt.toEntityTypeKey})` +
      (rt.description ? ` — ${rt.description}` : ""));
    for (const p of Object.values(rt.properties)) {
      lines.push(`    - ${p.key}: ${p.dataType}${p.description ? ` — ${p.description}` : ""}`);
    }
  }
  lines.push("", "System properties on every entity: _id, _createdAt, _updatedAt");
  if (names.size) {
    lines.push("", "Search candidates (not exhaustive). Use exact spelling and the listed type only when the candidate matches the named item in the question:");
    for (const [key, list] of names) lines.push(`  - ${key}: ${list.map((n) => JSON.stringify(n)).join(", ")}`);
  }
  return lines.join("\n");
}

function extractQuery(text: string): string {
  const fenced = text.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
  return (fenced ? fenced[1]! : text).trim().replace(/;\s*$/, "");
}

/** Row values for the prompt and the event: document stubs and timestamps dropped. */
function compactRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (isDocStub(v)) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const inner: Row = {};
      for (const [ik, iv] of Object.entries(v as Row)) {
        if (ik === "_createdAt" || ik === "_updatedAt" || isDocStub(iv)) continue;
        inner[ik] = iv;
      }
      out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Bound nested results before serialization; preserve values and disclose any omission. */
function boundedRows(source: Row[], rowLimit: number, charLimit: number): { rows: Row[]; truncated: boolean } {
  let remaining = charLimit;
  let truncated = source.length > rowLimit;
  const omit = () => { truncated = true; return undefined; };
  const value = (input: unknown, depth: number): unknown => {
    if (remaining < 16 || depth > 6) return omit();
    if (typeof input === "string") {
      // Six characters cover the worst JSON escaping expansion of one code unit.
      const length = Math.min(DOCUMENT_CHARS, Math.floor((remaining - 2) / 6));
      let text = input.slice(0, length);
      if (text.length < input.length) {
        truncated = true;
        if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      }
      remaining -= JSON.stringify(text).length;
      return text;
    }
    if (input === null || typeof input === "number" || typeof input === "boolean") {
      const cost = JSON.stringify(input).length;
      if (cost > remaining) return omit();
      remaining -= cost;
      return input;
    }
    if (Array.isArray(input)) {
      remaining -= 2;
      const out: unknown[] = [];
      for (const item of input.slice(0, ANSWER_ROWS)) {
        const next = value(item, depth + 1);
        if (next === undefined) break;
        out.push(next);
        remaining--;
      }
      if (out.length < input.length) truncated = true;
      return out;
    }
    if (input && typeof input === "object") {
      remaining -= 2;
      const out: Row = {};
      for (const key of Object.keys(input)) {
        if (key.length > 512 || remaining < key.length * 6 + 16) { truncated = true; break; }
        remaining -= JSON.stringify(key).length + 2;
        const next = value((input as Row)[key], depth + 1);
        if (next === undefined) break;
        Object.defineProperty(out, key, { value: next, enumerable: true });
      }
      return out;
    }
    return omit();
  };
  const rows: Row[] = [];
  for (const row of source.slice(0, rowLimit)) {
    if (remaining < 32) { truncated = true; break; }
    rows.push(value(compactRow(row), 0) as Row);
    remaining--;
  }
  return { rows, truncated };
}

function resultText(source: Row[]): string {
  const bounded = boundedRows(source, ANSWER_ROWS, ANSWER_DATA_CHARS);
  return `Result: ${source.length} row(s), ${bounded.rows.length} displayed.` +
    (bounded.truncated ? " Rows or values were truncated to fit the answer budget; this is partial evidence. Do not infer totals from displayed collection sizes." : "") +
    "\n" + bounded.rows.map((row) => JSON.stringify(row)).join("\n");
}

async function queryPath(ctx: Ctx): Promise<AnswerPrompt> {
  // 1. Which entity types are involved: two independent yes/no questions per type.
  const types = Object.values(ctx.loaded.scoped.entityTypes);
  if (types.length === 0) {
    return { system: QUERY_ANSWER_PROMPT,
      human: `Question: ${ctx.question}\nThis lens has no entity types; no query was run.` };
  }
  const questions: Record<string, DecisionQuestion> = {};
  for (const et of types) {
    const gloss = et.description ? firstSentence(et.description) : et.key;
    questions[`m:${et.key}`] = {
      type: "noul",
      instructions: `Does the question mention a ${et.key} (${gloss}), by kind or by name?`,
    };
    questions[`a:${et.key}`] = {
      type: "noul",
      instructions: `Is "${et.key}" (${gloss}) one of the kinds of thing the question is about?`,
    };
  }
  const [answers, ms] = await decide(ctx, { stage: "schema_focus" }, { question: ctx.question }, questions);
  const scored = types.map((et) => {
    const m = (answers[`m:${et.key}`] as NoulAnswer | undefined)?.noul ?? 0;
    const a = (answers[`a:${et.key}`] as NoulAnswer | undefined)?.noul ?? 0;
    return { key: et.key, p: Math.max(m, a) };
  }).sort((x, y) => y.p - x.p);
  const chosen = new Set(scored.filter((t) => t.p >= FOCUS_THRESHOLD).map((t) => t.key));
  if (chosen.size === 0 && scored[0]) chosen.add(scored[0].key);
  const focus = connect(ctx, chosen);
  await ctx.emit({
    type: "schema_focus",
    types: scored.map((t) => ({
      key: t.key, p: t.p, chosen: focus.has(t.key), connecting: focus.has(t.key) && !chosen.has(t.key),
    })),
    threshold: FOCUS_THRESHOLD,
    requests: Math.ceil(Object.keys(questions).length / 32),
    ms,
  });

  // 2. Resolve candidate names, then write one query; retry invalid syntax only.
  const schemaText = focusedSchema(ctx, focus, await candidateNames(ctx));
  let human = `Question: ${ctx.question}\n\nSchema:\n${schemaText}`;
  let query = "";
  let result: { columns: string[]; results: Row[] } | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await ctx.emit({ type: "writing_query", attempt });
    query = extractQuery(await llmText(ctx, QUERY_WRITER_PROMPT, human));
    lastError = null;
    try {
      // One extra row lets the answer disclose clipping at ANSWER_ROWS.
      query = limitQueryResults(query, ANSWER_ROWS + 1);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      lastError = errorText(error);
    }
    await ctx.emit({ type: "oql", attempt, query });
    ctx.signal.throwIfAborted();
    try {
      if (lastError === null) result = await service.executeQuery(ctx.lensKey, query, ctx.store);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      lastError = errorText(error);
    }
    const rows = result?.results ?? [];
    const display = boundedRows(rows, EVENT_ROWS, EVENT_DATA_CHARS);
    await ctx.emit({
      type: "rows", attempt,
      columns: result?.columns ?? [],
      rows: display.rows,
      truncated: display.truncated,
      total: rows.length,
      ...(lastError ? { error: lastError } : {}),
    });
    if (attempt === 2 || result) break;
    human += `\n\nYour query:\n\`\`\`oql\n${query}\n\`\`\`\nfailed:\n${lastError}\nWrite a corrected query without changing the question's constraints.`;
    result = null;
  }

  // 3. The answer comes from the rows.
  const rows = result?.results ?? [];
  const storedTime = /_(created|updated)At/.test(query)
    ? "Note: the query filters on when records were stored in the database (_createdAt/_updatedAt), " +
      "not on a date the data records; say so in the answer.\n\n"
    : "";
  return {
    system: QUERY_ANSWER_PROMPT,
    human:
      `Question: ${ctx.question}\n\nSchema:\n${schemaText}\n\nQuery:\n${query}\n\n${storedTime}` +
      (result
        ? resultText(rows)
        : `The query failed twice, last error:\n${lastError}\nSay that the question could not be answered by a query.`),
  };
}

// ---------------------------------------------------------------------------
// saved_query
// ---------------------------------------------------------------------------

const PARAMETER_PROMPT = `You fill the parameters of a saved query from a question.
Reply with one JSON object only: each parameter name mapped to its value taken from the question, spelled exactly as in the question (without possessive endings such as 's), or null when the question does not give it.`;

const SAVED_ANSWER_PROMPT = `You answer a question from the result of a saved query over a knowledge graph.
The rows are the output of the shown query, not a guarantee of complete coverage. Respect its filters and limits. A limit may omit matching items or ties; say when the answer is partial.
Use only the rows; give the exact names and numbers from them. If the rows are empty, say that nothing matching is recorded.
Be concise but complete. Reply in the language of the question.`;

function parseJsonObject(text: string): Row | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const value = JSON.parse(m[0]) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
  } catch {
    return null;
  }
}

/** The answer prompt, or the path to fall back to. */
async function savedQueryPath(ctx: Ctx): Promise<AnswerPrompt | Path> {
  const saved = Object.values(ctx.loaded.savedQueries);
  const fallback = async (to: Path, reason: string) => {
    await ctx.emit({ type: "fallback", from: "saved_query", to, reason });
    return to;
  };
  if (saved.length === 0) return fallback("query", "the lens has no saved queries");
  if (saved.length > 255) return fallback("query", "saved-query candidates exceed the decision model option limit");

  // 1. Which saved query: a choice over name + description only.
  const keys = saved.map((q) => q.key);
  let pick: ChoiceAnswer;
  let ms = 0;
  if (saved.length === 1) {
    const q = saved[0]!;
    const [answers, t] = await decide(ctx, { stage: "saved_query" }, { question: ctx.question }, {
      fits: { type: "noul", instructions: `Does the saved query "${q.name}: ${q.description}" answer the question?` },
    });
    const p = (answers.fits as NoulAnswer).noul;
    pick = { type: "choice", choice: q.key, probabilities: { [q.key]: p }, confidence: p };
    ms = t;
  } else {
    const [answers, t] = await decide(ctx, { stage: "saved_query" }, { question: ctx.question }, {
      query: {
        type: "choice",
        instructions: "Which saved query answers the question?",
        criteria: Object.fromEntries(saved.map((q) => [q.key, `${q.name}: ${q.description}`])),
      },
    });
    pick = answers.query as ChoiceAnswer;
    ms = t;
  }
  const p = pick.probabilities[pick.choice] ?? 0;
  const threshold = saved.length === 1 ? SAVED_FIT_THRESHOLD : SAVED_QUERY_THRESHOLD;
  const confident = p >= threshold;
  const config = ctx.loaded.savedQueries[pick.choice];
  if (!config) return fallback("query", "the decision model returned an unknown saved query");
  await ctx.emit({
    type: "saved_query",
    choice: pick.choice,
    name: config.name,
    options: Object.fromEntries(saved.map((q) => [q.key, q.name])),
    probabilities: pick.probabilities,
    confident,
    threshold,
    parameters: null,
    ms,
  });
  if (!confident || !keys.includes(pick.choice)) {
    return fallback("query", `no saved query reached ${threshold}`);
  }

  // 2. The language model fills the parameters.
  let parameters: Row = {};
  if (config.parameters.length) {
    await ctx.emit({ type: "writing_parameters" });
    const human =
      `Saved query: ${config.name} — ${config.description}\nParameters:\n` +
      config.parameters.map((prm) => `  - ${prm.name} (${prm.dataType}): ${prm.description}`).join("\n") +
      `\n\nQuestion: ${ctx.question}`;
    parameters = parseJsonObject(await llmText(ctx, PARAMETER_PROMPT, human)) ?? {};
  }
  const filled: Row = {};
  for (const prm of config.parameters) {
    const v = parameters[prm.name];
    filled[prm.name] = v === undefined || v === "" ? null : v;
  }
  const missing = config.parameters.map((prm) => prm.name).filter((n) => filled[n] === null);
  await ctx.emit({ type: "saved_query_parameters", choice: pick.choice, parameters: filled, missing });
  if (missing.length) {
    return fallback("query", `the question gives no value for ${missing.join(", ")}`);
  }

  // 3. Run it.
  let rows: Row[] = [];
  let columns: string[] = [];
  try {
    const out = await service.executeSavedQuery(ctx.lensKey, pick.choice, filled, ctx.store);
    if (Array.isArray(out.hits)) {
      rows = [];
      for (const hit of out.hits as { entity: Row; matches?: SearchMatch[] }[]) {
        const entity: Row = { ...hit.entity,
          _entityTypeKey: hit.entity._entityTypeKey ?? config.steps.at(-1)?.entityTypeKey };
        ctx.matches.set(String(entity._id), hit.matches ?? []);
        const row = compactRow(entity);
        for (const match of hit.matches ?? []) {
          if (match.kind === "document") {
            row[match.propertyKey] = await excerpt(ctx, entity, match.propertyKey, DOCUMENT_CHARS);
          }
        }
        rows.push(row);
      }
    } else {
      rows = (out.results as Row[] | undefined) ?? [];
    }
    columns = (out.columns as string[] | undefined) ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  } catch (error) {
    if (!isDomainError(error)) throw error;
    await ctx.emit({ type: "rows", attempt: 1, columns: [], rows: [], total: 0, error: errorText(error) });
    return fallback("query", "the saved query failed");
  }
  const display = boundedRows(rows, EVENT_ROWS, EVENT_DATA_CHARS);
  await ctx.emit({ type: "rows", attempt: 1, columns, rows: display.rows, truncated: display.truncated, total: rows.length });
  return {
    system: SAVED_ANSWER_PROMPT,
    human:
      `Question: ${ctx.question}\n\nSaved query: ${config.name} — ${config.description}\n` +
      `Parameters: ${JSON.stringify(filled)}\nPipeline: ${JSON.stringify(config.steps)}\nSearch steps and explicit query limits return bounded results, not exhaustive coverage.\n\n` +
      resultText(rows),
  };
}

// ---------------------------------------------------------------------------
// walk
// ---------------------------------------------------------------------------

const WALK_ANSWER_PROMPT = `You answer questions about a knowledge graph.
Use only the evidence below. Each entity lists its properties and a bounded selection of connected entities. Documents contain excerpts only; this is not exhaustive coverage.
When multiple entities could match the question, distinguish them using their recorded identifiers or properties. Present the differing answers or ask for clarification; do not silently choose one.
If a requested text value is truncated, quote a short available excerpt and clearly say it is incomplete.
If the evidence does not contain the answer, say so plainly.
Be concise. Reply in the language of the question.`;

/** Reuse one bounded document read, starting at its matched passage when available. */
async function excerpt(ctx: Ctx, entity: Row, key: string, chars: number): Promise<string> {
  ctx.signal.throwIfAborted();
  const id = String(entity._id);
  const match = ctx.matches.get(id)?.find((m) => m.kind === "document" && m.propertyKey === key);
  const offset = match?.kind === "document" ? match.charOffset : 0;
  const cacheKey = JSON.stringify([id, key, offset]);
  let content = ctx.documents.get(cacheKey);
  if (!content) {
    content = service.getDocument(ctx.lensKey, String(entity._entityTypeKey), id, key,
      offset, DOCUMENT_CHARS, ctx.store).then((doc) => String(doc.content));
    ctx.documents.set(cacheKey, content);
  }
  const text = await content;
  ctx.signal.throwIfAborted();
  return Array.from(text).slice(0, chars).join("");
}

/** Keep a short window around question terms, not just a chunk's introductory text. */
function relevantExcerpt(text: string, question: string): string {
  const normalized = flat(text);
  if (normalized.length <= EXCERPT_CHARS) return normalized;
  const lower = normalized.toLocaleLowerCase();
  const terms = [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])];
  let best = normalized.slice(0, EXCERPT_CHARS);
  let bestScore = 0;
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index >= 0) {
      const start = Math.max(0, index - 40);
      const window = normalized.slice(start, start + EXCERPT_CHARS);
      const folded = window.toLocaleLowerCase();
      const score = terms.reduce((sum, t) => sum + (folded.includes(t) ? t.length : 0), 0);
      if (score > bestScore) { best = window; bestScore = score; }
      index = lower.indexOf(term, index + term.length);
    }
  }
  return best;
}

/**
 * `<type>: <label> — <short text> · <doc>: <leading excerpt>…` — the short
 * text being the other string properties, the excerpt the matched passage or leading characters
 * of each document property.
 */
async function summaryOf(ctx: Ctx, entity: Row, withExcerpt: boolean): Promise<string> {
  const label = labelOf(entity);
  const rest = Object.entries(entity)
    .filter(([k, v]) => !k.startsWith("_") && ["string", "number", "boolean"].includes(typeof v) && v !== label)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, SUMMARY_CHARS);
  const docs: string[] = [];
  for (const [k, v] of Object.entries(entity)) {
    if (!withExcerpt || k.startsWith("_") || !isDocStub(v)) continue;
    const text = relevantExcerpt(await excerpt(ctx, entity, k, DOCUMENT_CHARS), ctx.question);
    if (text) docs.push(`${k}: ${text}…`);
  }
  const parts = [rest, ...docs].filter(Boolean).join(" · ");
  return `${String(entity._entityTypeKey)}: ${label}${parts ? ` — ${parts}` : ""}`;
}

const describeNeighbor = (n: Row) => {
  const rel = n.relation as Row;
  const e = n.entity as Row;
  const facts = Object.entries(rel).filter(([k]) => !k.startsWith("_") && k !== "direction")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, SUMMARY_CHARS) : JSON.stringify(boundedRows([{ value: v }], 1, SUMMARY_CHARS).rows[0]?.value)}`)
    .join(", ").slice(0, SUMMARY_CHARS);
  return `${String(rel.direction)} ${String(rel._relationTypeKey)}${facts ? ` (${facts})` : ""} → ${String(e._entityTypeKey)}: ${labelOf(e)}`;
};

/** Structured evidence shares the query result budget, including scalar and relation values. */
async function evidenceRow(ctx: Ctx, entity: Row, neighbors: Row[]): Promise<Row> {
  const properties: Row = { ...entity };
  for (const [key, value] of Object.entries(entity)) {
    if (isDocStub(value)) properties[key] = await excerpt(ctx, entity, key, DOCUMENT_CHARS);
  }
  return {
    entity: properties,
    connections: neighbors.map((n) => ({ relation: n.relation, entity: refOf(n.entity as Row) })),
  };
}

/** Use lens topology before applying a read budget; don't let one direction starve the other. */
async function readNeighborhood(ctx: Ctx, entity: Row) {
  const type = String(entity._entityTypeKey);
  const relations = Object.values(ctx.loaded.scoped.relationTypes).filter((r) =>
    (r.fromEntityTypeKey === type || r.toEntityTypeKey === type) &&
    r.fromEntityTypeKey in ctx.loaded.scoped.entityTypes &&
    r.toEntityTypeKey in ctx.loaded.scoped.entityTypes);
  const buckets = relations.flatMap((relation) => [
    ...(relation.fromEntityTypeKey === type ? [{ relationType: relation.key, direction: "outgoing" }] : []),
    ...(relation.toEntityTypeKey === type ? [{ relationType: relation.key, direction: "incoming" }] : []),
  ]);
  // Do not silently choose a prefix of a large relation schema.
  if (buckets.length > NEIGHBOR_LIMIT) return null;
  const read = (direction: string, relationType: string | null, limit: number) => {
    ctx.signal.throwIfAborted();
    return service.getNeighbors(ctx.lensKey, type, String(entity._id), direction,
      relationType, limit, ctx.store);
  };
  if (!buckets.length) return read("both", null, NEIGHBOR_LIMIT);
  const pages = await Promise.all(buckets.map((bucket, index) => read(
    bucket.direction, bucket.relationType,
    Math.floor(NEIGHBOR_LIMIT / buckets.length) + (index < NEIGHBOR_LIMIT % buckets.length ? 1 : 0),
  )));
  return { entity: pages[0]!.entity, neighbors: pages.flatMap((page) => page.neighbors) };
}

async function walkPath(ctx: Ctx): Promise<AnswerPrompt> {
  const { question, loaded } = ctx;

  // 1. Search.
  const found = await search(ctx);
  const hits = found.hits.map((h) => h.entity);
  for (const hit of found.hits) ctx.matches.set(String(hit.entity._id), hit.matches ?? []);
  await ctx.emit({ type: "search", query: question, hits: hits.map(refOf) });

  const evidence: Row[] = [];
  let coverage = "no search hits";
  let uncertainPick = false;
  const neighborsOf = new Map<string, Row[]>();
  if (hits.length === 0) {
    await ctx.emit({
      type: "ready", reason: "no search hits", fallback: false, visited: 0, evidence: [],
    });
  } else {
    // 2. Pick the starting hit.
    const hitKeys = hits.map((_, i) => `h${i + 1}`);
    let pick: ChoiceAnswer;
    let pickMs = 0;
    if (hits.length === 1) {
      pick = onlyOption("h1");
    } else {
      const criteria: Record<string, string> = {};
      for (const [i, h] of hits.entries()) criteria[hitKeys[i]!] = await summaryOf(ctx, h, true);
      const [answers, ms] = await decide(ctx, { stage: "pick", hop: 0, entityId: null }, { question }, {
        pick: {
          type: "choice",
          instructions: "Which search hit is the best starting point to answer the question?",
          criteria,
        },
      });
      pick = answers.pick as ChoiceAnswer;
      pickMs = ms;
    }
    const pickMargin = margin(pick.probabilities);
    uncertainPick = pickMargin < CONFIDENT_MARGIN;
    await ctx.emit({
      type: "pick_hit",
      choice: pick.choice,
      hit: refOf(hits[hitKeys.indexOf(pick.choice)] ?? hits[0]!),
      probabilities: pick.probabilities,
      confidence: pick.confidence,
      margin: pickMargin,
      confident: pickMargin >= CONFIDENT_MARGIN,
      ms: pickMs,
    });

    // 3. Walk the graph. Per hop, one decision call judges whether the
    // current entity is kept as evidence, whether the evidence is enough,
    // and which neighbour to read next. The starting entity is always kept.
    let current: Row = hits[hitKeys.indexOf(pick.choice)] ?? hits[0]!;
    // A close choice is not evidence that the other hits are irrelevant.
    // Spend the existing visit budget on competing seeds before following one chain.
    const topProbability = Math.max(...Object.values(pick.probabilities));
    const alternatives = uncertainPick ? hits.map((entity, i) => ({
      entity, key: hitKeys[i]!, probability: pick.probabilities[hitKeys[i]!] ?? 0,
    })).filter((hit) => hit.entity._id !== current._id &&
      topProbability - hit.probability < CONFIDENT_MARGIN)
      .sort((a, b) => b.probability - a.probability).slice(0, MAX_HOPS - 1) : [];
    let via: Row | null = null;
    const visited = new Set<string>();
    let reason = "max hops reached";
    for (let hop = 1; hop <= MAX_HOPS; hop++) {
      ctx.signal.throwIfAborted();
      await ctx.emit({ type: "reading", entityId: String(current._id) });
      const neighborhood = await readNeighborhood(ctx, current);
      if (neighborhood === null) {
        await ctx.emit({ type: "fallback", from: "walk", to: "query",
          reason: "The exposed relationship directions exceed the traversal budget; using a bounded query." });
        return queryPath(ctx);
      }
      const { entity, neighbors } = neighborhood;
      visited.add(String(entity._id));
      // Neighbours whose type the lens exposes.
      const inLens = (neighbors as Row[]).filter(
        (n) => String((n.entity as Row)._entityTypeKey) in loaded.scoped.entityTypes,
      );
      neighborsOf.set(String(entity._id), inLens);

      // Unvisited neighbours (only those can be read next).
      const seen = new Set<string>();
      const candidates = inLens.filter((n) => {
        const id = String((n.entity as Row)._id);
        if (visited.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const candidateKeys = candidates.map((_, i) => `n${i + 1}`);

      const alternative = alternatives.find((hit) => !visited.has(String(hit.entity._id)));
      const askNext = !alternative && candidates.length >= 2 && hop < MAX_HOPS;
      const questions: Record<string, DecisionQuestion> = {
        keep: {
          type: "noul",
          instructions: "Does the current entity contain information needed to answer the question?",
        },
        enough: {
          type: "noul",
          instructions:
            "Is the kept evidence, together with the current entity if it is relevant, " +
            "enough to answer the question?",
        },
      };
      if (askNext) {
        questions.next = {
          type: "choice",
          instructions: "Which neighbour should be read next to answer the question?",
          criteria: Object.fromEntries(candidates.map((n, i) => [candidateKeys[i]!, describeNeighbor(n)])),
        };
      }
      const keptSummaries: string[] = [];
      for (const e of evidence) keptSummaries.push(await summaryOf(ctx, e, true));
      const [answers, ms] = await decide(
        ctx,
        { stage: "hop", hop, entityId: String(entity._id) },
        { question, kept: keptSummaries, current: await summaryOf(ctx, entity, true) },
        questions,
      );
      const keep = (answers.keep as NoulAnswer).noul;
      const start = hop === 1;
      const named = mentionsName(question, labelOf(entity));
      const kept = keep >= KEEP_THRESHOLD || start || named;
      if (kept) evidence.push(entity);
      const enough = (answers.enough as NoulAnswer).noul;
      const next: ChoiceAnswer | null = askNext
        ? (answers.next as ChoiceAnswer)
        : !alternative && candidates.length === 1 && hop < MAX_HOPS
          ? onlyOption("n1")
          : null;
      const nextNeighbor = next ? candidates[candidateKeys.indexOf(next.choice)] ?? null : null;
      await ctx.emit({
        type: "step",
        hop,
        entity: refOf(entity),
        via,
        keep,
        kept,
        start,
        named,
        enough,
        next: alternative && hop < MAX_HOPS
          ? {
              choice: alternative.key,
              label: `Competing search hit: ${labelOf(alternative.entity)}`,
              entity: refOf(alternative.entity),
              probabilities: pick.probabilities,
              options: Object.fromEntries(hits.map((hit, i) => [hitKeys[i]!, labelOf(hit)])),
              confidence: pick.confidence,
            }
          : next && nextNeighbor
          ? {
              choice: next.choice,
              label: describeNeighbor(nextNeighbor),
              entity: refOf(nextNeighbor.entity as Row),
              probabilities: next.probabilities,
              options: Object.fromEntries(
                candidates.map((n, i) => [candidateKeys[i]!, describeNeighbor(n)]),
              ),
              confidence: next.confidence,
            }
          : null,
        ms,
      });

      if (alternative && hop < MAX_HOPS) {
        current = alternative.entity;
        via = null;
        continue;
      }
      if (enough >= ENOUGH_THRESHOLD && keep >= KEEP_THRESHOLD) { reason = "enough evidence"; break; }
      if (candidates.length === 0) { reason = "no unvisited neighbours"; break; }
      if (hop === MAX_HOPS || nextNeighbor === null) { reason = "max hops reached"; break; }
      const rel = nextNeighbor.relation as Row;
      via = {
        direction: rel.direction,
        relationTypeKey: rel._relationTypeKey,
        fromId: String(entity._id),
      };
      current = nextNeighbor.entity as Row;
    }
    coverage = reason;
    await ctx.emit({
      type: "ready",
      reason,
      fallback: false,
      visited: visited.size,
      evidence: evidence.map(refOf),
    });
  }

  // 4. Answer from the evidence.
  const blocks: Row[] = [];
  for (const entity of evidence) {
    blocks.push(await evidenceRow(ctx, entity, neighborsOf.get(String(entity._id)) ?? []));
  }
  return {
    system: WALK_ANSWER_PROMPT,
    human:
      `Question: ${question}\nRetrieval stopped: ${coverage}.${uncertainPick ? " Initial hit selection was uncertain; competing hits were checked within the visit budget. The evidence may describe different possible subjects." : ""} At most ${SEARCH_LIMIT} search hits, ${MAX_HOPS} visited entities and ${NEIGHBOR_LIMIT} neighbours per entity were considered. This is partial retrieval, not proof that other facts do not exist.\n\nEvidence:\n\n` + (blocks.length ? resultText(blocks) : "(none found)"),
  };
}
