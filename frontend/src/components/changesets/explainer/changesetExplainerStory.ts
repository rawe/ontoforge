/**
 * What the changeset explainer shows: the workflow (states, and who may take each way
 * between them) and a story — one example changeset, step by step, from its start by a
 * client to its commit by a person: its staged objects and their values as they change.
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
    { id: 'stage', from: 'draft', to: 'draft', label: 'stage · remove · cut', who: 'client or person' },
    { id: 'submit', from: 'draft', to: 'submitted', label: 'submit', who: 'client or person' },
    { id: 'unsubmit', from: 'submitted', to: 'draft', label: 'unsubmit + note', who: 'person or client' },
    { id: 'commit', from: 'submitted', to: 'committed', label: 'commit', who: 'person · client*' },
    { id: 'commit-draft', from: 'draft', to: 'committed', label: 'commit a draft directly', who: 'person · client*' },
    { id: 'discard', from: 'draft', to: 'discarded', label: 'discard', who: 'client or person' },
    { id: 'expire', from: 'draft', to: 'expired', label: 'expires', who: 'no one · 7 days unchanged' },
  ],
}

/** Each side's name, as a step shows who takes it. */
export const ROLES: Record<Actor, { title: string }> = {
  client: { title: 'Client' },
  person: { title: 'Person' },
}

export type ExampleAction = 'create' | 'update' | 'delete'

/** One staged value of the example: its change as the review shows it. */
export interface ExampleValue {
  property: string
  change: string
  /** Its stored value changed since its before was recorded. */
  drift?: boolean
  /** Cut in this step: shown struck through. */
  cut?: boolean
}

/** One staged object of the example: an entity the changeset touches. */
export interface ExampleObject {
  id: string
  action: ExampleAction
  target: string
  values: ExampleValue[]
  /** Removed in this step: shown struck through. */
  removed?: boolean
}

/** The commit's phases, in order; the example touches entities only. */
export const PHASES: { action: ExampleAction; label: string }[] = [
  { action: 'create', label: 'creates' },
  { action: 'update', label: 'updates' },
  { action: 'delete', label: 'deletes' },
]

export type ExampleState = 'draft' | 'submitted' | 'committed'

export interface StoryStep {
  actor: Actor
  /** The node this step ends in; `edges` are the ways it takes there. */
  node: FlowNodeId
  edges: FlowEdgeId[]
  title: string
  body: string
  /** The example changeset after this step; a committed one shows the version it was committed with. */
  state: ExampleState
  version: number
  note: string | null
  /** The calls of this step that change the set: stage, remove, cut, accept current. */
  changes: number
  /** Its staged objects after this step, by first touch. */
  objects: ExampleObject[]
  /** What every read answers after this step: the stored data. */
  stored: string[]
}

const NAME = { property: 'name', change: 'Apollo → Apollo Web' }
const NAME_DRIFT = { property: 'name', change: 'Apollo → Apollo Web (now Apollo One)', drift: true }
const NAME_ACCEPTED = { property: 'name', change: 'Apollo One → Apollo Web' }
const BRIEF = { property: 'brief', change: 'one staged text, 2 edits' }
const CI_NAME = { property: 'name', change: 'Set up CI' }
const CI_OWNER = { property: 'owner', change: 'Ana' }

const apollo = (...values: ExampleValue[]): ExampleObject => ({ id: 'apollo', action: 'update', target: 'Project Apollo', values })
const ci = (...values: ExampleValue[]): ExampleObject => ({ id: 'ci', action: 'create', target: 'Task Set up CI', values })
const BACKLOG: ExampleObject = { id: 'backlog', action: 'delete', target: 'Task Old backlog', values: [] }

const STORED_BEFORE = ['Project Apollo', 'Task Old backlog']
const STORED_RENAMED = ['Project Apollo One', 'Task Old backlog']
const REVIEWED = [apollo(NAME_DRIFT, BRIEF), ci(CI_NAME, CI_OWNER), BACKLOG]
const REPLANNED = [apollo(NAME_ACCEPTED, BRIEF), ci(CI_NAME)]

export const STORY: StoryStep[] = [
  {
    actor: 'client', node: 'draft', edges: ['start'],
    title: 'A client starts a changeset',
    body: 'Over REST or MCP, through a lens — and on a ruleset’s URL, through its ruleset: the changeset belongs to both. The note is optional; here it says what the plan is for. Every changeset starts as an empty draft, at version 1. A person starts one on the Workbench’s Changesets page.',
    state: 'draft', version: 1, note: 'Tidy up Apollo', changes: 0, objects: [], stored: STORED_BEFORE,
  },
  {
    actor: 'client', node: 'draft', edges: ['stage'],
    title: 'Calls become staged objects',
    body: 'Each write call names the changeset and is staged, not written: checked as an immediate write is, then merged into the set — one staged object per entity or relation it touches, one staged value per property. A create gets its final id now, so a later call can name it. Every read still answers the stored data alone.',
    state: 'draft', version: 4, note: 'Tidy up Apollo', changes: 3,
    objects: [apollo(NAME), ci(CI_NAME), BACKLOG], stored: STORED_BEFORE,
  },
  {
    actor: 'client', node: 'draft', edges: ['stage'],
    title: 'A later call changes the same object',
    body: 'An update of the new task adds its owner to the create; a value set twice keeps the last. A document keeps one staged text: each small edit — replace a passage, insert at an offset — applies to it, so two edits of Apollo’s brief stay one value. Still three objects; each call raises the version.',
    state: 'draft', version: 7, note: 'Tidy up Apollo', changes: 3,
    objects: [apollo(NAME, BRIEF), ci(CI_NAME, CI_OWNER), BACKLOG], stored: STORED_BEFORE,
  },
  {
    actor: 'client', node: 'submitted', edges: ['submit'],
    title: 'Submit: ready for review',
    body: 'Submit checks every staged object against the lens and the stored data. With no fault, the changeset is frozen and handed over: nothing can be staged, removed, cut or discarded until it is committed or unsubmitted. Submitted without a note, it keeps the one it has. A submitted changeset never expires.',
    state: 'submitted', version: 8, note: 'Tidy up Apollo', changes: 0,
    objects: [apollo(NAME, BRIEF), ci(CI_NAME, CI_OWNER), BACKLOG], stored: STORED_BEFORE,
  },
  {
    actor: 'person', node: 'submitted', edges: [],
    title: 'A person reviews it',
    body: 'On the Workbench’s Changesets page, each staged object shows its values: an update’s before, current and after, a create’s values. Meanwhile someone renamed Apollo live, so its name drifted: its before is no longer what is stored. Markers flag what would reject a commit. Reading changes nothing: the version stays 8.',
    state: 'submitted', version: 8, note: 'Tidy up Apollo', changes: 0, objects: REVIEWED, stored: STORED_RENAMED,
  },
  {
    actor: 'person', node: 'draft', edges: ['unsubmit'],
    title: 'Sent back with a note',
    body: 'Unsubmit makes the changeset a draft again and requires a note, which replaces the stored one: it tells the client what to change. To turn a plan down, unsubmit it with the reason, then discard it.',
    state: 'draft', version: 9, note: 'Keep Old backlog, leave the owner open, and check the name: Apollo was renamed.',
    changes: 0, objects: REVIEWED, stored: STORED_RENAMED,
  },
  {
    actor: 'client', node: 'draft', edges: ['stage'],
    title: 'Remove, cut, accept current',
    body: 'The client removes the delete of Old backlog — a removed object is simply gone. It cuts the owner: one value out, the rest of the create stays. And it accepts the current name: the before becomes the stored Apollo One, the staged Apollo Web stays, and the drift is gone. Each change raises the version.',
    state: 'draft', version: 12, note: 'Keep Old backlog, leave the owner open, and check the name: Apollo was renamed.', changes: 3,
    objects: [
      apollo(NAME_ACCEPTED, BRIEF),
      ci(CI_NAME, { ...CI_OWNER, cut: true }),
      { ...BACKLOG, removed: true },
    ],
    stored: STORED_RENAMED,
  },
  {
    actor: 'client', node: 'submitted', edges: ['submit'],
    title: 'Submitted again',
    body: 'This time submit brings a note, which replaces the person’s. The changeset is frozen again and waits for review.',
    state: 'submitted', version: 13, note: 'Apollo Web is the name we want; the brief and the CI task are new.', changes: 0,
    objects: REPLANNED, stored: STORED_RENAMED,
  },
  {
    actor: 'person', node: 'committed', edges: ['commit'],
    title: 'The commit, in phases',
    body: 'The person commits with the version on the screen, 13: had the set changed since, the commit would be refused. It applies the set in fixed phases — creates, then updates, then deletes — all in one transaction, or none and the changeset stays. Committed, the changeset is gone, and every read shows the new data.',
    state: 'committed', version: 13, note: 'Apollo Web is the name we want; the brief and the CI task are new.', changes: 0,
    objects: REPLANNED, stored: ['Project Apollo Web', 'Task Old backlog', 'Task Set up CI'],
  },
]

/** States the story has been in before a step. */
export function passedNodes(index: number): Set<FlowNodeId> {
  return new Set<FlowNodeId>(['start', ...STORY.slice(0, index).map((step) => step.node)])
}
