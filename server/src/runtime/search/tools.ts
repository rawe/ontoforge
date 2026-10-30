/**
 * What the MCP and the agent search tools share: `search` runs the entity
 * search (`entitySearch.ts`), `search_documents` the passage search
 * (`passageSearch.ts`), each answering with that search's response.
 *
 * The tools take no method blocks: a model client cannot judge raw
 * similarities, so they run what can run, semantic under a fixed
 * similarity floor. The texts below are the parts of their descriptions
 * that are the same on both surfaces.
 */

import { deploymentMethods, type SearchCapabilities } from "./availability.js";
import type { ScopedSearchRequest } from "./scopedSearch.js";

/** The similarity floor of the search tools' semantic search nodes. */
export const TOOL_MIN_SIMILARITY = 0.75;

/** The method blocks a search tool sends: none — what can run — without
 * an embedding provider; with one both, semantic under the fixed floor. */
export function toolMethods(store: SearchCapabilities): Pick<ScopedSearchRequest, "keyword" | "semantic"> {
  if (!deploymentMethods(store).includes("semantic")) return {};
  return { semantic: { minSimilarity: TOOL_MIN_SIMILARITY }, keyword: {} };
}

/** The query rule of both tools. */
export const SEARCH_QUERY_RULE = "query: plain words, no operators; a result need not carry every word.";

/** How filters act in both tools. */
export const SEARCH_FILTER_EFFECT =
  "Filters narrow the result, never add what the query misses; a type that does not declare every key drops out.";

/** The floor and the caution both tools state. */
export const SEARCH_RESULT_NOTE =
  `Semantic matches below a fixed similarity floor (${TOOL_MIN_SIMILARITY}) are left out. ` +
  "Items are candidates, not verified answers.";

/** An item's entity, in both responses. */
const ENTITY = "entity (_id, _entityTypeKey, name; identity if its type has one)";

/** What an entry's scores are, in both responses. */
const SCORES =
  `scores (each method that found it: semantic, similarity ${TOOL_MIN_SIMILARITY} to 1; keyword, query words ` +
  "held plus a tie-breaking fraction below 1; not comparable; no score does not mean that method missed it; the rank " +
  "fuses both, following neither)";

/** A named search's response, as `run_named_search` answers it: the
 * entity or the passage search's, its semantic scores under the search's
 * own floors, and `queryText` where the search uses several texts. */
export const NAMED_SEARCH_RESPONSE =
  "Returns ran (methods that ran), items and limitations (what could not run: code, message, method, " +
  `indices, types). Each item has rank (from 1), ${ENTITY} and, by the search's result: entities — ` +
  "match, the entry that found it: index, part (self, relation or passage), snippet (null if this lens " +
  "hides it), a relation's relationType and target, a passage's property, charOffset and charLength; " +
  "passages — passage: property (the document), ordinal, charOffset, charLength and text. Both carry " +
  "scores (each method that found the entry: semantic, similarity 0 to 1; keyword, query words held " +
  "plus a fraction below 1; not comparable; no score does not mean that method missed it) and, when " +
  "the search runs several query texts, queryText: the text that found it.";

/** The entity search's response, as `search` answers it. */
export const ENTITY_SEARCH_RESPONSE =
  "Returns ran (methods that ran), items and limitations (what could not run: code, message, method, " +
  "indices, types). Each item has rank (from 1), " +
  `${ENTITY} and match, the entry that found it: index, part (self, relation or passage), snippet ` +
  "(the start of its text; null if this lens hides it), a relation's relationType and target (_id, " +
  `_entityTypeKey, name), a passage's property, charOffset and charLength, and ${SCORES}.`;

/** The passage search's response, as `search_documents` answers it. */
export const PASSAGE_SEARCH_RESPONSE =
  "Returns ran (methods that ran), items and limitations (what could not run: code, message, method, " +
  "indices, types, documents). Each item has rank (from 1), " +
  `${ENTITY} and passage: property (the document), ordinal, charOffset and charLength ` +
  `(characters; read it with get_document), ${SCORES}, and text unless text is false.`;
