/**
 * What the rulesets explainer shows: the way a write of a client on a ruleset's URL takes —
 * at once, or through a changeset a person commits — the ruleset's rules, one card each,
 * and a story over one example hierarchy, step by step: write access first, then the anchor.
 */

import type { WriteAccess } from '../../../api/types.ts'
import { WRITE_ACCESS_LEVELS } from '../rulesets.ts'

export type Actor = 'client' | 'person'
export type FlowNodeId = 'client' | 'write' | 'anchor' | 'stage' | 'submit' | 'review' | 'commit' | 'data'
export type FlowEdgeId = 'client-write' | 'write-anchor' | 'anchor-data' | 'client-stage' | 'stage-submit' | 'submit-review' | 'review-commit' | 'commit-data'

/** The ruleset's rules, in rule order: one card each on the left. A new rule is one more id. */
export const RULE_IDS = ['writeAccess', 'anchor'] as const
export type RuleId = (typeof RULE_IDS)[number]
/** What a step is about: the ruleset itself, one rule, all rules at once, or the escapes. */
export type StepRule = 'ruleset' | RuleId | 'both' | 'escapes'
/** The anchor rule's setting at a step: no anchor, an anchor whose entity exists, or one whose entity is gone. */
export type AnchorMode = 'none' | 'found' | 'deleted'

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
  /** Whose lane the edge runs in: the client's on the ruleset's URL, or the person's in the Workbench. */
  lane: Actor
  label?: string
}

export const FLOW: { nodes: FlowNode[]; edges: FlowEdge[] } = {
  nodes: [
    { id: 'client', label: 'Client', sub: '', role: 'io' },
    { id: 'write', label: 'Write at once', sub: 'no changeset', role: 'step' },
    { id: 'anchor', label: 'Anchor', sub: 'in the subtree?', role: 'step' },
    { id: 'stage', label: 'Stage', sub: 'into a changeset', role: 'step' },
    { id: 'submit', label: 'Submit', sub: 'ready for review', role: 'step' },
    { id: 'review', label: 'Review', sub: 'Workbench', role: 'step' },
    { id: 'commit', label: 'Commit', sub: 'anchor judged', role: 'step' },
    { id: 'data', label: 'Stored data', sub: '', role: 'io' },
  ],
  edges: [
    { id: 'client-write', from: 'client', to: 'write', lane: 'client', label: 'full' },
    { id: 'write-anchor', from: 'write', to: 'anchor', lane: 'client' },
    { id: 'anchor-data', from: 'anchor', to: 'data', lane: 'client', label: 'written at once' },
    { id: 'client-stage', from: 'client', to: 'stage', lane: 'client', label: 'propose · full' },
    { id: 'stage-submit', from: 'stage', to: 'submit', lane: 'client' },
    { id: 'submit-review', from: 'submit', to: 'review', lane: 'person', label: 'handed over' },
    { id: 'review-commit', from: 'review', to: 'commit', lane: 'person' },
    { id: 'commit-data', from: 'commit', to: 'data', lane: 'person', label: 'all or nothing' },
  ],
}

/** What each write access level adds to the one below it: the staircase's steps. */
const LEVEL_ADDS: Record<WriteAccess, string> = {
  none: 'read',
  propose: '+ stage, submit',
  full: '+ write at once, commit',
}

/**
 * The write access staircase at one level: every level in order, below, at or above it.
 * What the levels above add is what the client cannot do.
 */
export function ladder(level: WriteAccess) {
  const at = WRITE_ACCESS_LEVELS.findIndex((l) => l.level === level)
  return WRITE_ACCESS_LEVELS.map(({ level: step }, i) => ({
    level: step,
    adds: LEVEL_ADDS[step],
    place: i < at ? 'below' as const : i === at ? 'current' as const : 'above' as const,
  }))
}

export type EntityState = 'idle' | 'anchor' | 'covered' | 'deleted' | 'written' | 'refused' | 'staged'

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
    { id: 'lena', label: 'Lena', type: 'Person', x: 490, y: 45 },
  ],
  /** Parent relations, parent first. */
  links: [['acme', 'apollo'], ['acme', 'orion'], ['apollo', 'ci'], ['apollo', 'docs'], ['orion', 'launch']],
  subtree: ['apollo', 'ci', 'docs'],
  /** Of a type with no parent relation: outside every hierarchy. */
  free: ['lena'],
} as const

/** The anchor card's caption at an anchor mode. */
export const ANCHOR_CAPTIONS: Record<AnchorMode, string> = {
  none: 'No anchor: no limit on where',
  found: 'anchor Apollo · its subtree',
  deleted: 'Anchor deleted: every write is refused',
}

export interface StoryStep {
  actor: Actor
  /** The rule this step is about: its card is lit. */
  rule: StepRule
  title: string
  body: string
  /** The ruleset's rules at this step. */
  writeAccess: WriteAccess
  anchor: AnchorMode
  /** Flow nodes this step passes; `refused` is where its writes stop. */
  nodes: FlowNodeId[]
  edges: FlowEdgeId[]
  refused?: FlowNodeId[]
  /** States beyond the anchor and its subtree, and marks beside entities. */
  entities: Partial<Record<string, EntityState>>
  badges?: Partial<Record<string, string>>
  log: { actor: Actor; call: string; result?: string }[]
}

export const STORY: StoryStep[] = [
  {
    actor: 'person', rule: 'ruleset', writeAccess: 'full', anchor: 'none', title: 'A ruleset: rules for one URL',
    nodes: ['client'], edges: [], entities: {},
    body: 'A person creates the ruleset agent-a on the Rulesets page. Its key is part of a new MCP URL; every call through it must follow the ruleset’s rules, and sees only changesets started through it.',
    log: [
      { actor: 'person', call: 'New ruleset agent-a', result: 'write access full · no anchor' },
      { actor: 'client', call: 'get_ruleset', result: 'write access full · no anchor' },
    ],
  },
  {
    actor: 'client', rule: 'writeAccess', writeAccess: 'full', anchor: 'none', title: 'Write access full: writes as the lens allows',
    nodes: ['client', 'write', 'anchor', 'data'], edges: ['client-write', 'write-anchor', 'anchor-data'],
    entities: { docs: 'written' }, badges: { docs: 'written' },
    body: 'The client renames the task Write docs, and it is written at once. It could also stage into a changeset and commit it itself.',
    log: [{ actor: 'client', call: 'update_entity Write docs', result: 'written' }],
  },
  {
    actor: 'person', rule: 'writeAccess', writeAccess: 'propose', anchor: 'none', title: 'Write access propose: nothing is written at once',
    nodes: ['client', 'write'], edges: ['client-write'], refused: ['write'], entities: {},
    body: 'The person lowers write access to propose. The same rename is now refused: from the next call the client may only propose.',
    log: [
      { actor: 'person', call: 'Write access: propose' },
      { actor: 'client', call: 'update_entity Write docs', result: 'refused · stage it into a changeset' },
    ],
  },
  {
    actor: 'client', rule: 'writeAccess', writeAccess: 'propose', anchor: 'none', title: 'It proposes, a person commits',
    nodes: ['client', 'stage', 'submit', 'review', 'commit', 'data'],
    edges: ['client-stage', 'stage-submit', 'submit-review', 'review-commit', 'commit-data'],
    entities: { docs: 'written' }, badges: { docs: 'staged → written' },
    body: 'The client stages the rename into a changeset and submits it; nothing changes yet. A person reviews it in the Workbench and commits.',
    log: [
      { actor: 'client', call: 'start_changeset' },
      { actor: 'client', call: 'update_entity + changeset_id', result: 'staged as #1' },
      { actor: 'client', call: 'submit_changeset' },
      { actor: 'person', call: 'Workbench · Commit', result: '1 write committed' },
    ],
  },
  {
    actor: 'person', rule: 'writeAccess', writeAccess: 'none', anchor: 'none', title: 'Write access none: read only',
    nodes: ['client', 'write', 'stage'], edges: ['client-write', 'client-stage'], refused: ['write', 'stage'], entities: {},
    body: 'At none the client reads the whole lens, but every write and every new changeset is refused.',
    log: [
      { actor: 'client', call: 'update_entity', result: 'refused' },
      { actor: 'client', call: 'start_changeset', result: 'refused' },
      { actor: 'client', call: 'list_entities', result: '12 rows' },
    ],
  },
  {
    actor: 'person', rule: 'anchor', writeAccess: 'full', anchor: 'found', title: 'An anchor: one entity and its subtree',
    nodes: ['anchor'], edges: [], entities: {},
    body: 'The person sets write access back to full and sets the anchor at the project Apollo. Customer, Project and Task form its hierarchy; Apollo and everything below it is the subtree; Person is a free type.',
    log: [
      { actor: 'person', call: 'Write access: full' },
      { actor: 'person', call: 'Anchor: Project Apollo' },
    ],
  },
  {
    actor: 'client', rule: 'anchor', writeAccess: 'full', anchor: 'found', title: 'Inside the subtree, or free: allowed',
    nodes: ['client', 'write', 'anchor', 'data'], edges: ['client-write', 'write-anchor', 'anchor-data'],
    entities: { docs: 'written', lena: 'written' }, badges: { docs: 'written', lena: 'written' },
    body: 'Renaming Write docs is written: it is inside the subtree. The person Lena is of a free type, so the anchor does not limit it.',
    log: [
      { actor: 'client', call: 'update_entity Write docs', result: 'written' },
      { actor: 'client', call: 'update_entity Lena', result: 'written' },
    ],
  },
  {
    actor: 'client', rule: 'anchor', writeAccess: 'full', anchor: 'found', title: 'Outside the subtree: refused',
    nodes: ['client', 'write', 'anchor'], edges: ['client-write', 'write-anchor'], refused: ['anchor'],
    entities: { orion: 'refused' }, badges: { orion: 'refused' },
    body: 'Renaming the project Orion is refused: it is in the same hierarchy but outside the subtree.',
    log: [{ actor: 'client', call: 'update_entity Orion', result: 'refused · outside the anchor’s subtree' }],
  },
  {
    actor: 'client', rule: 'both', writeAccess: 'propose', anchor: 'found', title: 'Both rules: both must pass',
    nodes: ['client', 'stage', 'submit', 'review', 'commit'], edges: ['client-stage', 'stage-submit', 'submit-review', 'review-commit'],
    refused: ['commit'], entities: { docs: 'staged', orion: 'refused' }, badges: { docs: 'staged', orion: 'refused' },
    body: 'With write access propose and the anchor, the client stages renames of Write docs and Orion and submits. Staging does not judge the anchor; the commit does, and rejects the whole changeset.',
    log: [
      { actor: 'person', call: 'Write access: propose' },
      { actor: 'client', call: 'update_entity Write docs, Orion + changeset_id', result: 'staged as #1, #2' },
      { actor: 'client', call: 'submit_changeset' },
      { actor: 'person', call: 'Workbench · Commit', result: 'rejected · #2 Orion: Outside the anchor’s subtree' },
    ],
  },
  {
    actor: 'person', rule: 'anchor', writeAccess: 'full', anchor: 'deleted', title: 'Anchor deleted: everything refused',
    nodes: ['client', 'write', 'anchor'], edges: ['client-write', 'write-anchor'], refused: ['anchor'],
    entities: { lena: 'refused' }, badges: { lena: 'refused' },
    body: 'A person deletes the project Apollo; the delete dialog warned that it is agent-a’s anchor. Now every write through agent-a is refused, the free type too, until the anchor is moved or removed.',
    log: [{ actor: 'client', call: 'update_entity Lena', result: 'refused · anchor deleted' }],
  },
  {
    actor: 'person', rule: 'escapes', writeAccess: 'full', anchor: 'deleted', title: 'A guard against mistakes, not a lock',
    nodes: [], edges: [], entities: {},
    body: 'Rules keep a well-behaved client on track; they are not security. The plain lens URL writes as the lens allows, and anyone with REST access can change the rules.',
    log: [],
  },
]

/** The story's log up to and including a step, each entry with its step. */
export function logUpTo(index: number) {
  return STORY.slice(0, index + 1).flatMap((step, i) => step.log.map((entry) => ({ ...entry, step: i })))
}
