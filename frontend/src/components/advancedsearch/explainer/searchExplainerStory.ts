/**
 * What the search explainer shows: the search tree in plain words — the text searched in
 * every index of the scope by keyword and by meaning, each method's findings ranked with one
 * item per entity, the two rankings fused by rank, filtered and cut to the limit — told over
 * one example query, step by step. A newcomer's view: no request fields, no formulas.
 *
 * The example follows the real rules: an entity counts once per method by its best entry,
 * and fusion adds 1 / (60 + rank) over the methods that found it.
 */

export type TreeNodeId = 'query' | 'filter' | 'keyword' | 'semantic' | 'keywordList' | 'semanticList' | 'fuse' | 'results'

export type ExampleView = 'indices' | 'keyword' | 'semantic' | 'grouped' | 'fused' | 'results'

export interface StoryStep {
  title: string
  body: string
  note: string
  lit: TreeNodeId[]
  view: ExampleView
}

export const EXAMPLE_QUERY = 'flooding response'

/** The example lens's indices: where the text is looked for. */
export const EXAMPLE_INDICES: { typeKey: string; type: string; part: string; holds: string }[] = [
  { typeKey: 'incident', type: 'Incident', part: 'own fields', holds: 'name, status and summary of each incident' },
  { typeKey: 'incident', type: 'Incident', part: 'Report passages', holds: 'each report, cut into passages' },
  { typeKey: 'citizen_request', type: 'Citizen Request', part: 'Report passages', holds: 'each request’s text, cut into passages' },
  { typeKey: 'district', type: 'District', part: 'own fields', holds: 'name and summary of each district' },
]

export interface ExampleEntry {
  entity: string
  typeKey: string
  type: string
  /** Which part of the entity matched: its own fields or one passage. */
  part: string
  /** The words found (keyword), or how close in meaning, 0–1 (semantic). */
  found: string
  closeness?: number
  /** A second, weaker entry of an entity already listed: it does not count again. */
  repeat?: boolean
}

export const KEYWORD_ENTRIES: ExampleEntry[] = [
  { entity: 'Riverside Incident 1', typeKey: 'incident', type: 'Incident', part: 'own fields', found: 'flooding · response' },
  { entity: 'Marktplatz Incident 4', typeKey: 'incident', type: 'Incident', part: 'Report, passage 3', found: 'flooding · response' },
  { entity: 'Riverside Incident 1', typeKey: 'incident', type: 'Incident', part: 'Report, passage 1', found: 'flooding', repeat: true },
  { entity: 'Harbour District', typeKey: 'district', type: 'District', part: 'own fields', found: 'flood' },
]

export const SEMANTIC_ENTRIES: ExampleEntry[] = [
  { entity: 'Marktplatz Incident 4', typeKey: 'incident', type: 'Incident', part: 'Report, passage 1', found: 'about handling floods', closeness: 0.86 },
  { entity: 'Eastgate Request 2', typeKey: 'citizen_request', type: 'Citizen Request', part: 'Report, passage 1', found: '“water in the cellar after heavy rain, nobody came”', closeness: 0.81 },
  { entity: 'Riverside Incident 1', typeKey: 'incident', type: 'Incident', part: 'own fields', found: 'flooding and response time', closeness: 0.79 },
  { entity: 'Riverside Incident 1', typeKey: 'incident', type: 'Incident', part: 'Report, passage 2', found: 'about the clean-up', closeness: 0.74, repeat: true },
  { entity: 'Harbour District', typeKey: 'district', type: 'District', part: 'own fields', found: 'flood protection on the quay', closeness: 0.66 },
]

export interface FusedRow {
  entity: string
  typeKey: string
  type: string
  keywordRank: number | null
  semanticRank: number | null
  /** What the results row names as matched: the best entry under the method it ranks best in. */
  matched: string
}

/** Sorted by fusion: 1/(60 + rank) summed over the methods that found the entity. */
export const FUSED: FusedRow[] = [
  { entity: 'Marktplatz Incident 4', typeKey: 'incident', type: 'Incident', keywordRank: 2, semanticRank: 1, matched: 'Report, passage 1' },
  { entity: 'Riverside Incident 1', typeKey: 'incident', type: 'Incident', keywordRank: 1, semanticRank: 3, matched: 'own fields' },
  { entity: 'Harbour District', typeKey: 'district', type: 'District', keywordRank: 3, semanticRank: 4, matched: 'own fields' },
  { entity: 'Eastgate Request 2', typeKey: 'citizen_request', type: 'Citizen Request', keywordRank: null, semanticRank: 2, matched: 'Report, passage 1' },
]

export const fusionPoints = (row: FusedRow) =>
  [row.keywordRank, row.semanticRank].reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / (60 + rank)), 0)

export const STORY: StoryStep[] = [
  {
    title: 'Your text, and where to look',
    body:
      'You type a text. The scope decides where it is looked for: in search indices — prepared copies of the texts of a type, ' +
      'kept up to date by OntoForge. A type has one for its own fields and one per document, cut into passages. ' +
      'Nothing chosen searches the whole lens.',
    note: 'An index holds entries: one per entity for its own fields, one per passage of a document.',
    lit: ['query', 'keyword', 'semantic'],
    view: 'indices',
  },
  {
    title: 'Keyword search: the words',
    body:
      'Keyword search looks for the words you typed, in any of their forms — “flood” finds “flooding”. ' +
      'An entry with more of your words ranks above one with fewer. “All words” keeps only entries that hold every word.',
    note: 'Keyword search is exact and predictable, but it misses a text that says the same thing in other words.',
    lit: ['keyword'],
    view: 'keyword',
  },
  {
    title: 'Semantic search: the meaning',
    body:
      'Semantic search compares meaning, not words: it finds “water in the cellar after heavy rain” for “flooding”. ' +
      'Every entry gets a closeness to your text between 0 and 1. A minimum similarity drops what is less close.',
    note: 'Semantic search finds what keyword search misses — and always returns something, even for an unrelated text.',
    lit: ['semantic'],
    view: 'semantic',
  },
  {
    title: 'One ranking per method, one place per entity',
    body:
      'Each method puts the entries of all indices into one ranking, best first. An entity found several times — ' +
      'by its own fields and by a passage — keeps only its best entry, so it counts once.',
    note: 'Being found in several indices does not push an entity up. Only being found by both methods does, next.',
    lit: ['keywordList', 'semanticList'],
    view: 'grouped',
  },
  {
    title: 'Fusion: combine by rank',
    body:
      'Keyword scores and closeness cannot be compared, so the two rankings are combined by position: ' +
      'a high place in either ranking earns points, and an entity found by both earns twice. This is reciprocal rank fusion.',
    note: 'With only one method chosen there is nothing to fuse: its ranking is the result.',
    lit: ['fuse'],
    view: 'fused',
  },
  {
    title: 'Filter and limit: the results',
    body:
      'A filter keeps only entities that match it — and it applies inside every search, so it never empties the list afterwards. ' +
      'The best ones up to the limit are shown, each with the part that matched. Only the order is shown, never a score.',
    note: 'In Passages mode the same happens, but a passage — not an entity — is what is ranked and shown.',
    lit: ['filter', 'results'],
    view: 'results',
  },
]
