import type { AssistantKind } from '@/api/types'

/**
 * What the assistant explainer shows: per kind, its flow (the steps of one run), the
 * settings that steer it and a story — one example run, step by step, over the same
 * example graph and the same question for every kind, so the kinds compare at a glance.
 */

/** A step of the flow: a model call, a step that only reads the lens, or the question and answer at its ends. */
export type FlowNodeRole = 'io' | 'model' | 'step'

export interface FlowNode {
  id: string
  label: string
  sub: string
  role: FlowNodeRole
  /** Centre in the flow's coordinate space (see FLOW_VIEW). */
  x: number
  y: number
}

/** `loop` draws a node back onto itself; `bend` routes an edge between rows to one side. */
export interface FlowEdge {
  id: string
  from: string
  to: string
  label?: string
  bend?: 'left' | 'right'
}

export type EntityState = 'idle' | 'dim' | 'seen' | 'active' | 'evidence' | 'anchor'
export type LinkState = 'idle' | 'dim' | 'seen' | 'active'

/** One entry of the run log: what the assistant called, found or decided at a step. */
export interface LogEntry {
  tag: 'model' | 'tool' | 'search' | 'filter' | 'walk' | 'rank' | 'keep' | 'answer'
  title: string
  detail: string
}

export interface StoryStep {
  /** The flow node this step runs in. */
  node: string
  /** Flow edges lit on this step; by default the edge from the previous step's node. */
  edges?: string[]
  title: string
  body: string
  /** Labels of the settings (see Explainer.settings) that steer this step. */
  settings: string[]
  entities: Partial<Record<string, EntityState>>
  links: Partial<Record<string, LinkState>>
  /** Small marks beside entities: a rank, a hop, an evidence reference. */
  badges?: Partial<Record<string, string>>
  /** A dashed frame around entities, with its caption. */
  frame?: { around: string[]; label: string }
  /** Column captions replacing the type names, e.g. hops. */
  columns?: [string, string, string]
  log: LogEntry[]
  /** Untouched entities fade from this step on. */
  fade?: boolean
}

export interface Explainer {
  kind: AssistantKind
  title: string
  summary: string
  facts: { label: string; value: string }[]
  /** `height` overrides FLOW_VIEW's; `loop` frames nodes that repeat, captioned line by line. */
  flow: { nodes: FlowNode[]; edges: FlowEdge[]; height?: number; loop?: { around: string[]; lines: string[] } }
  settings: { label: string; hint: string }[]
  story: StoryStep[]
}

/** The flow's coordinate space; every kind lays its nodes out in it. */
export const FLOW_VIEW = { width: 1120, height: 150, node: { width: 132, height: 48 }, io: { width: 96, height: 36 } } as const

/** The example graph every kind answers the same question over. */
export const EXAMPLE = {
  question: 'Who works on projects that require Kubernetes?',
  view: { width: 640, height: 330 },
  columns: [{ x: 95, label: 'Skill' }, { x: 300, label: 'Project' }, { x: 505, label: 'Person' }] as const,
  entities: [
    { id: 'kubernetes', label: 'Kubernetes', x: 95, y: 120 },
    { id: 'postgres', label: 'Postgres', x: 95, y: 270 },
    { id: 'apollo', label: 'Apollo', x: 300, y: 95 },
    { id: 'orion', label: 'Orion', x: 300, y: 185 },
    { id: 'vega', label: 'Vega', x: 300, y: 285 },
    { id: 'lena', label: 'Lena', x: 505, y: 70 },
    { id: 'tom', label: 'Tom', x: 505, y: 135 },
    { id: 'kira', label: 'Kira', x: 505, y: 205 },
    { id: 'mia', label: 'Mia', x: 505, y: 290 },
  ],
  links: [
    { id: 'apollo-requires', from: 'apollo', to: 'kubernetes', label: 'requires' },
    { id: 'orion-requires', from: 'orion', to: 'kubernetes', label: 'requires' },
    { id: 'vega-requires', from: 'vega', to: 'postgres', label: 'requires' },
    { id: 'lena-works', from: 'lena', to: 'apollo', label: 'works on' },
    { id: 'tom-works', from: 'tom', to: 'apollo', label: 'works on' },
    { id: 'kira-works', from: 'kira', to: 'orion', label: 'works on' },
    { id: 'mia-works', from: 'mia', to: 'vega', label: 'works on' },
    { id: 'kira-manages', from: 'kira', to: 'tom', label: 'manages' },
  ],
} as const

const PEOPLE = { lena: 'active', tom: 'active', kira: 'active' } as const
const PEOPLE_FOUND = { lena: 'evidence', tom: 'evidence', kira: 'evidence' } as const
const HOP_COLUMNS: [string, string, string] = ['hop 0 · anchor', 'hop 1', 'hop 2']

const ROW = 60
const flowRow = (ids: [string, string, FlowNodeRole, string][]): FlowNode[] =>
  ids.map(([id, label, role, sub], i) => ({ id, label, role, sub, x: i === 0 ? 60 : i === ids.length - 1 ? 1058 : 60 + 158 * i, y: ROW }))
const chain = (ids: string[]): FlowEdge[] => ids.slice(1).map((to, i) => ({ id: `${ids[i]}-${to}`, from: ids[i], to }))

const agent: Explainer = {
  kind: 'agents',
  title: 'How an agent works',
  summary: 'A language model in a loop. It calls one or more of the lens tools, reads what comes back and decides again — until it can answer. The path is not planned ahead; the model finds it while it runs.',
  facts: [
    { label: 'Model calls', value: 'as many as it needs — a run fails past about 50' },
    { label: 'Path', value: 'chosen call by call' },
    { label: 'You see', value: 'every tool call and its result' },
  ],
  flow: {
    height: 190,
    loop: { around: ['model', 'tools'], lines: ['ReAct loop', 'reason → act → observe', 'until no tool is called'] },
    nodes: [
      { id: 'question', label: 'Question', sub: '', role: 'io', x: 60, y: 50 },
      { id: 'model', label: 'Model', sub: 'calls a tool — or answers', role: 'model', x: 520, y: 50 },
      { id: 'tools', label: 'Lens tools', sub: 'read-only, in the lens', role: 'step', x: 520, y: 140 },
      { id: 'reply', label: 'Reply', sub: '', role: 'io', x: 1058, y: 50 },
    ],
    edges: [
      { id: 'question-model', from: 'question', to: 'model' },
      { id: 'model-tools', from: 'model', to: 'tools', label: 'tool calls', bend: 'left' },
      { id: 'tools-model', from: 'tools', to: 'model', label: 'results', bend: 'right' },
      { id: 'model-reply', from: 'model', to: 'reply', label: 'no tool call — the reply' },
    ],
  },
  settings: [
    { label: 'System prompt', hint: 'Replaces the built-in prompt. The lens schema is always added to it.' },
    { label: 'Tools', hint: 'Which of the read-only tools the model may call — all, unless you pick some.' },
  ],
  story: [
    {
      node: 'model', title: 'The model reads the question',
      body: 'The question goes to the model with the system prompt, a description of the lens schema — only the types this lens shows — and the tools it may use. The last turns of the thread come along, so follow-up questions work. No data has been read yet.',
      settings: ['System prompt', 'Tools'], entities: {}, links: {},
      log: [{ tag: 'model', title: 'Prompt · lens schema · tools', detail: 'The model knows the shape of the graph, not its data.' }],
    },
    {
      node: 'tools', title: 'It decides to look something up',
      body: 'The model picks a tool and its arguments — here a search for “Kubernetes”. The tool runs on the server, inside the lens, and its result goes back to the model as a message.',
      settings: ['Tools'], entities: { kubernetes: 'active' }, links: {}, badges: { kubernetes: '1' },
      log: [{ tag: 'tool', title: 'search("Kubernetes")', detail: '1 hit — Kubernetes, a Skill' }],
    },
    {
      node: 'tools', edges: ['tools-model', 'model-tools'], title: 'Read, then decide again',
      body: 'With the result in view, the model chooses the next call: the neighbours of Kubernetes. Each round of the loop is one model call followed by one batch of tool calls.',
      settings: ['Tools'],
      entities: { kubernetes: 'seen', apollo: 'active', orion: 'active' },
      links: { 'apollo-requires': 'active', 'orion-requires': 'active' }, badges: { kubernetes: '1', apollo: '2', orion: '2' },
      log: [{ tag: 'tool', title: 'get_neighbors(Kubernetes)', detail: 'Apollo, Orion — both require it' }],
    },
    {
      node: 'tools', edges: ['tools-model', 'model-tools'], title: 'Several calls at once',
      body: 'The model may call tools in parallel — here the neighbours of both projects. A failed call, such as a misspelt type, comes back as a message too, so the model can correct itself and try again.',
      settings: ['Tools'],
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', ...PEOPLE },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'active', 'tom-works': 'active', 'kira-works': 'active' },
      badges: { kubernetes: '1', apollo: '2', orion: '2', lena: '3', tom: '3', kira: '3' },
      log: [
        { tag: 'tool', title: 'get_neighbors(Apollo)', detail: 'Lena, Tom — they work on it' },
        { tag: 'tool', title: 'get_neighbors(Orion)', detail: 'Kira — works on it' },
      ],
    },
    {
      node: 'model', edges: ['tools-model'], title: 'Enough to answer',
      body: 'When the model replies without calling a tool, the loop ends. Nothing fixes the number of rounds in advance; a run that reaches about 50 model calls fails with an error, without a reply. Another run may take another way — one query instead of three calls.',
      settings: [], fade: true,
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', ...PEOPLE },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kubernetes: '1', apollo: '2', orion: '2', lena: '3', tom: '3', kira: '3' },
      log: [{ tag: 'model', title: 'No tool call', detail: 'The loop ends after 4 model calls.' }],
    },
    {
      node: 'reply', title: 'The answer, from what it read',
      body: 'The reply arrives as a whole. The built-in prompt keeps it to what the tools returned — a custom system prompt has to ask for that itself. Entities from the search, read, list and neighbour tools appeared as cards as each result arrived; query results add none. The calls stay in the thread for the next question.',
      settings: ['System prompt'], fade: true,
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', ...PEOPLE_FOUND },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      log: [{ tag: 'answer', title: 'Lena and Tom (Apollo), Kira (Orion)', detail: 'Written from the results of 4 tool calls.' }],
    },
  ],
}

const retriever: Explainer = {
  kind: 'retrievers',
  title: 'How a retriever works',
  summary: 'Plans once, then searches wide. One model call turns the question into a few targeted searches over the search indices you chose; the matches are narrowed, ranked and fused without a model, and a second call answers from them.',
  facts: [
    { label: 'Model calls', value: '2 — plan and answer; a follow-up may plan twice' },
    { label: 'Path', value: 'fixed: plan, narrow, rank, fuse' },
    { label: 'Searches', value: 'index entries — no hop-by-hop walk' },
  ],
  flow: {
    nodes: flowRow([
      ['question', 'Question', 'io', ''],
      ['plan', 'Plan', 'model', 'up to 4 searches'],
      ['narrow', 'Narrow', 'step', 'exact filters'],
      ['rank', 'Rank entries', 'step', 'meaning + words'],
      ['fuse', 'Fuse', 'step', 'merge by rank'],
      ['answer', 'Answer', 'model', 'chat only'],
      ['reply', 'Reply', 'io', ''],
    ]),
    edges: chain(['question', 'plan', 'narrow', 'rank', 'fuse', 'answer', 'reply']),
  },
  settings: [
    { label: 'Search indices', hint: 'What can be searched. The planner picks indices by their name and description.' },
    { label: 'Filters', hint: 'Exact conditions, up to two relations away — used only when the user states or names a value.' },
    { label: 'Similarity threshold', hint: 'Drops weak matches by meaning in searches without a filter.' },
    { label: 'Answer fields', hint: 'The values of each result the answer is written from.' },
    { label: 'Characters per field', hint: 'Where each answer field and matched entry is cut.' },
  ],
  story: [
    {
      node: 'plan', title: 'One planning call',
      body: 'A model reads the question with the name, description and relation groups of each chosen index, and the filters. It writes a plan: which index to search, a search text with rephrasings, and any filter value the question states. Anything the retriever does not allow is dropped from the plan.',
      settings: ['Search indices', 'Filters'], entities: {}, links: {},
      log: [
        { tag: 'model', title: 'Search the “People” index', detail: '“people on Kubernetes projects” + 2 rephrasings · meaning and words' },
        { tag: 'model', title: 'Filter: Skill name = “Kubernetes”', detail: 'The value is quoted from the question.' },
      ],
    },
    {
      node: 'narrow', title: 'Narrow exactly',
      body: 'The filter value is matched exactly on Skill name, then traced back along “requires” and “works on” to the people it belongs to. Only they stay candidates. This is the one place relations are followed — at most two, and without a model — though an index entry can already hold a related entity’s fields.',
      settings: ['Filters'], fade: true,
      entities: { kubernetes: 'anchor', apollo: 'seen', orion: 'seen', ...PEOPLE },
      links: { 'apollo-requires': 'active', 'orion-requires': 'active', 'lena-works': 'active', 'tom-works': 'active', 'kira-works': 'active' },
      frame: { around: ['lena', 'tom', 'kira'], label: 'candidates' },
      log: [{ tag: 'filter', title: 'Skill name = “Kubernetes”', detail: '→ Apollo, Orion → 3 people stay candidates' }],
    },
    {
      node: 'rank', title: 'Rank index entries',
      body: 'The search text and each rephrasing run against the entries of the index — by meaning and by words, or by words only when embeddings are off. Only what an entry holds can match, and a person counts by their best entry. Without a filter, weak matches by meaning would drop out at the similarity threshold.',
      settings: ['Search indices', 'Similarity threshold'], fade: true,
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', lena: 'active', tom: 'seen', kira: 'active' },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kira: '#1', lena: '#2' }, frame: { around: ['lena', 'tom', 'kira'], label: 'ranked by their index entries' },
      log: [
        { tag: 'search', title: 'Meaning: Kira, Lena', detail: 'Kira’s entry mentions platform work on Orion.' },
        { tag: 'search', title: 'Words: Kira', detail: 'Tom’s entries match neither search.' },
      ],
    },
    {
      node: 'fuse', title: 'Fuse by rank',
      body: 'The rankings merge by position, not by score: meaning with words, then the rephrasings, then the searches. Whatever is found several ways rises. Candidates no search ranked are added at the end — up to 100 per search, and any cut is reported.',
      settings: [], fade: true,
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', ...PEOPLE },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kira: '#1', lena: '#2', tom: '#3' },
      log: [{ tag: 'rank', title: 'One list: Kira, Lena, Tom', detail: 'Tom passed the filter and joins at the end.' }],
    },
    {
      node: 'answer', title: 'Answer from the evidence',
      body: 'The best results that fit its budget — their answer fields and the entry each matched, cut to the character limit — are what the second model call sees. Their cards appear first, then the answer streams. Retrieve — the list without an answer — stops after Fuse.',
      settings: ['Answer fields', 'Characters per field'], fade: true,
      entities: { kubernetes: 'seen', apollo: 'seen', orion: 'seen', ...PEOPLE_FOUND },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kira: '#1', lena: '#2', tom: '#3' },
      log: [{ tag: 'answer', title: 'Kira, Lena and Tom', detail: 'Written from their answer fields and matched entries.' }],
    },
  ],
}

const navigator: Explainer = {
  kind: 'navigators',
  title: 'How a navigator works',
  summary: 'Finds the things your question names, then walks the relations hop by hop to what it asks for — and answers only from the entities it met, citing each one. Two model calls; the search and the walk in between read the graph directly.',
  facts: [
    { label: 'Model calls', value: '2 — understand and answer' },
    { label: 'Path', value: 'planned once, walked without a model' },
    { label: 'You see', value: 'every step and every entity met' },
  ],
  flow: {
    nodes: flowRow([
      ['question', 'Question', 'io', ''],
      ['understand', 'Understand', 'model', 'names, target, path'],
      ['anchor', 'Anchor', 'step', 'search the names'],
      ['walk', 'Walk', 'step', 'hop by hop'],
      ['focus', 'Focus', 'step', 'keep the evidence'],
      ['answer', 'Answer', 'model', 'cites each entity'],
      ['reply', 'Reply', 'io', ''],
    ]),
    edges: [
      ...chain(['question', 'understand', 'anchor', 'walk', 'focus', 'answer', 'reply']),
      { id: 'walk-walk', from: 'walk', to: 'walk', label: 'widen — once' },
    ],
  },
  settings: [
    { label: 'Anchor types', hint: 'The types a name in the question may resolve to — where the walk starts.' },
    { label: 'Relation types', hint: 'The relations the plan may use and the walk may follow.' },
    { label: 'Hops', hint: 'How far exploring goes — without a planned path, or after one fell short: 1, 2 or 3.' },
    { label: 'Evidence cards', hint: 'How many entities the answer may see.' },
    { label: 'Instructions', hint: 'Added to the answer prompt — how to answer, not where to look.' },
  ],
  story: [
    {
      node: 'understand', title: 'Understand the question',
      body: 'One model call reads the lens schema and the question. It returns what the question names — “Kubernetes”, likely a Skill — what it asks for — people — and a path of up to three relations from one to the other. Types and relations outside the lens are dropped.',
      settings: ['Anchor types', 'Relation types'], entities: {}, links: {},
      log: [
        { tag: 'model', title: 'Names “Kubernetes” — a Skill', detail: 'Looking for: Person' },
        { tag: 'model', title: 'Path: ← requires · ← works on', detail: 'From the Skill to the projects, then to the people.' },
      ],
    },
    {
      node: 'anchor', title: 'Find where to start',
      body: 'Each name is searched in the lens — by meaning and words when embeddings are on, by words otherwise. A hit that contains the name becomes an anchor — hop 0, up to three per name. Without such a hit, the closest one is used and the answer says so.',
      settings: ['Anchor types'], columns: HOP_COLUMNS,
      entities: { kubernetes: 'anchor' }, links: {}, badges: { kubernetes: 'E1' },
      log: [{ tag: 'search', title: 'search “Kubernetes”', detail: 'Kubernetes (Skill) — the name matches' }],
    },
    {
      node: 'walk', title: 'Hop 1 — follow “requires”',
      body: 'From the anchor the walk follows only the planned relation, reading the graph directly — no model. Apollo and Orion require Kubernetes; Vega requires Postgres and is never touched. Each entity keeps the way it was reached.',
      settings: ['Relation types'], columns: HOP_COLUMNS,
      entities: { kubernetes: 'anchor', apollo: 'active', orion: 'active' },
      links: { 'apollo-requires': 'active', 'orion-requires': 'active' }, badges: { kubernetes: 'E1' },
      log: [{ tag: 'walk', title: '← requires: Apollo, Orion', detail: '“Apollo requires Kubernetes”' }],
    },
    {
      node: 'walk', edges: [], title: 'Hop 2 — follow “works on”',
      body: 'From the new frontier it follows “works on”, the last hop of the path, and reaches people — the type asked for. Had the path fallen short of people, the walk would widen once: explore every allowed relation, up to the hops you set.',
      settings: ['Hops', 'Relation types'], columns: HOP_COLUMNS,
      entities: { kubernetes: 'anchor', apollo: 'seen', orion: 'seen', ...PEOPLE },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'active', 'tom-works': 'active', 'kira-works': 'active' },
      badges: { kubernetes: 'E1' },
      log: [{ tag: 'walk', title: '← works on: Lena, Tom, Kira', detail: 'Person reached at hop 2 — no widening needed' }],
    },
    {
      node: 'focus', title: 'Focus on the evidence',
      body: 'Of everything met, it keeps the anchor and the people asked for — each with the path back to the anchor — up to the evidence-card limit; any room left goes to other entities met, nearest first. A result never arrives without the way to it.',
      settings: ['Evidence cards'], columns: HOP_COLUMNS, fade: true,
      entities: { kubernetes: 'evidence', apollo: 'evidence', orion: 'evidence', ...PEOPLE_FOUND },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kubernetes: 'E1', apollo: 'E2', orion: 'E3', lena: 'E4', tom: 'E5', kira: 'E6' },
      frame: { around: ['kubernetes', 'apollo', 'orion', 'lena', 'tom', 'kira'], label: 'evidence cards' },
      log: [{ tag: 'keep', title: 'Kept 6 as evidence cards', detail: 'E1–E6: the anchor, two projects, three people' }],
    },
    {
      node: 'answer', title: 'Answer with citations',
      body: 'The second model call sees only the evidence cards and their relations, and must cite them. The cited entities stay with the thread: “Which of them manage someone?” starts from them.',
      settings: ['Instructions'], columns: HOP_COLUMNS, fade: true,
      entities: { kubernetes: 'evidence', apollo: 'evidence', orion: 'evidence', ...PEOPLE_FOUND },
      links: { 'apollo-requires': 'seen', 'orion-requires': 'seen', 'lena-works': 'seen', 'tom-works': 'seen', 'kira-works': 'seen' },
      badges: { kubernetes: 'E1', apollo: 'E2', orion: 'E3', lena: 'E4', tom: 'E5', kira: 'E6' },
      log: [{ tag: 'answer', title: 'Lena [E4] and Tom [E5] work on Apollo [E2] …', detail: '… Kira [E6] on Orion [E3]' }],
    },
  ],
}

/** Per assistant kind: how it works, told over one example run. */
export const EXPLAINERS: Record<AssistantKind, Explainer> = { agents: agent, retrievers: retriever, navigators: navigator }

const isLast = (explainer: Explainer, index: number) => index === explainer.story.length - 1

/**
 * The flow edges a story step lights: its own, or the one arriving from the previous step's
 * node — and on the last step also the way out to the reply.
 */
export function litEdges(explainer: Explainer, index: number): string[] {
  const step = explainer.story[index]
  const from = index === 0 ? 'question' : explainer.story[index - 1].node
  const lit = step.edges ?? explainer.flow.edges.filter((edge) => edge.from === from && edge.to === step.node).map((edge) => edge.id)
  const out = isLast(explainer, index) ? explainer.flow.edges.filter((edge) => edge.from === step.node && edge.to === 'reply').map((edge) => edge.id) : []
  return [...lit, ...out]
}

/** Flow nodes a run has passed by the given step — the question always, the reply once the story ends. */
export function passedNodes(explainer: Explainer, index: number): Set<string> {
  const passed = new Set(['question', ...explainer.story.slice(0, index).map((step) => step.node)])
  if (isLast(explainer, index)) passed.add('reply')
  return passed
}

/** The run log up to and including a step, each entry with the step it came from. */
export function logUpTo(explainer: Explainer, index: number): (LogEntry & { step: number })[] {
  return explainer.story.slice(0, index + 1).flatMap((step, i) => step.log.map((entry) => ({ ...entry, step: i })))
}
