/**
 * The agent's tools (`docs/capabilities/agents.md#tools`): ten reads of
 * one lens, built for a model that reads every result again with each
 * later step and follows what a result tells it.
 *
 * Each tool calls the runtime service function REST and MCP call — no
 * HTTP hop — and then shapes the answer for its reader:
 * - a result holds at most about `RESULT_CHARACTERS` characters, cut at
 *   whole rows or pieces (`resultSize.ts`);
 * - a result that leaves something out carries `more`: one sentence that
 *   says what is missing and names the next call;
 * - a document property is a stub in every result, whatever `fields`
 *   names; only `get_document` reads its text, a piece at a time;
 * - a wrong argument is an error the model can correct, never another
 *   meaning.
 * A description names another tool only when the agent has it.
 */

import { z } from "zod";

import type { Tool } from "../../../assistants/index.js";
import type { AgentConfig } from "../../../core/ai.js";
import { NotFoundError, ValidationError } from "../../../core/exceptions.js";
import { analyze, parse } from "../../../core/oql/index.js";
import type { RuntimeStore } from "../../../core/ports.js";
import {
  applyFieldProjection,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
  filterRules,
} from "../../readHelpers.js";
import { cpLength } from "../../codePoints.js";
import { loadSchema, type EntityTypeDef, type SchemaCacheValue } from "../../schemaCache.js";
import { deploymentMethods, type SearchCapabilities } from "../../search/availability.js";
import {
  ENTITY_SEARCH_RESPONSE,
  PASSAGE_SEARCH_RESPONSE,
  SEARCH_FILTER_EFFECT,
  SEARCH_QUERY_RULE,
  SEARCH_RESULT_NOTE,
  toolMethods,
} from "../../search/tools.js";
import * as service from "../../service.js";
import {
  TOOL_EXECUTE_QUERY,
  TOOL_GET_DOCUMENT,
  TOOL_GET_ENTITY,
  TOOL_GET_NEIGHBORS,
  TOOL_LIST_ENTITIES,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_DOCUMENTS,
  TOOL_SEARCH_SAVED_QUERIES,
  TOOL_SEARCH,
} from "../../toolNames.js";
import { entitiesEvent } from "../entities.js";
import { TurnEntities } from "./entities.js";
import { fitRows, fitText, fitValue, RESULT_CHARACTERS, size } from "./resultSize.js";

type Row = Record<string, unknown>;

/** The tools of the built-in default agent, and of an agent without an allowlist. */
export const CHAT_TOOLS = [
  TOOL_LIST_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_GET_NEIGHBORS,
  TOOL_SEARCH,
  TOOL_SEARCH_DOCUMENTS,
  TOOL_GET_DOCUMENT,
  TOOL_EXECUTE_QUERY,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_SAVED_QUERIES,
];

const EMBEDDING_TOOLS: ReadonlySet<string> = new Set([TOOL_SEARCH_SAVED_QUERIES]);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** Rows of one list page at most; a page is one result. */
const LIST_ROWS = 50;
const LIST_ROWS_DEFAULT = 20;

/** Search results at most, as the search tools have always answered. */
const SEARCH_ITEMS = 20;

/** Characters of a document one call reads at most: below the bound of a
 * result, because quotes and line breaks take more room written out as JSON. */
const DOCUMENT_PIECE = 20_000;

/** Room of the bound kept for a result's small fields and its `more` sentence. */
const NOTE_ROOM = 800;

/** The characters a neighbour's two keys and brackets take around its relation and its entity. */
const NEIGHBOUR_FRAME = 40;

/** The system fields `fields` may name beside a type's properties. */
const SYSTEM_FIELDS = ["_id", "_entityTypeKey", "_identity", "_createdAt", "_updatedAt"];

const typeKey = z.string().describe("An entity type key from the schema.");
const entityId = z.string().describe("The entity's _id, exactly as a result gave it.");

const rowLimit = (what: string, fallback: number, max: number) =>
  z.number().int().min(1).max(max).nullish().describe(`${what}: 1 to ${max}, default ${fallback}.`);

const rowOffset = z.number().int().min(0).nullish()
  .describe("Rows to skip, to read on after an earlier call; default 0.");

const fieldList = z.array(z.string()).nullish().describe(
  "Property keys to return instead of every property; _id, the type and the name are always returned. " +
  "A document property stays a stub.",
);

const filterMap = z.record(z.string(), z.string()).nullish();

/** The scope arguments a search tool was given (null: left out), under the search's names. */
function searchScope(args: Row): { types?: string[]; documents?: string[] } {
  const scope: { types?: string[]; documents?: string[] } = {};
  for (const field of ["types", "documents"] as const) {
    if (Array.isArray(args[field])) scope[field] = args[field] as string[];
  }
  return scope;
}

const quoted = (keys: Iterable<string>) => [...keys].map((key) => `'${key}'`).join(", ");

/** The keys under which the lens's entity types keep their names: an
 * entity too large for a result loses values, never the one it is called by. */
const nameKeys = (lens: SchemaCacheValue): ReadonlySet<string> =>
  new Set(Object.values(lens.entityTypes).flatMap((type) => (type.nameProperty === null ? [] : [type.nameProperty])));

/** What a neighbour's relation keeps whatever it loses. */
const RELATION_KEPT: ReadonlySet<string> = new Set(["direction"]);

/** The lens's entity type, or the not-found error every entity read gives. */
function entityType(lens: SchemaCacheValue, key: string): EntityTypeDef {
  const type = lens.entityTypes[key];
  if (type === undefined) throw new NotFoundError(`Entity type '${key}' not found`);
  return type;
}

/** The `fields` argument, checked against the properties it may name; null when left out. */
function checkedFields(fields: unknown, known: ReadonlySet<string>, where: string): string[] | null {
  if (!Array.isArray(fields)) return null;
  const unknown = (fields as string[]).filter((field) => !known.has(field) && !SYSTEM_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown field(s) ${quoted(unknown)} ${where}. Properties: ${quoted(known)}`);
  }
  return fields as string[];
}

/** An entity with only `fields` and what is always returned: its id, its
 * type, its identity and its name — what the model needs to name it and
 * the web client to show it. Documents are stubs already and stay stubs. */
function selected(entity: Row, fields: string[] | null, type: EntityTypeDef | undefined): Row {
  if (fields === null) return entity;
  const name = type?.nameProperty ?? null;
  return applyFieldProjection(entity, name === null ? fields : [...fields, name], ENTITY_NEIGHBOR_ALWAYS_FIELDS);
}

// ---------------------------------------------------------------------------
// What a result says about what it left out
// ---------------------------------------------------------------------------

const LONG_VALUE_CUT =
  "A value too long for one result was cut; it says how much of it is shown. Asking again returns the " +
  "same part: only a document property can be read in pieces.";

/** `more` for a result that left something out, from the sentences that apply. */
const more = (...sentences: (string | false)[]): { more?: string } => {
  const said = sentences.filter((sentence): sentence is string => sentence !== false);
  return said.length === 0 ? {} : { more: said.join(" ") };
};

/**
 * One page of `rows` from `offset`: the leading rows that fit the size
 * rule, and the sentences that say which rows these are of `total` and
 * how `again` gets the next ones. Rows before `offset` are skipped here
 * when `rows` holds the whole result (`skip`), else by the read itself.
 */
function page(
  rows: Row[],
  offset: number,
  total: number,
  again: string,
  skip: boolean,
  names: ReadonlySet<string>,
  room = RESULT_CHARACTERS - NOTE_ROOM,
): { rows: Row[]; said: (string | false)[] } {
  const fitted = fitRows(skip ? rows.slice(offset) : rows, room, names);
  const shown = fitted.rows.length;
  const end = offset + shown;
  return {
    rows: fitted.rows,
    said: [
      end < total && `Showing rows ${offset + 1}-${end} of ${total}. If you need more, ${again} and offset: ${end}.`,
      shown === 0 && total > 0 && offset > 0 && `No rows from offset ${offset}: there are ${total} rows.`,
      fitted.cut && LONG_VALUE_CUT,
    ],
  };
}

/**
 * The fields a result carries beside its rows, within their part of the
 * bound, and the room they leave the rows. They are small as a rule; a
 * large one — a column named at length, many limitations — is shrunk.
 */
function beside(fields: Row): { fields: Row; cut: boolean; room: number } {
  const fitted = fitValue(fields, RESULT_CHARACTERS / 2);
  return { fields: fitted.value, cut: fitted.cut, room: RESULT_CHARACTERS - NOTE_ROOM - size(fitted.value) };
}

/** Whether an OQL text orders its rows; true when it cannot be read, so no warning is made up. */
function ordered(oql: string): boolean {
  try {
    return analyze(parse(oql).tree).ordered;
  } catch {
    return true;
  }
}

const UNORDERED = "Without ORDER BY the order of rows can change between calls.";

/** Rows are keyed by their columns' names: names that fill a result leave
 * no room for rows, and shortening them would part them from their rows. */
function checkColumns(columns: unknown): void {
  if (size(columns) > RESULT_CHARACTERS / 4) {
    throw new ValidationError(
      `The column names of this result take ${size(columns)} characters. Give the columns short names with AS.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tool definitions — instantiated selectively per run
// ---------------------------------------------------------------------------

interface AgentToolDef {
  name: string;
  /** The description for an agent with the `granted` tools. */
  description: (granted: ReadonlySet<string>) => string;
  input: z.ZodType;
  run: (lensKey: string, store: RuntimeStore, args: Row, granted: ReadonlySet<string>) => Promise<unknown>;
}

const DOCUMENT_STUB = 'A document property comes as {"document": true, "length": N}, never as text';

/** How a result's document stub is read, for an agent that can and one that cannot. */
const stubReading = (granted: ReadonlySet<string>) =>
  granted.has(TOOL_GET_DOCUMENT)
    ? `${DOCUMENT_STUB}; read it with get_document.`
    : `${DOCUMENT_STUB}; its text is not available to you.`;

const AGENT_TOOL_DEFS: AgentToolDef[] = [
  {
    name: TOOL_LIST_ENTITIES,
    description: (granted) =>
      "List the entities of one type, a page at a time. Use it to browse a type, to find entities by their " +
      "property values, and to answer a question about connections in one call with a filter through a " +
      "relation type. Returns {items, total, limit, offset}: total counts every match, items are one page. " +
      "When rows are left out, 'more' says which and how to get them. " +
      "Use 'filters' to filter on specific properties: exact match " +
      '("name": "Alice"), greater than ("age__gt": "25"), greater or equal ' +
      '("__gte"), less than ("__lt"), less or equal ("__lte"), contains ' +
      '("name__contains": "ali"). All filter values must be strings. ' +
      "A filter key may also reach through ONE relation type, which answers a " +
      "question about connections in a single call. Write the relation type key, then a " +
      "dot for a property of the entity at the other end, or an at sign for a " +
      'property of the relation itself. Listing person: ("works_for.name": ' +
      '"Acme") are the people employed by Acme, ("works_for@role": "CTO") those ' +
      'whose employment role is CTO, ("works_for@since__gte": "2021-01-01") ' +
      "those employed since 2021. Every relation type of the schema that starts or ends at the listed " +
      "type can be used this way. The direction follows the relation type's " +
      "endpoints, so it needs no marker. A relation type that joins one type to " +
      "itself is the exception: there the direction cannot be derived, and the " +
      `error tells you which marker to add. ${stubReading(granted)}`,
    input: z.strictObject({
      entity_type_key: typeKey,
      search: z.string().nullish()
        .describe("A word or phrase to find, ignoring case, anywhere in any string property."),
      filters: filterMap.describe('Conditions that must all hold, as {"key": "value"}; values are strings.'),
      sort: z.string().nullish()
        .describe("A property key, _createdAt or _updatedAt to sort by; default _createdAt."),
      order: z.enum(["asc", "desc"]).nullish().describe("Sort direction; default asc."),
      fields: fieldList,
      limit: rowLimit("Rows of the page", LIST_ROWS_DEFAULT, LIST_ROWS),
      offset: rowOffset,
    }),
    run: async (lensKey, store, args) => {
      const key = args.entity_type_key as string;
      const lens = (await loadSchema(lensKey, store)).scoped;
      const type = entityType(lens, key);
      const properties = new Set(Object.keys(type.properties));
      const fields = checkedFields(args.fields, properties, `on '${key}'`);
      const sort = (args.sort as string | null | undefined) ?? "_createdAt";
      const sortable = [...properties, "_createdAt", "_updatedAt", ...(type.identityProperties === null ? [] : ["_identity"])];
      if (!sortable.includes(sort)) {
        throw new ValidationError(`Unknown sort field '${sort}' on '${key}'. Sort by one of: ${quoted(sortable)}`);
      }
      const limit = (args.limit as number | null | undefined) ?? LIST_ROWS_DEFAULT;
      const offset = (args.offset as number | null | undefined) ?? 0;
      const listed = await service.listEntities(
        lensKey,
        key,
        limit,
        offset,
        sort,
        (args.order as string | null | undefined) ?? "asc",
        (args.search as string | null | undefined) ?? null,
        (args.filters as Record<string, string> | null | undefined) ?? {},
        store,
      );
      const rows = (listed.items as Row[]).map((entity) => selected(entity, fields, type));
      const shown = page(rows, offset, listed.total, "call list_entities again with the same arguments", false, nameKeys(lens));
      return { items: shown.rows, total: listed.total, limit, offset, ...more(...shown.said) };
    },
  },
  {
    name: TOOL_GET_ENTITY,
    description: (granted) =>
      "Read one entity by its _id: every property, or the ones 'fields' names. Use it when you have an " +
      `entity's _id and need its values. ${stubReading(granted)}`,
    input: z.strictObject({
      entity_type_key: typeKey,
      entity_id: entityId,
      fields: fieldList,
    }),
    run: async (lensKey, store, args) => {
      const key = args.entity_type_key as string;
      const lens = (await loadSchema(lensKey, store)).scoped;
      const type = entityType(lens, key);
      const fields = checkedFields(args.fields, new Set(Object.keys(type.properties)), `on '${key}'`);
      const entity = await service.getEntity(lensKey, key, args.entity_id as string, store);
      // A value cut here says so itself: an entity has no room for a note beside its properties.
      return fitValue(selected(entity, fields, type), RESULT_CHARACTERS - NOTE_ROOM, nameKeys(lens)).value;
    },
  },
  {
    name: TOOL_GET_NEIGHBORS,
    description: () =>
      "Read what one entity is connected to: the entity itself and each neighbour with the relation that " +
      "joins them. Use it when you have an entity's _id and want its connections. direction: outgoing " +
      "(relations that start at the entity), incoming (relations that end at it) or both. " +
      "relation_type_key keeps one relation type only. Returns {entity, neighbors}; each neighbour is " +
      "{relation, entity}, the relation with its type, its direction and its own properties. limit counts " +
      "per direction. When neighbours are left out, 'more' says so: the result is then not the whole " +
      "neighbourhood. A document property comes as {\"document\": true, \"length\": N}, never as text.",
    input: z.strictObject({
      entity_type_key: typeKey,
      entity_id: entityId,
      direction: z.enum(["outgoing", "incoming", "both"]).nullish()
        .describe("Which relations to follow; default both."),
      relation_type_key: z.string().nullish()
        .describe("A relation type key from the schema: only neighbours over this relation type."),
      fields: fieldList,
      limit: rowLimit("Neighbours per direction", LIST_ROWS_DEFAULT, LIST_ROWS),
    }),
    run: async (lensKey, store, args, granted) => {
      const key = args.entity_type_key as string;
      const lens = (await loadSchema(lensKey, store)).scoped;
      entityType(lens, key);
      const relationType = (args.relation_type_key as string | null | undefined) ?? null;
      if (relationType !== null && !(relationType in lens.relationTypes)) {
        throw new NotFoundError(
          `Relation type '${relationType}' not found. Relation types: ${quoted(Object.keys(lens.relationTypes))}`,
        );
      }
      const everyProperty = new Set(Object.values(lens.entityTypes).flatMap((type) => Object.keys(type.properties)));
      const fields = checkedFields(args.fields, everyProperty, "on the entity types of this lens");
      const limit = (args.limit as number | null | undefined) ?? LIST_ROWS_DEFAULT;
      const direction = (args.direction as string | null | undefined) ?? "both";

      // Each direction is read on its own, one row beyond the limit: no
      // direction takes the other's room, and a longer one is known.
      let centre: Row = {};
      const neighbours: Row[] = [];
      const longer: string[] = [];
      for (const side of direction === "both" ? ["outgoing", "incoming"] : [direction]) {
        const read = await service.getNeighbors(lensKey, key, args.entity_id as string, side, relationType, limit + 1, store);
        centre = read.entity;
        if (read.neighbors.length > limit) longer.push(side);
        neighbours.push(...(read.neighbors.slice(0, limit) as Row[]));
      }

      // The entity may take the whole result when it has no neighbours to show, else half of it.
      const whole = RESULT_CHARACTERS - NOTE_ROOM;
      const names = nameKeys(lens);
      const entity = fitValue(selected(centre, fields, lens.entityTypes[key]), neighbours.length === 0 ? whole : whole / 2, names);
      const room = whole - size(entity.value);
      // A neighbour that fits the result stays as it is. One that is larger
      // alone is a relation and an entity, each shortened inside — the
      // relation within half the room, the entity within what is left — so
      // the neighbour keeps both.
      let shortened = false;
      const rows = neighbours.map((neighbour) => {
        const other = neighbour.entity as Row;
        const row = { ...neighbour, entity: selected(other, fields, lens.entityTypes[String(other._entityTypeKey)]) };
        if (size(row) <= room) return row;
        shortened = true;
        const relation = fitValue(neighbour.relation as Row, Math.floor(room / 2), RELATION_KEPT).value;
        return { ...row, relation, entity: fitValue(row.entity, room - NEIGHBOUR_FRAME - size(relation), names).value };
      });
      const fitted = fitRows(rows, room, names);
      const narrow = [
        relationType === null && "relation_type_key",
        direction === "both" && "direction",
        fields === null && "fields",
      ].filter((way): way is string => way !== false);
      const left = longer.length > 0 || fitted.rows.length < rows.length;
      return {
        entity: entity.value,
        neighbors: fitted.rows,
        ...more(
          ...longer.map((side) => `More ${side} neighbours exist than the ${limit} read.`),
          fitted.rows.length < rows.length &&
            `Only the first ${fitted.rows.length} of the ${rows.length} neighbours read fit this result.`,
          left && narrow.length > 0 && `To see others, narrow with ${narrow.join(", ")}.`,
          longer.length > 0 && limit < LIST_ROWS && `Or raise limit, up to ${LIST_ROWS}.`,
          // With neighbours the entity had half the result: get_entity gives it the whole.
          entity.cut && neighbours.length > 0 && "A long value of the entity was cut to leave room for its neighbours." +
            (granted.has(TOOL_GET_ENTITY) ? " get_entity returns more of it." : ""),
          shortened && "A long value of a neighbour was cut to fit this result.",
          entity.cut && neighbours.length === 0 && LONG_VALUE_CUT,
        ),
      };
    },
  },
  {
    name: TOOL_SEARCH,
    description: () =>
      "Rank entities for a text, best first. Use it to find entities by meaning or by words when you do " +
      "not know their exact values. " + SEARCH_QUERY_RULE + " " +
      "types: entity type keys to search, their own fields and their documents' passages; omit to " +
      "search every type. " +
      filterRules({ contains: false, relations: true }) + " " +
      SEARCH_FILTER_EFFECT + " " +
      ENTITY_SEARCH_RESPONSE + " " + SEARCH_RESULT_NOTE,
    input: z.strictObject({
      query: z.string().describe("The text to rank for: plain words."),
      types: z.array(z.string()).nullish().describe("Entity type keys to search; omit for every type."),
      filters: filterMap.describe('Conditions that must all hold, as {"key": "value"}; values are strings.'),
      limit: rowLimit("Entities returned", 10, SEARCH_ITEMS),
    }),
    run: async (lensKey, store, args) => {
      const found = await service.searchEntities(
        lensKey,
        {
          query: args.query as string,
          ...searchScope(args),
          ...toolMethods(store),
          filter: (args.filters as Record<string, string> | null | undefined) ?? {},
          limit: (args.limit as number | null | undefined) ?? 10,
        },
        store,
      );
      const { items, ...rest } = found;
      const other = beside(rest);
      const fitted = fitRows(items, other.room);
      return {
        ...other.fields,
        items: fitted.rows,
        ...more(
          fitted.rows.length < items.length &&
            `Only the first ${fitted.rows.length} of ${items.length} found entities fit this result. ` +
            "Narrow with types or filters, or ask for fewer with limit.",
          (fitted.cut || other.cut) && LONG_VALUE_CUT,
        ),
      };
    },
  },
  {
    name: TOOL_SEARCH_DOCUMENTS,
    description: (granted) =>
      "Rank passages of documents for a text, best first: a passage is one chunk of one entity's document. " +
      "Use it to find where a document says something. " +
      SEARCH_QUERY_RULE + " " +
      "Scope, at most one of: types (entity type keys: all their documents) or documents ('type.property', " +
      'e.g. "person.bio"); neither searches every document. ' + filterRules({ contains: false, relations: true }) +
      " They apply to the document's entity. " + SEARCH_FILTER_EFFECT + " " +
      PASSAGE_SEARCH_RESPONSE.replace(
        " (characters; read it with get_document)",
        granted.has(TOOL_GET_DOCUMENT) ? " (characters; read it with get_document)" : " (characters)",
      ) + " " + SEARCH_RESULT_NOTE,
    input: z.strictObject({
      query: z.string().describe("The text to rank for: plain words."),
      types: z.array(z.string()).nullish().describe("Entity type keys whose documents to search."),
      documents: z.array(z.string()).nullish().describe("Documents to search, each as 'type.property'."),
      filters: filterMap.describe('Conditions on the document\'s entity that must all hold, as {"key": "value"}.'),
      limit: rowLimit("Passages returned", 5, SEARCH_ITEMS),
      per_entity: z.number().int().min(1).nullish()
        .describe("At most this many passages per entity; omit for no cap."),
      text: z.boolean().nullish().describe("false leaves out each passage's text; default true."),
    }),
    run: async (lensKey, store, args) => {
      const found = await service.searchPassages(
        lensKey,
        {
          query: args.query as string,
          ...searchScope(args),
          ...toolMethods(store),
          filter: (args.filters as Record<string, string> | null | undefined) ?? {},
          limit: (args.limit as number | null | undefined) ?? 5,
          ...(typeof args.per_entity === "number" ? { perEntity: args.per_entity } : {}),
          ...(typeof args.text === "boolean" ? { text: args.text } : {}),
        },
        store,
      );
      const { items, ...rest } = found;
      const other = beside(rest);
      const fitted = fitRows(items, other.room);
      return {
        ...other.fields,
        items: fitted.rows,
        ...more(
          fitted.rows.length < items.length &&
            `Only the first ${fitted.rows.length} of ${items.length} found passages fit this result. ` +
            (args.text === false
              ? "Narrow with types, documents or filters."
              : "Call again with text: false to get every passage without its text."),
          (fitted.cut || other.cut) && LONG_VALUE_CUT,
        ),
      };
    },
  },
  {
    name: TOOL_GET_DOCUMENT,
    description: (granted) =>
      "Read the text of a document property, a piece at a time. Document properties hold long text and " +
      'never come inline: other tools show them as {"document": true, "length": N}. offset and limit ' +
      `count characters. Without limit you get the first piece from offset, at most ${DOCUMENT_PIECE} ` +
      "characters. When the text goes on after a piece, 'more' names the offset of the next one. Read only " +
      "the part you need" +
      (granted.has(TOOL_SEARCH_DOCUMENTS)
        ? ": to read one passage search_documents found, pass its property, charOffset and charLength as " +
          "property_key, offset and limit. "
        : ". ") +
      "Returns {propertyKey, content, offset, length, totalLength}: length is the content's, totalLength " +
      "the whole document's.",
    input: z.strictObject({
      entity_type_key: typeKey,
      entity_id: entityId,
      property_key: z.string().describe("The key of a document property of the entity type."),
      offset: z.number().int().min(0).nullish().describe("The character to start at; default 0."),
      limit: z.number().int().min(1).max(DOCUMENT_PIECE).nullish()
        .describe(`Characters to read: 1 to ${DOCUMENT_PIECE}, default ${DOCUMENT_PIECE}.`),
    }),
    run: async (lensKey, store, args) => {
      const piece = await service.getDocument(
        lensKey,
        args.entity_type_key as string,
        args.entity_id as string,
        args.property_key as string,
        (args.offset as number | null | undefined) ?? 0,
        (args.limit as number | null | undefined) ?? DOCUMENT_PIECE,
        store,
      );
      // The piece as it fits the result written out: text full of quotes,
      // line breaks or control characters ends earlier than it was read.
      const { content: read, ...rest } = piece as { content: string } & Row;
      const content = fitText(read, RESULT_CHARACTERS - NOTE_ROOM - size(rest));
      const start = piece.offset as number;
      const end = start + cpLength(content);
      const total = piece.totalLength as number;
      // Whatever the piece's size, the model is told when the text goes on:
      // it does not work that out from the lengths.
      return {
        ...rest,
        content,
        length: end - start,
        ...more(
          end < total &&
            `Showing characters ${start}-${end} of ${total}. To read on, call get_document again with offset: ${end}.`,
        ),
      };
    },
  },
  {
    name: TOOL_EXECUTE_QUERY,
    description: (granted) =>
      "Run a read-only OQL query (openCypher-style graph patterns) over the lens. Use it to count, sort, " +
      "aggregate, combine conditions, or follow relations over several steps. " +
      "Use entity type keys (snake_case) as node labels and relation type keys " +
      "as relationship types. ALL node patterns MUST have a label. " +
      "Clauses: MATCH, OPTIONAL MATCH, WHERE, WITH (once), RETURN, ORDER BY, SKIP, LIMIT, AS. " +
      "Conditions: = <> < <= > >=, AND, OR, NOT, IN, IS NULL, IS NOT NULL, and CONTAINS for a substring " +
      "(case-sensitive, no regex). Functions: count(*), count(x), sum, avg, min, max, collect; no others. " +
      "No writes, no CALL. Return the properties you need (p.name) rather than whole nodes: rows stay " +
      "small. Returns {columns, results}. When rows are left out, 'more' says which and how to get them. " +
      'RETURN p.bio answers a document property as a stub {"document": true, "length": N}, not as its text' +
      (granted.has(TOOL_GET_DOCUMENT) ? "; read the text with get_document. " : ". ") +
      "If the query fails, read the error: it lists the available types and properties. " +
      "Examples: " +
      "MATCH (p:person)-[r:works_for]->(c:company) WHERE c.name = 'Acme' RETURN p.name, r.role | " +
      "MATCH (p:person) RETURN count(*) AS people | " +
      "MATCH (p:person) WHERE p.age > 30 RETURN p.name, p.age ORDER BY p.age DESC LIMIT 10",
    input: z.strictObject({
      query: z.string().describe("The OQL query."),
      offset: rowOffset,
    }),
    run: async (lensKey, store, args) => {
      const query = args.query as string;
      const { columns, results } = await service.executeQuery(lensKey, query, store);
      const offset = (args.offset as number | null | undefined) ?? 0;
      checkColumns(columns);
      const other = beside({ columns });
      const names = nameKeys((await loadSchema(lensKey, store)).scoped);
      const shown = page(results, offset, results.length, "call execute_query again with the same query", true, names, other.room);
      const rowsLeft = offset + shown.rows.length < results.length;
      return {
        ...other.fields,
        results: shown.rows,
        ...more(
          ...shown.said,
          rowsLeft && !ordered(query) && UNORDERED,
          rowsLeft && "To get fewer rows, return fewer columns, add WHERE or LIMIT, or count with count(*).",
        ),
      };
    },
  },
  {
    name: TOOL_LIST_SAVED_QUERIES,
    description: () =>
      "List the saved queries of this lens: queries a person prepared, each run by its key. " +
      "Each has a key, name, description, and parameter definitions (name, description, dataType).",
    input: z.strictObject({}),
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
    description: (granted) => {
      const finders = [TOOL_LIST_SAVED_QUERIES, TOOL_SEARCH_SAVED_QUERIES].filter((name) => granted.has(name));
      return (
        "Run a saved query, a query a person prepared for this lens, by its key, with a value for each of " +
        "its parameters. Prefer it when one fits the question. " +
        (finders.length > 0 ? `Find the keys and their parameters with ${finders.join(" or ")} first. ` : "") +
        "Answers with the last step's output: {columns, results} " +
        "for an oql step; for a search step {ran, items, limitations}, each item a rank, the " +
        "found entity (_id, _entityTypeKey, name) and the entry that matched. When rows are left out, " +
        "'more' says which and how to get them."
      );
    },
    input: z.strictObject({
      query_key: z.string().describe("The saved query's key."),
      params: z.record(z.string(), z.unknown()).nullish()
        .describe("A value for every parameter the saved query declares, by parameter name."),
      offset: rowOffset,
    }),
    run: async (lensKey, store, args) => {
      const key = args.query_key as string;
      const output = await service.executeSavedQuery(lensKey, key, (args.params as Row | null | undefined) ?? {}, store);
      // An oql step answers rows under `results`, a search step under `items`.
      const rowsKey = Array.isArray(output.results) ? "results" : "items";
      const { [rowsKey]: answered, ...rest } = output;
      checkColumns(rest.columns);
      const rows = (answered ?? []) as Row[];
      const offset = (args.offset as number | null | undefined) ?? 0;
      const other = beside(rest);
      const loaded = await loadSchema(lensKey, store);
      const shown = page(rows, offset, rows.length, "call run_saved_query again with the same arguments", true, nameKeys(loaded.scoped), other.room);
      // The last step's rows are the answer: a page of them is stable only when that step orders them.
      const last = loaded.savedQueries[key]?.steps.at(-1);
      const unordered = last?.type === "oql" && !ordered(last.oql ?? "");
      return {
        ...other.fields,
        [rowsKey]: shown.rows,
        ...more(
          ...shown.said,
          offset + shown.rows.length < rows.length && unordered && UNORDERED,
          other.cut && LONG_VALUE_CUT,
        ),
      };
    },
  },
  {
    name: TOOL_SEARCH_SAVED_QUERIES,
    description: () =>
      "Search saved queries by semantic similarity to a natural language query. " +
      "Returns the most relevant saved queries ranked by how well their " +
      "description matches your query. Use this to find the right saved query " +
      "for a user's intent instead of listing all queries.",
    input: z.strictObject({
      query: z.string().describe("What the saved query should answer, in plain words."),
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

/** A not-found or validation error as the model reads it: its message with
 * what its details name — the fields at fault, or the collected errors with
 * their hints — so the next attempt can be right. */
function correction(error: NotFoundError | ValidationError): string {
  const details = error.details as { fields?: Record<string, unknown>; errors?: unknown[] } | null;
  const named = details?.fields !== undefined
    ? Object.entries(details.fields).map(([key, value]) => `${key}: ${String(value)}`)
    : (details?.errors ?? []).map(String);
  const text = named.join("; ");
  return text === "" || error.message.includes(text) ? error.message : `${error.message}: ${text}`;
}

/** Not-found and validation errors go back to the model, which corrects
 * itself. An error is a result too, and holds no more than one: it can
 * repeat an argument of any length. */
function selfCorrectable(error: unknown): { error: string } | undefined {
  if (!(error instanceof NotFoundError || error instanceof ValidationError)) return undefined;
  return fitValue({ error: correction(error) }, RESULT_CHARACTERS - NOTE_ROOM).value;
}

/** A result's entities the turn has not sent yet, as the shared `entities` event. */
const unsentEntities = (name: string) => (args: Row, result: unknown, entities: TurnEntities) => {
  const found = entities.unsent(name, args, result);
  return found.entities.length > 0 || found.links.length > 0 ? [entitiesEvent(found.entities, found.links)] : [];
};

/** The named tools, bound to one lens; the turn's entities present their results. */
export function buildTools(lensKey: string, store: RuntimeStore, toolNames: string[]): Tool<TurnEntities>[] {
  const granted: ReadonlySet<string> = new Set(toolNames.filter((name) => AGENT_TOOL_DEFS_BY_NAME.has(name)));
  return [...granted].map((name) => {
    const def = AGENT_TOOL_DEFS_BY_NAME.get(name)!;
    return {
      name, description: def.description(granted), input: def.input,
      run: (args: Row) => def.run(lensKey, store, args, granted),
      expected: selfCorrectable,
      present: unsentEntities(name),
    };
  });
}

/** The tools of `tools` this deployment cannot run: the embedding-dependent
 * ones without an embedding provider, the search tools when no search
 * method can run. */
export function unavailableTools(tools: readonly string[], store: SearchCapabilities): string[] {
  const methods = deploymentMethods(store);
  const hasEmbedding = methods.includes("semantic");
  const hasSearch = methods.length > 0;
  return tools.filter(
    (t) =>
      (EMBEDDING_TOOLS.has(t) && !hasEmbedding) ||
      ([TOOL_SEARCH, TOOL_SEARCH_DOCUMENTS].includes(t) && !hasSearch),
  );
}

/** Effective toolset: allowlist ∩ available — the unavailable tools are
 * dropped for the default agent and explicit allowlists alike. */
export function resolveChatToolNames(agentConfig: AgentConfig, store: RuntimeStore): string[] {
  const tools = agentConfig.tools ?? CHAT_TOOLS;
  const unavailable = new Set(unavailableTools(tools, store));
  return tools.filter((t) => ALL_TOOL_NAMES.has(t) && !unavailable.has(t));
}
