/**
 * What the anchor explainer shows: the way a write of a client on an anchored URL takes —
 * at once through the hold, or, staged-only, through a changeset a person commits — and a
 * story over one example hierarchy, step by step.
 */

export type Actor = 'client' | 'person'
export type FlowNodeId = 'client' | 'write' | 'hold' | 'stage' | 'submit' | 'review' | 'commit' | 'data'
export type FlowEdgeId = 'client-write' | 'write-hold' | 'hold-data' | 'client-stage' | 'stage-submit' | 'submit-review' | 'review-commit' | 'commit-data'

export interface FlowNode {
  id: FlowNodeId
  label: string
  sub: string
  /** Where a write comes from or ends, or a step on its way. */
  role: 'io' | 'step'
}

export interface FlowEdge {
  id: FlowEdgeId
  from: FlowNodeId
  to: FlowNodeId
  label?: string
}

export const FLOW: { nodes: FlowNode[]; edges: FlowEdge[] } = {
  nodes: [
    { id: 'client', label: 'Client', sub: '', role: 'io' },
    { id: 'write', label: 'Write at once', sub: 'no changeset', role: 'step' },
    { id: 'hold', label: 'Hold', sub: 'in the subtree?', role: 'step' },
    { id: 'stage', label: 'Stage', sub: 'into a changeset', role: 'step' },
    { id: 'submit', label: 'Submit', sub: 'ready for review', role: 'step' },
    { id: 'review', label: 'Review', sub: 'Changesets page', role: 'step' },
    { id: 'commit', label: 'Commit', sub: 'the hold judged here', role: 'step' },
    { id: 'data', label: 'Stored data', sub: '', role: 'io' },
  ],
  edges: [
    { id: 'client-write', from: 'client', to: 'write', label: 'staged-only off' },
    { id: 'write-hold', from: 'write', to: 'hold' },
    { id: 'hold-data', from: 'hold', to: 'data', label: 'written at once' },
    { id: 'client-stage', from: 'client', to: 'stage', label: 'with a changeset' },
    { id: 'stage-submit', from: 'stage', to: 'submit' },
    { id: 'submit-review', from: 'submit', to: 'review', label: 'handed over' },
    { id: 'review-commit', from: 'review', to: 'commit' },
    { id: 'commit-data', from: 'commit', to: 'data', label: 'all or nothing' },
  ],
}

export type EntityState = 'idle' | 'anchor' | 'covered' | 'written' | 'refused' | 'staged'

/** The example hierarchy: a customer with two projects and their tasks, and a person, a free type. */
export const EXAMPLE = {
  anchor: 'apollo',
  view: { width: 560, height: 290 },
  entities: [
    { id: 'acme', label: 'Acme', type: 'Customer', x: 280, y: 45 },
    { id: 'apollo', label: 'Apollo', type: 'Project', x: 160, y: 140 },
    { id: 'orion', label: 'Orion', type: 'Project', x: 400, y: 140 },
    { id: 'ci', label: 'Set up CI', type: 'Task', x: 85, y: 240 },
    { id: 'docs', label: 'Write docs', type: 'Task', x: 235, y: 240 },
    { id: 'launch', label: 'Launch', type: 'Task', x: 400, y: 240 },
    { id: 'lena', label: 'Lena', type: 'Person · free', x: 490, y: 45 },
  ],
  /** Parent relations, parent first. */
  links: [['acme', 'apollo'], ['acme', 'orion'], ['apollo', 'ci'], ['apollo', 'docs'], ['orion', 'launch']],
  subtree: ['apollo', 'ci', 'docs'],
} as const

export interface StoryStep {
  actor: Actor
  title: string
  body: string
  /** Flow nodes this step passes; `refused` is where its write stops. */
  nodes: FlowNodeId[]
  edges: FlowEdgeId[]
  refused?: FlowNodeId
  stagedOnly: boolean
  /** States beyond the anchor and its subtree, and marks beside entities. */
  entities: Partial<Record<string, EntityState>>
  badges?: Partial<Record<string, string>>
  log: { actor: Actor; call: string; result: string }[]
}

export const STORY: StoryStep[] = [
  {
    actor: 'person', title: 'A person anchors Apollo', nodes: ['client'], edges: [], stagedOnly: false, entities: {},
    body: 'On this page, the anchor apollo points at the project Apollo. Customer, Project and Task are joined by parent relations: they form its hierarchy, and Apollo with everything beneath it is the anchored subtree. Person has no parent relation: it is a free type. The client gets the anchor’s MCP URL; it still reads the whole lens.',
    log: [
      { actor: 'person', call: 'New anchor apollo', result: 'anchored · Project Apollo' },
      { actor: 'client', call: 'get_anchor', result: 'anchored · path Acme › Apollo' },
    ],
  },
  {
    actor: 'client', title: 'Inside the subtree: written at once', nodes: ['client', 'write', 'hold', 'data'],
    edges: ['client-write', 'write-hold', 'hold-data'], stagedOnly: false,
    entities: { docs: 'written' }, badges: { docs: 'written' },
    body: 'Staged-only is off. The client renames the task Write docs: it is covered, so the write goes through at once. A new task would need its parent relation to a parent inside the subtree, such as Apollo.',
    log: [{ actor: 'client', call: 'update_entity Write docs', result: 'written' }],
  },
  {
    actor: 'client', title: 'Outside it: refused', nodes: ['client', 'write', 'hold'], edges: ['client-write', 'write-hold'],
    refused: 'hold', stagedOnly: false,
    entities: { orion: 'refused', lena: 'written' }, badges: { orion: 'refused', lena: 'written' },
    body: 'Renaming the project Orion is refused with a field error on entityId: Orion is in the hierarchy but outside the subtree, and so is Acme. The person Lena is of a free type, written as through the plain lens. The anchor is read afresh on every call, so a re-point counts from the next one.',
    log: [
      { actor: 'client', call: 'update_entity Orion', result: 'refused · entityId' },
      { actor: 'client', call: 'update_entity Lena', result: 'written · a free type' },
    ],
  },
  {
    actor: 'person', title: 'Staged-only: nothing is written at once', nodes: ['client', 'write'], edges: ['client-write'],
    refused: 'write', stagedOnly: true,
    entities: { docs: 'refused' }, badges: { docs: 'refused' },
    body: 'The person turns staged-only on. Now every immediate write through this URL is refused as a conflict, inside the subtree too. From the next request the MCP mount lists the write tools with changeset_id required and leaves out commit_changeset, edit_document and write_document.',
    log: [
      { actor: 'person', call: 'Staged only: on', result: 'from the next call' },
      { actor: 'client', call: 'update_entity Write docs', result: 'refused · this connection only stages' },
    ],
  },
  {
    actor: 'client', title: 'The client stages and submits', nodes: ['client', 'stage', 'submit'], edges: ['client-stage', 'stage-submit'],
    stagedOnly: true, entities: { docs: 'staged' }, badges: { docs: 'staged' },
    body: 'The client starts a changeset, stages the rename into it and submits it for review. Nothing is written yet, and reads still show the old name. Staging does not judge the subtree: that waits for the commit.',
    log: [
      { actor: 'client', call: 'start_changeset', result: 'draft' },
      { actor: 'client', call: 'update_entity + changeset_id', result: 'staged as #1' },
      { actor: 'client', call: 'submit_changeset', result: 'submitted' },
    ],
  },
  {
    actor: 'person', title: 'A person reviews and commits', nodes: ['submit', 'review', 'commit', 'data'],
    edges: ['submit-review', 'review-commit', 'commit-data'], stagedOnly: true,
    entities: { docs: 'written' }, badges: { docs: 'written' },
    body: 'The Workbench writes through the plain lens URL, so the person can commit. The commit holds the changeset to its anchor whichever URL it comes through: one write outside the subtree would reject it all as not covered. Here the rename is inside, and it is written.',
    log: [{ actor: 'person', call: 'Workbench · Commit', result: '1 write committed' }],
  },
]

/** The story's log up to and including a step, each entry with its step. */
export function logUpTo(index: number) {
  return STORY.slice(0, index + 1).flatMap((step, i) => step.log.map((entry) => ({ ...entry, step: i })))
}
