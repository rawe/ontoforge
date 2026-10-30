/**
 * What the index explainer shows: what a search index consists of, told over one example
 * exhibitor, in four modules that never mix — the entries an entity becomes, which index
 * makes which parts, how a search uses the entries, and what a named search's `parts` keeps.
 * A newcomer's view: no storage, no generations.
 *
 * The example follows the real rules: a managed default index makes `self` entries from own
 * string fields, a managed passage index `passage` entries from one document, a custom index
 * any of the three — only it has relation groups; an entity is found by its best entry.
 */

import type { SearchPartKind } from '@/api/types'

export type Module = 'Entries' | 'Indices' | 'Search' | 'Named search'

export type IndexId = 'default' | 'passages' | 'custom'

/** What lights up in the diagram: a region, or a module's use of it. */
export type Lit = 'entity' | 'entries' | IndexId | 'search' | 'parts'

/** Where in the example an entry's text comes from. */
export type Source = 'name' | 'relation' | 'description'

export type ExampleView = 'entity' | 'entries' | IndexId | 'search' | 'named'

export interface StoryStep {
  title: string
  body: string
  note: string
  module: Module
  lit: Lit[]
  view: ExampleView
}

export const EXHIBITOR = { typeKey: 'exhibitor', type: 'Exhibitor', name: 'Kestrel Robotics' }
export const INDUSTRY = { typeKey: 'industry', type: 'Industry', name: 'Robotics' }
export const RELATION = 'belongs to industry'

export const CHUNKS = [
  'Kestrel Robotics builds autonomous mobile robots for warehouses and factory floors.',
  'At the fair it shows a fleet manager that plans the routes of up to 200 robots.',
]

export interface ExampleEntry {
  part: SearchPartKind
  /** Which entry of its part it is. */
  label: string
  source: Source
  text: string
}

const SELF: ExampleEntry = { part: 'self', label: 'own fields', source: 'name', text: `${EXHIBITOR.type}: ${EXHIBITOR.name}` }
const RELATION_ENTRY: ExampleEntry = {
  part: 'relation',
  label: INDUSTRY.name,
  source: 'relation',
  text: `${EXHIBITOR.type}: ${EXHIBITOR.name} · Belongs to industry · ${INDUSTRY.type}: ${INDUSTRY.name}`,
}
const PASSAGES: ExampleEntry[] = CHUNKS.map((chunk, i) => ({
  part: 'passage',
  label: `chunk ${i + 1}`,
  source: 'description',
  text: `${EXHIBITOR.type}: ${EXHIBITOR.name} · ${chunk}`,
}))

export interface ExampleIndex {
  id: IndexId
  name: string
  kind: 'managed' | 'custom'
  /** What it reads, when it chooses. */
  reads?: string
  entries: ExampleEntry[]
}

/** The example's three indices, all over the Exhibitor type. */
export const EXAMPLE_INDICES: ExampleIndex[] = [
  { id: 'default', name: 'Exhibitor — default', kind: 'managed', entries: [SELF] },
  { id: 'passages', name: 'Exhibitor — Description passages', kind: 'managed', entries: PASSAGES },
  {
    id: 'custom',
    name: 'Exhibitors with industry',
    kind: 'custom',
    reads: 'Name, the industry relation, Description',
    entries: [SELF, RELATION_ENTRY, ...PASSAGES],
  },
]

export const indexById = (id: IndexId) => EXAMPLE_INDICES.find((index) => index.id === id)!

/** One entry of each part, for the step that introduces the parts. */
export const ONE_OF_EACH: ExampleEntry[] = [SELF, RELATION_ENTRY, PASSAGES[0]]

/** What a part is, in a few words. */
export const PART_MEANING: Record<SearchPartKind, string> = {
  self: 'the entity’s own fields — one per entity',
  relation: 'one relation of a relation group — one per relation',
  passage: 'one chunk of a document — one per chunk',
}

/** What a result row names as matched, per part — the words of Advanced search. */
export const PART_RESULT: Record<SearchPartKind, string> = {
  self: 'Own fields',
  relation: `Relation · Belongs to industry → ${INDUSTRY.name}`,
  passage: 'Passage · Description',
}

/** A part's colour, the same wherever it shows: the field it comes from, its entries, the result. */
export const PART_TONE: Record<SearchPartKind, { fill: string; stroke: string; text: string; border: string }> = {
  self: { fill: 'fill-(--tc-cyan)', stroke: 'stroke-(--tc-cyan)', text: 'text-(--tc-cyan)', border: 'border-(--tc-cyan)' },
  relation: { fill: 'fill-(--tc-orange)', stroke: 'stroke-(--tc-orange)', text: 'text-(--tc-orange)', border: 'border-(--tc-orange)' },
  passage: { fill: 'fill-(--tc-violet)', stroke: 'stroke-(--tc-violet)', text: 'text-(--tc-violet)', border: 'border-(--tc-violet)' },
}

/** A fixed text, for illustration only. */
export const SEARCH_TEXT = 'robotics suppliers'

/** Every entry of the three indices, by similarity to the text, best first. */
export const SEARCH_ENTRIES: { index: IndexId; entry: ExampleEntry; similarity: number }[] = [
  { index: 'custom', entry: RELATION_ENTRY, similarity: 0.82 },
  { index: 'default', entry: SELF, similarity: 0.74 },
  { index: 'custom', entry: SELF, similarity: 0.74 },
  { index: 'passages', entry: PASSAGES[0], similarity: 0.69 },
  { index: 'custom', entry: PASSAGES[0], similarity: 0.69 },
  { index: 'passages', entry: PASSAGES[1], similarity: 0.55 },
  { index: 'custom', entry: PASSAGES[1], similarity: 0.55 },
]

/** The named search's step in the example: one index, one part chosen. */
export const NAMED_STEP = { index: 'custom' as IndexId, parts: ['relation'] as SearchPartKind[] }

export const STORY: StoryStep[] = [
  {
    title: 'One entity, three kinds of text',
    body:
      'The example is one exhibitor, Kestrel Robotics. Its name is an own field. Its description is an own field of type document, ' +
      'long enough to be cut into two chunks. And it belongs to an industry, Robotics: a relation to another entity.',
    note: 'Search never looks at an entity as a whole. It looks at entries that indices make from these texts.',
    module: 'Entries',
    lit: ['entity'],
    view: 'entity',
  },
  {
    title: 'An entry: one piece of text, of one part',
    body:
      'An index holds entries. Each is one piece of text, of one part: self — the entity’s own fields, one entry per entity; ' +
      'relation — one relation of a relation group, one entry per relation; passage — one chunk of a document, one entry per chunk.',
    note: 'An entry never combines two relations: an exhibitor in three industries has three relation entries, and each can match on its own.',
    module: 'Entries',
    lit: ['entity', 'entries'],
    view: 'entries',
  },
  {
    title: 'Managed default index → self',
    body:
      'Every entity type gets a default index over its own string fields. It makes one self entry per entity — here from the name.',
    note: 'Managed indices follow the schema: a new string property is read without any setup. They can only be switched on or off.',
    module: 'Indices',
    lit: ['default'],
    view: 'default',
  },
  {
    title: 'Managed passage index → passage',
    body:
      'Every document property gets a passage index. It cuts the document into chunks and makes one passage entry per chunk — two for this description.',
    note: 'A passage entry starts with the entity’s name, so a chunk still says whose it is.',
    module: 'Indices',
    lit: ['passages'],
    view: 'passages',
  },
  {
    title: 'Custom index → any of the three',
    body:
      'A modeler decides what a custom index reads. Own fields make a self entry, a relation group makes one relation entry per relation, ' +
      'a document field makes passage entries. Only custom indices have relation groups.',
    note: 'A custom index is searched only where it is chosen — in Advanced search, or as the index of a named search’s step.',
    module: 'Indices',
    lit: ['custom'],
    view: 'custom',
  },
  {
    title: 'A search: the best entry wins',
    body:
      'A search compares your text with every entry of the indices it covers. An entity is found by its best entry and counts once; ' +
      'the result names that entry’s part.',
    note: 'Being found by several entries does not push an entity up — only its best entry counts.',
    module: 'Search',
    lit: ['search'],
    view: 'search',
  },
  {
    title: 'In a named search: parts',
    body:
      'Each search step of a named search reads one index. Its parts keep only that index’s entries of the chosen parts; none chosen keeps them all. ' +
      'An index has only the parts it makes: relation on a default index finds nothing.',
    note: 'Below a passage group only passage entries count: a step there keeps passages, and a step naming another part is refused.',
    module: 'Named search',
    lit: ['parts'],
    view: 'named',
  },
]

/** The step a page opens on to explain a named search's parts. */
export const PARTS_STEP = STORY.findIndex((step) => step.view === 'named')
