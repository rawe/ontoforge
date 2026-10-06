/**
 * The query side of search indices, the pure part: which indices a lens
 * may search, the bilingual keyword query, grouping ranked entries by
 * entity and fusing the per-mode rankings, and the snippet of a match.
 *
 * Pure — no storage, no I/O. The service (`runtime/search/indexSearch.ts`)
 * ranks the entries of each index's active generation, merges them per
 * representation and hands the mode rankings here.
 */

import type { KeywordMatching } from "./ports.js";
import {
  effectiveHeader,
  type SearchIndexDefinition,
  type SearchIndexSchema,
  type SearchRepresentation,
} from "./searchIndex.js";

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** What of a lens decides which indices it may search. */
export interface LensIndexScope {
  /** Whether the lens has type inclusions — index inclusions alone do
   * not make a lens scoped. */
  scoped: boolean;
  /** The entity types the lens exposes. */
  exposedEntityTypes: ReadonlySet<string>;
  /** The indices a scoped lens includes, by key. */
  includedIndices: ReadonlySet<string>;
}

/**
 * The indices a lens may search: an unscoped lens every index, a scoped
 * lens the indices it includes — each only while the lens exposes the
 * index's root type. Switched-off managed indices are never searchable.
 */
export function availableIndices<T extends { key: string; definition: { entityType: string } }>(
  indices: readonly T[],
  lens: LensIndexScope,
  disabled: ReadonlySet<string>,
): T[] {
  return indices.filter(
    (index) =>
      !disabled.has(index.key) &&
      lens.exposedEntityTypes.has(index.definition.entityType) &&
      (!lens.scoped || lens.includedIndices.has(index.key)),
  );
}

/** One way a lens limits an index it includes. */
export interface LensIndexFinding {
  /** `rootHidden`: the lens does not expose the root type — the index is
   * not searchable in it. `hiddenProperty`: the index reads a property
   * the lens hides (D3) — its entry texts carry hidden values. */
  kind: "rootHidden" | "hiddenProperty";
  /** Dotted path into the definition. */
  path: string;
  message: string;
}

/**
 * How a lens limits an index: its root type hidden (nothing else is
 * reported then), or every property it reads that the lens hides — own
 * and header fields of the root, relation and target fields of the
 * groups the lens shows. A group whose relation type, or the entity type
 * on its other end, the lens hides is not reported: its entries are
 * skipped at query time, no rebuild, no warning (spec §4). `full` and
 * `scoped` are the schema before and after the lens's scope; an unscoped
 * lens limits nothing. Lens validation reports these as warnings; the
 * search withholds snippets of indices with any.
 */
export function lensIndexFindings(
  definition: SearchIndexDefinition,
  full: SearchIndexSchema,
  scoped: SearchIndexSchema,
): LensIndexFinding[] {
  const index = `Search index '${definition.key}'`;
  const root = full.entityTypes[definition.entityType];
  const visibleRoot = scoped.entityTypes[definition.entityType];
  if (root === undefined || visibleRoot === undefined) {
    return [
      {
        kind: "rootHidden",
        path: "entityType",
        message:
          `${index} is not searchable in this lens: its root entity type ` +
          `'${definition.entityType}' is not included`,
      },
    ];
  }
  const findings: LensIndexFinding[] = [];
  const hidden = (
    owner: { properties: Record<string, unknown> },
    ownerText: string,
    keys: readonly string[],
    path: (i: number) => string,
  ) => {
    keys.forEach((key, i) => {
      if (!(key in owner.properties)) {
        findings.push({
          kind: "hiddenProperty",
          path: path(i),
          message: `${index} reads property '${key}' of ${ownerText}, which this lens hides`,
        });
      }
    });
  };
  const rootText = `entity type '${definition.entityType}'`;
  hidden(visibleRoot, rootText, definition.fields, (i) => `fields.${i}`);
  // Header fields already reported as own fields are not reported twice.
  const header = effectiveHeader(definition, root);
  const headerOnly = header.filter((key) => !definition.fields.includes(key));
  hidden(visibleRoot, rootText, headerOnly, (i) =>
    definition.header === null ? "header" : `header.${definition.header.indexOf(headerOnly[i]!)}`,
  );

  definition.relations.forEach((group, g) => {
    const relationType = scoped.relationTypes[group.relationType];
    if (relationType === undefined) return;
    const otherEnd =
      group.direction === "outgoing" ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
    if (scoped.entityTypes[otherEnd] === undefined) return;
    hidden(relationType, `relation type '${group.relationType}'`, group.fields, (i) => `relations.${g}.fields.${i}`);
    for (const [targetType, fields] of Object.entries(group.target)) {
      const target = scoped.entityTypes[targetType];
      if (target === undefined) continue;
      hidden(target, `entity type '${targetType}'`, fields, (i) => `relations.${g}.target.${targetType}.${i}`);
    }
  });
  return findings;
}

/**
 * Whether an index reads a property the lens hides: an own field or
 * header field of the root, or a relation or target field of a group the
 * lens shows (entries of hidden groups are skipped anyway) — or its root
 * type is hidden (`lensIndexFindings`). An included index may (D3); its
 * entry texts then carry hidden values.
 */
export function readsHiddenProperties(
  definition: SearchIndexDefinition,
  full: SearchIndexSchema,
  scoped: SearchIndexSchema,
): boolean {
  return lensIndexFindings(definition, full, scoped).length > 0;
}

// ---------------------------------------------------------------------------
// Keyword query
// ---------------------------------------------------------------------------

/** One lexeme as a quoted prefix term — no caller input reaches tsquery
 * syntax. */
function prefixTerm(lexeme: string): string {
  return `'${lexeme.replaceAll("\\", "\\\\").replaceAll("'", "''")}':*`;
}

/**
 * The bilingual keyword query: per language of the generation's set, the
 * query's stemmed lexemes as prefix terms — any term (`|`) or every term
 * (`&`) — and the languages OR-ed, so a query matches in whichever
 * language stems it the way the entry was stemmed. Null when no language
 * yields a lexeme (only stop words): the query matches nothing.
 */
export function keywordTsquery(
  lexemesPerLanguage: readonly (readonly string[])[],
  matching: KeywordMatching,
): string | null {
  const operator = matching === "all" ? " & " : " | ";
  const clauses = lexemesPerLanguage
    .filter((lexemes) => lexemes.length > 0)
    .map((lexemes) => `(${lexemes.map(prefixTerm).join(operator)})`);
  const unique = [...new Set(clauses)];
  return unique.length === 0 ? null : unique.join(" | ");
}

/** One token of the keyword query as one language of the set reads it:
 * the token's position in the query, and the lexemes that language's
 * dictionaries make of it (null or empty: none, e.g. a stop word). Every
 * language parses with the same parser, so positions align. */
export interface KeywordQueryToken {
  language: number;
  token: number;
  lexemes: readonly string[] | null;
}

/** The keyword query of one search: what matches (`tsquery`, as
 * `keywordTsquery`), and one query per query word — its lexemes in every
 * language, OR-ed — to count the words an entry contains. */
export interface KeywordQuery {
  tsquery: string;
  words: string[];
}

/**
 * The keyword query from the query's tokens per language. A word stemmed
 * differently in German and English is still one word; a word repeated in
 * the query counts once. Null when no token yields a lexeme.
 */
export function keywordQuery(
  tokens: readonly KeywordQueryToken[],
  matching: KeywordMatching,
): KeywordQuery | null {
  const perLanguage = new Map<number, string[]>();
  const perWord = new Map<number, Set<string>>();
  for (const { language, token, lexemes } of tokens) {
    for (const lexeme of lexemes ?? []) {
      const own = perLanguage.get(language) ?? [];
      if (!own.includes(lexeme)) own.push(lexeme);
      perLanguage.set(language, own);
      perWord.set(token, (perWord.get(token) ?? new Set()).add(lexeme));
    }
  }
  const tsquery = keywordTsquery(
    [...perLanguage].sort(([a], [b]) => a - b).map(([, lexemes]) => lexemes),
    matching,
  );
  if (tsquery === null) return null;
  const words = [...perWord]
    .sort(([a], [b]) => a - b)
    .map(([, lexemes]) => [...lexemes].map(prefixTerm).join(" | "));
  return { tsquery, words: [...new Set(words)] };
}

/**
 * The keyword score of an entry: the number of query words it contains,
 * then — as a fraction below 1 — its `ts_rank_cd` cover density. An entry
 * with more of the query's words always ranks above one with fewer; the
 * score stays monotonic in both, as fusion needs.
 */
export function keywordScore(wordsMatched: number, coverDensity: number): number {
  return wordsMatched + coverDensity / (1 + coverDensity);
}

// ---------------------------------------------------------------------------
// Grouping and fusion
// ---------------------------------------------------------------------------

/** The reciprocal-rank constant: a hit contributes 1 / (k + rank). */
export const RRF_K = 60;

/** The ranking of one mode: the entries of every searched index in one
 * representation, best first (`mergeByScore`). */
export interface ModeRanking<E> {
  representation: SearchRepresentation;
  entries: readonly E[];
}

/** An entity's place in one mode: its best entry there and its rank among
 * the mode's entities (from 1). */
export interface ModeHit<E> {
  representation: SearchRepresentation;
  rank: number;
  entry: E;
}

/** One entity of the fused ranking. */
export interface FusedHit<E> {
  entityId: string;
  /** One mode: the best entry's own score (similarity or keyword score);
   * two: the sum of their reciprocal ranks. */
  score: number;
  /** The mode the entity ranks best in (semantic on a tie), with its best
   * entry there — the entry that matched. */
  matched: ModeHit<E>;
  /** Every mode the entity appears in. */
  modes: ModeHit<E>[];
}

/**
 * The entries of several indices in one representation as one ranking, by
 * their raw scores: within a mode they are comparable — similarities of one
 * embedding model, keyword rankings of one query. Equal scores keep the
 * order of the lists.
 */
export function mergeByScore<E extends { score: number }>(lists: readonly (readonly E[])[]): E[] {
  return lists.flat().sort((a, b) => b.score - a.score);
}

/** Each entity once, with its best entry, in ranking order. Entries come
 * best first, so the first of an entity is its best. */
export function groupByEntity<E extends { entityId: string }>(entries: readonly E[]): E[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.entityId)) return false;
    seen.add(entry.entityId);
    return true;
  });
}

/**
 * Fuse the mode rankings at entity level: each grouped by entity (score =
 * its best entry, whichever index holds it), then reciprocal-rank fusion
 * across the modes — hybrid only; a single mode keeps its own scores. One
 * entity found by several indices of one mode counts once. Equal scores
 * prefer the greater semantic similarity when every tied entity has one,
 * then the entity id.
 */
export function fuseModes<E extends { entityId: string; score: number }>(
  rankings: readonly ModeRanking<E>[],
): FusedHit<E>[] {
  const fused = new Map<string, FusedHit<E>>();
  for (const ranking of rankings) {
    groupByEntity(ranking.entries).forEach((entry, i) => {
      const hit: ModeHit<E> = { representation: ranking.representation, rank: i + 1, entry };
      const contribution = rankings.length === 1 ? entry.score : 1 / (RRF_K + hit.rank);
      const prior = fused.get(entry.entityId);
      if (prior === undefined) {
        fused.set(entry.entityId, { entityId: entry.entityId, score: contribution, matched: hit, modes: [hit] });
        return;
      }
      prior.score += contribution;
      prior.modes.push(hit);
      if (
        hit.rank < prior.matched.rank ||
        (hit.rank === prior.matched.rank && hit.representation === "semantic")
      ) {
        prior.matched = hit;
      }
    });
  }
  const similarity = (hit: FusedHit<E>): number | null =>
    hit.modes.find((m) => m.representation === "semantic")?.entry.score ?? null;
  const byId = (a: FusedHit<E>, b: FusedHit<E>) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
  const ranked = [...fused.values()].sort((a, b) => b.score - a.score);
  const result: FusedHit<E>[] = [];
  for (let start = 0; start < ranked.length; ) {
    let end = start + 1;
    while (end < ranked.length && ranked[end]!.score === ranked[start]!.score) end++;
    const group = ranked.slice(start, end);
    const measured = group.every((hit) => similarity(hit) !== null);
    group.sort((a, b) => (measured ? similarity(b)! - similarity(a)! : 0) || byId(a, b));
    result.push(...group);
    start = end;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Snippet
// ---------------------------------------------------------------------------

/** The longest snippet, in code points. */
export const SNIPPET_LENGTH = 200;

/** The start of an entry's text, whitespace collapsed, at most
 * `SNIPPET_LENGTH` code points — an ellipsis marks a cut. */
export function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const points = Array.from(flat);
  if (points.length <= SNIPPET_LENGTH) return flat;
  return `${points.slice(0, SNIPPET_LENGTH - 1).join("").trimEnd()}…`;
}
