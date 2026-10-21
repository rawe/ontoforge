/**
 * What the changeset explainer shows: the workflow (states, and who may take each way
 * between them) and a story — one example changeset, step by step, from its start by a
 * client to its commit by a person.
 */

export type Actor = 'client' | 'person'
export type FlowNodeId = 'start' | 'draft' | 'submitted' | 'committed' | 'discarded' | 'expired'
export type FlowEdgeId = 'start' | 'stage' | 'submit' | 'unsubmit' | 'commit' | 'commit-draft' | 'discard' | 'expire'

export interface FlowNode {
  id: FlowNodeId
  label: string
  sub: string
  /** A state of the changeset, or where it comes from or ends. */
  role: 'state' | 'end'
}

/** A way between nodes: what it is called and who may take it. */
export interface FlowEdge {
  id: FlowEdgeId
  from: FlowNodeId
  to: FlowNodeId
  label: string
  who: string
}

export const FLOW: { nodes: FlowNode[]; edges: FlowEdge[] } = {
  nodes: [
    { id: 'start', label: 'Start', sub: '', role: 'end' },
    { id: 'draft', label: 'Draft', sub: 'open for staging', role: 'state' },
    { id: 'submitted', label: 'Submitted', sub: 'frozen for review', role: 'state' },
    { id: 'committed', label: 'Committed', sub: 'written, then gone', role: 'state' },
    { id: 'discarded', label: 'Discarded', sub: '', role: 'end' },
    { id: 'expired', label: 'Expired', sub: '', role: 'end' },
  ],
  edges: [
    { id: 'start', from: 'start', to: 'draft', label: 'start', who: 'client or person' },
    { id: 'stage', from: 'draft', to: 'draft', label: 'stage · unstage', who: 'client or person' },
    { id: 'submit', from: 'draft', to: 'submitted', label: 'submit', who: 'client or person' },
    { id: 'unsubmit', from: 'submitted', to: 'draft', label: 'unsubmit + note', who: 'person or client' },
    { id: 'commit', from: 'submitted', to: 'committed', label: 'commit', who: 'person · client*' },
    { id: 'commit-draft', from: 'draft', to: 'committed', label: 'commit a draft directly', who: 'person · client*' },
    { id: 'discard', from: 'draft', to: 'discarded', label: 'discard', who: 'client or person' },
    { id: 'expire', from: 'draft', to: 'expired', label: 'expires', who: 'no one · 7 days unchanged' },
  ],
}

/** What each side may do; a story step marks the one it takes. */
export const ROLES: Record<Actor, { title: string; via: string; actions: string[]; hint: string }> = {
  client: {
    title: 'Client',
    via: 'over REST or MCP',
    actions: ['start', 'stage', 'unstage', 'submit', 'unsubmit', 'discard', 'commit'],
    hint: 'Proposes. Through a staged-only anchor it cannot commit: a person has to.',
  },
  person: {
    title: 'Person',
    via: 'in the Workbench',
    actions: ['start', 'work in', 'stage', 'unstage', 'submit', 'review', 'unsubmit with a note', 'discard', 'commit'],
    hint: 'Decides, and may propose too: working in a changeset, the Workbench’s writes stage into it. Submit is “ready for review”, not a required step: a person may commit a draft directly.',
  },
}

/** The example changeset's writes, by seq. */
export const EXAMPLE = {
  writes: [
    { seq: 1, op: 'update', target: 'Project Apollo', change: 'name: Apollo → Apollo Web' },
    { seq: 2, op: 'create', target: 'Task Set up CI', change: 'name: Set up CI' },
    { seq: 3, op: 'delete', target: 'Task Old backlog', change: '' },
  ],
} as const

export type ExampleState = 'draft' | 'submitted' | 'committed'

export interface StoryStep {
  actor: Actor
  /** The action of ROLES[actor] this step takes. */
  action: string
  /** The node this step ends in; `edges` are the ways it takes there. */
  node: FlowNodeId
  edges: FlowEdgeId[]
  title: string
  body: string
  /** The example changeset after this step; a committed one shows the version it was committed with. */
  state: ExampleState
  version: number
  note: string | null
  /** Seqs staged after this step; `unstaged` ones are shown struck through. */
  writes: number[]
  unstaged?: number[]
  /** What every read answers after this step: the stored data. */
  stored: string[]
  log: { call: string; result: string }[]
}

const STORED_BEFORE = ['Project Apollo', 'Task Old backlog']

export const STORY: StoryStep[] = [
  {
    actor: 'client', action: 'start', node: 'draft', edges: ['start'],
    title: 'A client starts a changeset',
    body: 'Over REST or MCP, through a lens — and on an anchored URL, through its anchor: the changeset belongs to both. The note is optional; here it says what the plan is for. Every changeset starts as a draft, at version 1. A person starts one on the Workbench’s Changesets page.',
    state: 'draft', version: 1, note: 'Tidy up Apollo', writes: [], stored: STORED_BEFORE,
    log: [{ call: 'start_changeset', result: 'draft · version 1' }],
  },
  {
    actor: 'client', action: 'stage', node: 'draft', edges: ['stage'],
    title: 'It stages writes instead of writing',
    body: 'Each write call names the changeset and is staged, not written: its values checked as an immediate write’s are, numbered by seq, and given its final id, so a later write may name what an earlier one creates. Every read still answers the stored data alone. Each staged write raises the version. A person who works in the changeset stages the same way from the Workbench’s pages.',
    state: 'draft', version: 4, note: 'Tidy up Apollo', writes: [1, 2, 3], stored: STORED_BEFORE,
    log: [
      { call: 'update_entity + changeset_id', result: 'staged as #1' },
      { call: 'create_entity + changeset_id', result: 'staged as #2 · its id is final' },
      { call: 'delete_entity + changeset_id', result: 'staged as #3' },
    ],
  },
  {
    actor: 'client', action: 'submit', node: 'submitted', edges: ['submit'],
    title: 'Submit: ready for review',
    body: 'Submit checks every write against the lens and the stored data. With no fault, the changeset is frozen and handed over: nothing can be staged, unstaged or discarded until it is committed or unsubmitted. Submitted without a note, it keeps the one it has. A submitted changeset never expires.',
    state: 'submitted', version: 5, note: 'Tidy up Apollo', writes: [1, 2, 3], stored: STORED_BEFORE,
    log: [{ call: 'submit_changeset', result: 'no faults · submitted · version 5' }],
  },
  {
    actor: 'person', action: 'review', node: 'submitted', edges: [],
    title: 'A person reviews it',
    body: 'On the Workbench’s Changesets page, each write shows what it would change: an update’s before, current and after values, a create’s values. Markers flag what would reject a commit, such as a value changed since it was staged. Reading changes nothing: the version stays 5.',
    state: 'submitted', version: 5, note: 'Tidy up Apollo', writes: [1, 2, 3], stored: STORED_BEFORE,
    log: [{ call: 'Workbench · review', result: '3 writes · no markers' }],
  },
  {
    actor: 'person', action: 'unsubmit with a note', node: 'draft', edges: ['unsubmit'],
    title: 'Sent back with a note',
    body: 'The person does not want the delete. Unsubmit makes the changeset a draft again and requires a note, which replaces the stored one: it tells the client what to change. To turn a plan down, unsubmit it with the reason, then discard it.',
    state: 'draft', version: 6, note: 'Keep Old backlog: it is still in use.', writes: [1, 2, 3], stored: STORED_BEFORE,
    log: [{ call: 'Workbench · Unsubmit', result: 'draft · version 6' }],
  },
  {
    actor: 'client', action: 'unstage', node: 'draft', edges: ['stage'],
    title: 'The client changes the plan',
    body: 'A staged write cannot be edited, only unstaged and staged again. The client reads the note and unstages #3; the version rises again. Left alone, a draft that stays unchanged for 7 days expires, and either side may discard it.',
    state: 'draft', version: 7, note: 'Keep Old backlog: it is still in use.', writes: [1, 2], unstaged: [3], stored: STORED_BEFORE,
    log: [{ call: 'unstage seq 3', result: 'draft · version 7' }],
  },
  {
    actor: 'client', action: 'submit', node: 'submitted', edges: ['submit'],
    title: 'Submitted again',
    body: 'This time submit brings a note, which replaces the person’s. The changeset is frozen again and waits for review.',
    state: 'submitted', version: 8, note: 'Rename Apollo and add the CI task.', writes: [1, 2], stored: STORED_BEFORE,
    log: [{ call: 'submit_changeset', result: 'no faults · submitted · version 8' }],
  },
  {
    actor: 'person', action: 'commit', node: 'committed', edges: ['commit'],
    title: 'The commit is the approval',
    body: 'The person commits with the version on the screen, 8: had the plan changed since, the commit would be refused rather than committed unseen. Every staged write persists in one transaction, or none does and the changeset stays as it was. Committed, the changeset is gone, and every read shows the new data.',
    state: 'committed', version: 8, note: 'Rename Apollo and add the CI task.', writes: [1, 2],
    stored: ['Project Apollo Web', 'Task Old backlog', 'Task Set up CI'],
    log: [{ call: 'Workbench · Commit version 8', result: '2 writes committed' }],
  },
]

/** The story's log up to and including a step, each entry with the step and the side it came from. */
export function logUpTo(index: number) {
  return STORY.slice(0, index + 1).flatMap((step, i) => step.log.map((entry) => ({ ...entry, step: i, actor: step.actor })))
}

/** States the story has been in before a step. */
export function passedNodes(index: number): Set<FlowNodeId> {
  return new Set<FlowNodeId>(['start', ...STORY.slice(0, index).map((step) => step.node)])
}
