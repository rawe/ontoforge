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
 *   model writes one read-only OQL query (one retry on an error or no rows), the answer
 *   comes from the rows.
 * - `saved_query` — the decision model picks a saved query, the language
 *   model fills its parameters, the answer comes from the rows.
 * - `schema` — the answer comes from the routing view of the lens.
 * - `none` — a short honest reply, nothing is read.
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
import type { Row, RuntimeStore } from "../core/ports.js";
import type { StreamEvent } from "./chatStream.js";
import { loadSchema, type LoadedSchema } from "./schemaCache.js";
import * as service from "./service.js";

// --- Route ---------------------------------------------------------------

/** The handling paths. Fixed code, identical for every ontology. */
const PATHS = {
  walk: "How to do something, how to fix a problem, or a fact about one named thing and what it belongs to.",
  query: "How many, list all, which has the most or fewest, or which items match a condition.",
  saved_query: "A question that one of the listed saved queries answers.",
  schema: "What kinds of things are stored and how they connect.",
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

// --- Query path ----------------------------------------------------------

/** max(about, mentions) at or above this puts an entity type in focus. */
const FOCUS_THRESHOLD = 0.5;
/** Rows handed to the language model; the event carries fewer. */
const ANSWER_ROWS = 200;
const EVENT_ROWS = 50;
/** Entity types with at most this many entities have their names listed for the query writer. */
const NAMES_PER_TYPE = 25;

// --- Saved-query path ----------------------------------------------------

/** The chosen saved query's probability must reach this, else `query` (as when a parameter is missing). */
const SAVED_QUERY_THRESHOLD = 0.7;

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
  return timed(() => ctx.models.decision.decide(state, questions, ctx.signal));
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
  const message = await ctx.models.llm.invoke(
    [new SystemMessage(system), new HumanMessage(human)],
    { signal: ctx.signal },
  );
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
 * first sentence of the description. No property keys, types or
 * per-property descriptions.
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
    lines.push(`  - ${et.key}${gloss}${docs.length ? ` — has long text: ${docs.join(", ")}` : ""}`);
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
  const loaded = await loadSchema(lensKey, store);
  const ctx: Ctx = {
    lensKey, question, store, loaded, view: routingView(loaded), models,
    signal: execution.signal, emit: execution.onEvent,
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

/** One decision call picks the handling path; not confident → walk or query by `many`. */
async function route(ctx: Ctx): Promise<Path> {
  const [answers, ms] = await decide(ctx, { stage: "route" }, { lens: ctx.view, question: ctx.question }, {
    path: { type: "choice", instructions: ROUTE_INSTRUCTIONS, criteria: { ...PATHS } },
    many: { type: "noul", instructions: MANY_INSTRUCTIONS },
  });
  const choice = answers.path as ChoiceAnswer;
  const many = (answers.many as NoulAnswer).noul;
  const m = margin(choice.probabilities);
  const confident = m >= ROUTE_MARGIN;
  const path = confident ? (choice.choice as Path) : walkOrQuery(many);
  await ctx.emit({
    type: "route",
    choice: choice.choice,
    path,
    probabilities: choice.probabilities,
    confidence: choice.confidence,
    margin: m,
    confident,
    fallback: confident ? null : path,
    helpers: { many },
    thresholds: { margin: ROUTE_MARGIN, many: MANY_THRESHOLD },
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
    human: `${ctx.view}\n\nQuestion: ${ctx.question}`,
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
- For a ranking, ORDER BY the aggregate DESC and return the top rows (LIMIT 10), never only one row, so ties stay visible.
- For "how many", return a count.
- _createdAt and _updatedAt are when a record was stored, not when something happened.

Example (for a schema with person -works_for-> company):
MATCH (p:person)-[:works_for]->(c:company) RETURN c._id AS id, c.name AS company, count(p) AS people ORDER BY people DESC LIMIT 10

Reply with the query only, in one \`\`\`oql code block.`;

const QUERY_ANSWER_PROMPT = `You answer a question from the result of a database query over a knowledge graph.
The query ran over all stored data: its rows are complete, not a sample, unless marked as cut.

Rules:
- Use only the rows. Give the exact numbers and names from them.
- Rows with the same name but a different id are different items.
- If several items tie, name all of them.
- State counts as numbers ("0 problems", "17 guides").
- If nothing matches, say so plainly and name what was asked for ("No projects are in maintenance status.").
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

/** The label property of an entity type: name → title → label → display_name → first string. */
function labelKeyOf(properties: Record<string, { key: string; dataType: string }>): string | null {
  for (const key of ["name", "title", "label", "display_name"]) if (key in properties) return key;
  return Object.values(properties).find((p) => p.dataType === "string")?.key ?? null;
}

/**
 * The names of every entity of a type with at most NAMES_PER_TYPE entities —
 * lets the query writer spell a named value exactly and know its type.
 */
async function smallTypeNames(ctx: Ctx): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  for (const et of Object.values(ctx.loaded.scoped.entityTypes)) {
    const labelKey = labelKeyOf(et.properties);
    if (labelKey === null) continue;
    const { results } = await service.executeQuery(
      ctx.lensKey,
      `MATCH (x:${et.key}) RETURN x.${labelKey} AS label LIMIT ${NAMES_PER_TYPE + 1}`,
      ctx.store,
    );
    if (results.length <= NAMES_PER_TYPE) {
      names.set(et.key, [...new Set(results.map((r) => String(r.label)))]);
    }
  }
  return names;
}

/** Full detail for the focus types; the others as key + gloss + property keys; names of small types. */
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
  }
  lines.push("", "System properties on every entity: _id, _createdAt, _updatedAt");
  if (names.size) {
    lines.push("", "Every stored name of the smaller entity types (exact spelling):");
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

async function queryPath(ctx: Ctx): Promise<AnswerPrompt> {
  // 1. Which entity types are involved: two independent yes/no questions per type.
  const types = Object.values(ctx.loaded.scoped.entityTypes);
  const perType = types.length <= 16 ? 2 : 1;
  const questions: Record<string, DecisionQuestion> = {};
  for (const et of types.slice(0, 32 / perType)) {
    const gloss = et.description ? firstSentence(et.description) : et.key;
    questions[`m:${et.key}`] = {
      type: "noul",
      instructions: `Does the question mention a ${et.key} (${gloss}), by kind or by name?`,
    };
    if (perType === 2) {
      questions[`a:${et.key}`] = {
        type: "noul",
        instructions: `Is "${et.key}" one of the kinds of thing the question is about?`,
      };
    }
  }
  const [answers, ms] = await decide(ctx, { stage: "schema_focus" }, { lens: ctx.view, question: ctx.question }, questions);
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
    ms,
  });

  // 2. The language model writes one query; one retry on an error or an empty result.
  const schemaText = focusedSchema(ctx, focus, await smallTypeNames(ctx));
  let human = `Question: ${ctx.question}\n\nSchema:\n${schemaText}`;
  let query = "";
  let result: { columns: string[]; results: Row[] } | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await ctx.emit({ type: "writing_query", attempt });
    query = extractQuery(await llmText(ctx, QUERY_WRITER_PROMPT, human));
    await ctx.emit({ type: "oql", attempt, query });
    try {
      result = await service.executeQuery(ctx.lensKey, query, ctx.store);
      lastError = null;
    } catch (error) {
      if (!isDomainError(error)) throw error;
      lastError = errorText(error);
    }
    const rows = result?.results ?? [];
    await ctx.emit({
      type: "rows", attempt,
      columns: result?.columns ?? [],
      rows: rows.slice(0, EVENT_ROWS).map(compactRow),
      total: rows.length,
      ...(lastError ? { error: lastError } : {}),
    });
    if (attempt === 2 || (result && rows.length > 0)) break;
    human += `\n\nYour query:\n\`\`\`oql\n${query}\n\`\`\`\n` + (result
      ? "returned no rows. If a filter may be too strict (a phrase instead of one distinctive word, " +
        "a different spelling or case), write a looser query. If no rows is the right answer, " +
        "repeat the query unchanged."
      : `failed:\n${lastError}\nWrite a corrected query.`);
    result = null;
  }

  // 3. The answer comes from the rows.
  const rows = (result?.results ?? []).map(compactRow);
  const cut = rows.length > ANSWER_ROWS;
  const storedTime = /_(created|updated)At/.test(query)
    ? "Note: the query filters on when records were stored in the database (_createdAt/_updatedAt), " +
      "not on a date the data records; say so in the answer.\n\n"
    : "";
  return {
    system: QUERY_ANSWER_PROMPT,
    human:
      `Question: ${ctx.question}\n\nSchema:\n${schemaText}\n\nQuery:\n${query}\n\n${storedTime}` +
      (result
        ? `Result: ${rows.length} row(s)${cut ? `, the first ${ANSWER_ROWS} shown (cut)` : ""}.\n` +
          rows.slice(0, ANSWER_ROWS).map((r) => JSON.stringify(r)).join("\n")
        : `The query failed twice, last error:\n${lastError}\nSay that the question could not be answered by a query.`),
  };
}

// ---------------------------------------------------------------------------
// saved_query
// ---------------------------------------------------------------------------

const PARAMETER_PROMPT = `You fill the parameters of a saved query from a question.
Reply with one JSON object only: each parameter name mapped to its value taken from the question, spelled exactly as in the question (without possessive endings such as 's), or null when the question does not give it.`;

const SAVED_ANSWER_PROMPT = `You answer a question from the result of a saved query over a knowledge graph.
The query ran over all stored data: its rows are complete, not a sample, unless marked as cut.
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
  const confident = p >= SAVED_QUERY_THRESHOLD;
  const config = ctx.loaded.savedQueries[pick.choice]!;
  await ctx.emit({
    type: "saved_query",
    choice: pick.choice,
    name: config.name,
    options: Object.fromEntries(saved.map((q) => [q.key, q.name])),
    probabilities: pick.probabilities,
    confident,
    threshold: SAVED_QUERY_THRESHOLD,
    parameters: null,
    ms,
  });
  if (!confident || !keys.includes(pick.choice)) {
    return fallback("query", `no saved query reached ${SAVED_QUERY_THRESHOLD}`);
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
    rows = ((out.results as Row[] | undefined) ?? []).map(compactRow);
    columns = (out.columns as string[] | undefined) ?? [];
  } catch (error) {
    if (!isDomainError(error)) throw error;
    await ctx.emit({ type: "rows", attempt: 1, columns: [], rows: [], total: 0, error: errorText(error) });
    return fallback("query", "the saved query failed");
  }
  await ctx.emit({ type: "rows", attempt: 1, columns, rows: rows.slice(0, EVENT_ROWS), total: rows.length });
  const cut = rows.length > ANSWER_ROWS;
  return {
    system: SAVED_ANSWER_PROMPT,
    human:
      `Question: ${ctx.question}\n\nSaved query: ${config.name} — ${config.description}\n` +
      `Parameters: ${JSON.stringify(filled)}\n\n` +
      `Result: ${rows.length} row(s)${cut ? `, the first ${ANSWER_ROWS} shown (cut)` : ""}.\n` +
      rows.slice(0, ANSWER_ROWS).map((r) => JSON.stringify(r)).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// walk
// ---------------------------------------------------------------------------

const WALK_ANSWER_PROMPT = `You answer questions about a knowledge graph.
Use only the evidence below. Each entity lists its properties and the entities it is connected to.
If the evidence does not contain the answer, say so plainly.
Be concise. Reply in the language of the question.`;

/** Leading text of a document property, flattened. */
async function excerpt(ctx: Ctx, entity: Row, key: string, chars: number): Promise<string> {
  const doc = await service.getDocument(
    ctx.lensKey, String(entity._entityTypeKey), String(entity._id), key, 0, chars, ctx.store,
  );
  return String(doc.content);
}

/**
 * `<type>: <label> — <short text> · <doc>: <leading excerpt>…` — the short
 * text being the other string properties, the excerpt the first characters
 * of each document property.
 */
async function summaryOf(ctx: Ctx, entity: Row, withExcerpt: boolean): Promise<string> {
  const label = labelOf(entity);
  const rest = Object.entries(entity)
    .filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && v !== label)
    .map(([, v]) => v as string)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, SUMMARY_CHARS);
  const docs: string[] = [];
  for (const [k, v] of Object.entries(entity)) {
    if (!withExcerpt || k.startsWith("_") || !isDocStub(v)) continue;
    const text = flat(await excerpt(ctx, entity, k, EXCERPT_CHARS * 2)).slice(0, EXCERPT_CHARS);
    if (text) docs.push(`${k}: ${text}…`);
  }
  const parts = [rest, ...docs].filter(Boolean).join(" · ");
  return `${String(entity._entityTypeKey)}: ${label}${parts ? ` — ${parts}` : ""}`;
}

const describeNeighbor = (n: Row) => {
  const rel = n.relation as Row;
  const e = n.entity as Row;
  return `${String(rel.direction)} ${String(rel._relationTypeKey)} → ${String(e._entityTypeKey)}: ${labelOf(e)}`;
};

/** Evidence entity as prompt text: properties (documents read and cut) and its neighbours. */
async function evidenceText(ctx: Ctx, entity: Row, neighbors: Row[]): Promise<string> {
  const lines = [`## ${String(entity._entityTypeKey)}: ${labelOf(entity)}`];
  for (const [key, value] of Object.entries(entity)) {
    if (key.startsWith("_") || value === null || value === undefined) continue;
    if (isDocStub(value)) {
      lines.push(`${key}:\n${await excerpt(ctx, entity, key, DOCUMENT_CHARS)}`);
    } else {
      lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  if (neighbors.length) {
    lines.push("connected to:");
    for (const n of neighbors) lines.push(`  - ${describeNeighbor(n)}`);
  }
  return lines.join("\n");
}

async function walkPath(ctx: Ctx): Promise<AnswerPrompt> {
  const { lensKey, question, store, loaded } = ctx;

  // 1. Search.
  const found = await service.search(lensKey, { query: question, limit: SEARCH_LIMIT }, store);
  const hits = found.hits.map((h) => h.entity);
  await ctx.emit({ type: "search", query: question, hits: hits.map(refOf) });

  const evidence: Row[] = [];
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
      for (const [i, h] of hits.entries()) criteria[hitKeys[i]!] = await summaryOf(ctx, h, false);
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
    let via: Row | null = null;
    const visited = new Set<string>();
    let reason = "max hops reached";
    for (let hop = 1; hop <= MAX_HOPS; hop++) {
      ctx.signal.throwIfAborted();
      await ctx.emit({ type: "reading", entityId: String(current._id) });
      const { entity, neighbors } = await service.getNeighbors(
        lensKey, String(current._entityTypeKey), String(current._id), "both", null,
        NEIGHBOR_LIMIT, store,
      );
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

      const askNext = candidates.length >= 2 && hop < MAX_HOPS;
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
      for (const e of evidence) keptSummaries.push(await summaryOf(ctx, e, false));
      const [answers, ms] = await decide(
        ctx,
        { stage: "hop", hop, entityId: String(entity._id) },
        { question, kept: keptSummaries, current: await summaryOf(ctx, entity, true) },
        questions,
      );
      const keep = (answers.keep as NoulAnswer).noul;
      const start = hop === 1;
      const kept = keep >= KEEP_THRESHOLD || start;
      if (kept) evidence.push(entity);
      const enough = (answers.enough as NoulAnswer).noul;
      const next: ChoiceAnswer | null = askNext
        ? (answers.next as ChoiceAnswer)
        : candidates.length === 1 && hop < MAX_HOPS
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
        enough,
        next: next && nextNeighbor
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

      if (enough >= ENOUGH_THRESHOLD) { reason = "enough evidence"; break; }
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
    await ctx.emit({
      type: "ready",
      reason,
      fallback: false,
      visited: visited.size,
      evidence: evidence.map(refOf),
    });
  }

  // 4. Answer from the evidence.
  const blocks: string[] = [];
  for (const entity of evidence) {
    blocks.push(await evidenceText(ctx, entity, neighborsOf.get(String(entity._id)) ?? []));
  }
  return {
    system: WALK_ANSWER_PROMPT,
    human:
      `Question: ${question}\n\nEvidence:\n\n` + (blocks.length ? blocks.join("\n\n") : "(none found)"),
  };
}
