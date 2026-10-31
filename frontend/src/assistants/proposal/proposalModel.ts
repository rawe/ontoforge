/**
 * Proposal review's pure parts: reading a schema proposal and its check
 * from a tool call or a restored artifact, the review's rows grouped by
 * what they touch with each row's refusal and warnings from the server's
 * check, the check line, the review's state through check, apply and
 * their outcomes, whether Apply is offered, and whether a reloaded design
 * shows the proposal applied (after a lost apply response).
 *
 * Rows come from the proposal's steps; whether a step is refused, what it
 * warns and what the proposal touches come only from the server's check.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { ToolCall } from '@/api/types'

/* --------------------------------- contract -------------------------------- */

interface StepFields {
  id: string
  /** The model's reason for the step, its own words. */
  reason?: string
}

/** One additive design step, by key (the server's `proposals/proposal.ts`). */
export type ProposalStep = StepFields & (
  | { op: 'create_entity_type'; key: string; name: string; description?: string }
  | { op: 'create_relation_type'; key: string; name: string; source: string; target: string; description?: string }
  | {
    op: 'add_property'; entityType?: string; relationType?: string; key: string; name: string; dataType: string
    required?: boolean; defaultValue?: string; description?: string
  }
  | { op: 'set_description'; entityType?: string; relationType?: string; property?: string; description: string }
)

export interface Proposal {
  /** One sentence by the model on what the proposal does. */
  summary?: string
  steps: ProposalStep[]
}

/** A design revision: the one a check ran on, Apply expects, Apply committed. */
export interface DesignRevision {
  ontologyId: string
  revision: number
}

export interface Refusal {
  stepId: string
  code: string
  message: string
  details?: unknown
}

export interface Issue {
  path: string
  message: string
}

/** The server's check of a whole proposal; it wrote nothing. */
export interface ProposalCheck {
  ok: boolean
  baseRevision: DesignRevision
  refusals: Refusal[]
  validation: { introduced: Issue[]; preExisting: Issue[] }
  warnings: { stepId?: string; path?: string; message: string }[]
  impact: { lenses: string[]; indices: string[] }
  /** What the check does not prove, in the server's words. */
  limits: string[]
}

/** What an applied proposal committed: its revision and the ids of what it created, by design path. */
export interface Receipt {
  revision: DesignRevision
  created: Record<string, string>
}

/** A proposal with the check it came with. */
export interface CheckedProposal {
  proposal: Proposal
  check: ProposalCheck
}

export const PROPOSE_TOOL = 'propose_schema_change'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

function isRevision(v: unknown): v is DesignRevision {
  return isRecord(v) && isString(v.ontologyId) && typeof v.revision === 'number'
}

/** The design revision a value holds (a 409 DESIGN_CHANGED's `current`); null when it is none. */
export const revisionOf = (value: unknown): DesignRevision | null => (isRevision(value) ? value : null)

/** The check a result holds; null for anything else (a tool error). */
export function checkOf(result: unknown): ProposalCheck | null {
  if (!isRecord(result) || typeof result.ok !== 'boolean' || !isRevision(result.baseRevision)) return null
  const { refusals, validation, warnings, impact, limits } = result
  if (!Array.isArray(refusals) || !isRecord(validation) || !Array.isArray(validation.introduced) ||
    !Array.isArray(validation.preExisting) || !Array.isArray(warnings) || !isRecord(impact) ||
    !Array.isArray(impact.lenses) || !Array.isArray(impact.indices) || !Array.isArray(limits)) return null
  return result as unknown as ProposalCheck
}

const OPS = new Set(['create_entity_type', 'create_relation_type', 'add_property', 'set_description'])

/** The proposal a value holds; null when it is none. */
export function proposalOf(value: unknown): Proposal | null {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length === 0) return null
  if (value.summary !== undefined && !isString(value.summary)) return null
  const steps = value.steps.every((step) => isRecord(step) && isString(step.id) && OPS.has(step.op as string))
  return steps ? (value as unknown as Proposal) : null
}

/** A `propose_schema_change` call's proposal (its arguments) with its check (its result); null for a failed call. */
export function checkedCall(args: unknown, result: unknown): CheckedProposal | null {
  const proposal = proposalOf(args)
  const check = checkOf(result)
  return proposal === null || check === null ? null : { proposal, check }
}

/** The last proposal artifact of a restored answer; null for none. */
export function proposalArtifact(artifacts: readonly unknown[]): CheckedProposal | null {
  for (const artifact of [...artifacts].reverse()) {
    if (!isRecord(artifact) || artifact.type !== 'proposal' || artifact.version !== 1 || !isRecord(artifact.value)) continue
    const found = checkedCall(artifact.value.proposal, artifact.value.check)
    if (found !== null) return found
  }
  return null
}

/**
 * A restored answer's tool calls: its proposal artifact as the one
 * completed proposal call, so its card shows again; none without one.
 */
export function restoredCalls(artifacts: readonly unknown[]): ToolCall[] {
  const found = proposalArtifact(artifacts)
  return found === null ? [] : [{
    callId: 'restored-proposal', tool: PROPOSE_TOOL, args: found.proposal as unknown as Record<string, unknown>,
    result: found.check, status: 'completed',
  }]
}

/* ---------------------------------- design --------------------------------- */

/** What the review reads of the current design: each type by key, its description and its properties'. */
export interface DesignType {
  key: string
  description: string | null
  properties: { key: string; description: string | null }[]
}

export interface Design {
  entityTypes: DesignType[]
  relationTypes: DesignType[]
}

/** The design of a schema export (`GET …/model/export`); null when it is none. */
export function designOf(exported: unknown): Design | null {
  if (!isRecord(exported) || !Array.isArray(exported.entityTypes) || !Array.isArray(exported.relationTypes)) return null
  const types = (rows: unknown[]): DesignType[] => rows.filter(isRecord).map((row) => ({
    key: String(row.key),
    description: isString(row.description) ? row.description : null,
    properties: (Array.isArray(row.properties) ? row.properties : []).filter(isRecord).map((p) => ({
      key: String(p.key),
      description: isString(p.description) ? p.description : null,
    })),
  }))
  return { entityTypes: types(exported.entityTypes), relationTypes: types(exported.relationTypes) }
}

/* ----------------------------------- rows ---------------------------------- */

export type TypeKind = 'entity-types' | 'relation-types'

export type GroupKey = 'entityTypes' | 'properties' | 'relationTypes' | 'descriptions'

export const GROUP_LABELS: Record<GroupKey, string> = {
  entityTypes: 'Entity types',
  properties: 'Properties',
  relationTypes: 'Relation types',
  descriptions: 'Descriptions',
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const GROUP_ORDER: GroupKey[] = ['entityTypes', 'properties', 'relationTypes', 'descriptions']

/** One row of the review: one step. */
export interface ProposalRow {
  stepId: string
  /** `+` adds, `~` changes. */
  mark: '+' | '~'
  /** What it names: a type key, or `type.property`. */
  target: string
  /** What it adds: a name, a data type, the ends of a relation type. */
  detail: string
  /** A description step's text before and after; `before` is undefined while the design is unknown. */
  change?: { before: string | undefined; after: string }
  /** The model's reason, its own words. */
  reason?: string
  /** The server's refusal of this step. */
  refusal?: Refusal
  /** The server's warnings about this step. */
  warnings: string[]
  /** The type the step is about, to select it. */
  type: { kind: TypeKind; key: string }
}

export interface RowGroup {
  key: GroupKey
  label: string
  rows: ProposalRow[]
}

type OwnedStep = Extract<ProposalStep, { op: 'add_property' | 'set_description' }>

function ownerOf(step: OwnedStep): { kind: TypeKind; key: string } {
  return step.entityType !== undefined
    ? { kind: 'entity-types', key: step.entityType }
    : { kind: 'relation-types', key: step.relationType ?? '' }
}

/** The description a step's target has in `design`: '' for none or a type the proposal creates; undefined while unknown. */
function descriptionBefore(step: Extract<ProposalStep, { op: 'set_description' }>, design: Design | null): string | undefined {
  if (design === null) return undefined
  const owner = ownerOf(step)
  const type = (owner.kind === 'entity-types' ? design.entityTypes : design.relationTypes).find((t) => t.key === owner.key)
  const described = step.property === undefined ? type : type?.properties.find((p) => p.key === step.property)
  return described?.description ?? ''
}

function propertyDetail(step: Extract<ProposalStep, { op: 'add_property' }>): string {
  return [
    step.dataType,
    ...(step.required === true ? ['required'] : []),
    ...(step.defaultValue === undefined ? [] : [`default “${step.defaultValue}”`]),
    `“${step.name}”`,
  ].join(', ')
}

/** The review's rows of a proposal by group (empty groups left out), each with what the check says of its step. */
export function proposalRows(proposal: Proposal, check: ProposalCheck | null, design: Design | null): RowGroup[] {
  const byGroup = new Map<GroupKey, ProposalRow[]>(GROUP_ORDER.map((key) => [key, []]))
  for (const step of proposal.steps) {
    const refusal = check?.refusals.find((r) => r.stepId === step.id)
    const common = {
      stepId: step.id,
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      ...(refusal === undefined ? {} : { refusal }),
      warnings: (check?.warnings ?? []).filter((w) => w.stepId === step.id).map((w) => w.message),
    }
    switch (step.op) {
      case 'create_entity_type':
        byGroup.get('entityTypes')!.push({
          ...common, mark: '+', target: step.key, detail: `“${step.name}”, with a name property`,
          type: { kind: 'entity-types', key: step.key },
          ...(step.description === undefined ? {} : { change: { before: '', after: step.description } }),
        })
        break
      case 'create_relation_type':
        byGroup.get('relationTypes')!.push({
          ...common, mark: '+', target: step.key, detail: `“${step.name}”, ${step.source} → ${step.target}`,
          type: { kind: 'relation-types', key: step.key },
          ...(step.description === undefined ? {} : { change: { before: '', after: step.description } }),
        })
        break
      case 'add_property': {
        const owner = ownerOf(step)
        byGroup.get('properties')!.push({
          ...common, mark: '+', target: `${owner.key}.${step.key}`, detail: propertyDetail(step), type: owner,
          ...(step.description === undefined ? {} : { change: { before: '', after: step.description } }),
        })
        break
      }
      case 'set_description': {
        const owner = ownerOf(step)
        byGroup.get('descriptions')!.push({
          ...common, mark: '~', target: step.property === undefined ? owner.key : `${owner.key}.${step.property}`,
          detail: step.property === undefined ? (owner.kind === 'entity-types' ? 'entity type' : 'relation type') : 'property',
          change: { before: descriptionBefore(step, design), after: step.description },
          type: owner,
        })
        break
      }
    }
  }
  return GROUP_ORDER.flatMap((key) => {
    const rows = byGroup.get(key)!
    return rows.length === 0 ? [] : [{ key, label: GROUP_LABELS[key], rows }]
  })
}

const NOUNS: Record<GroupKey, [string, string]> = {
  entityTypes: ['entity type', 'entity types'],
  properties: ['property', 'properties'],
  relationTypes: ['relation type', 'relation types'],
  descriptions: ['description', 'descriptions'],
}

/** What the rows add and change, counted: `1 entity type · 2 properties`. */
export function countsLine(groups: readonly RowGroup[]): string {
  return groups.map((g) => count(g.rows.length, ...NOUNS[g.key])).join(' · ')
}

/** Refusals that name no step of the proposal, shown with the check. */
export function strayRefusals(proposal: Proposal, check: ProposalCheck): Refusal[] {
  const ids = new Set(proposal.steps.map((step) => step.id))
  return check.refusals.filter((r) => !ids.has(r.stepId))
}

/** The check in one line: its verdict, new and pre-existing issues, what it touches. */
export function checkLine(check: ProposalCheck): { verdict: 'ok' | 'refused' | 'issues'; text: string } {
  const verdict = check.refusals.length > 0 ? 'refused' : check.ok ? 'ok' : 'issues'
  const { lenses, indices } = check.impact
  const parts = [
    verdict === 'refused' ? `refused · ${count(check.refusals.length, 'step')} refused` : verdict === 'ok' ? 'ok' : 'not applicable',
    `${count(check.validation.introduced.length, 'new issue')}`,
    `${check.validation.preExisting.length} pre-existing`,
    lenses.length === 0 ? 'touches no lens' : `touches ${count(lenses.length, 'lens', 'lenses')}: ${lenses.join(', ')}`,
    ...(indices.length === 0 ? [] : [`changes ${count(indices.length, 'search index', 'search indices')}: ${indices.join(', ')}`]),
  ]
  return { verdict, text: parts.join(' · ') }
}

/** The types the proposal creates, in step order. */
export function createdTypes(proposal: Proposal): { kind: TypeKind; key: string }[] {
  return proposal.steps.flatMap((step): { kind: TypeKind; key: string }[] =>
    step.op === 'create_entity_type' ? [{ kind: 'entity-types', key: step.key }]
      : step.op === 'create_relation_type' ? [{ kind: 'relation-types', key: step.key }]
        : [])
}

/** Whether a type is in the design. */
export function typeExists(design: Design | null, type: { kind: TypeKind; key: string }): boolean {
  return (type.kind === 'entity-types' ? design?.entityTypes : design?.relationTypes)?.some((t) => t.key === type.key) ?? false
}

/**
 * Whether the design shows the proposal applied: every step's effect is
 * there. A proposal applies whole or not at all, so after a lost apply
 * response this tells which.
 */
export function appliedIn(proposal: Proposal, design: Design): boolean {
  const find = (kind: TypeKind, key: string) => (kind === 'entity-types' ? design.entityTypes : design.relationTypes).find((t) => t.key === key)
  return proposal.steps.every((step) => {
    switch (step.op) {
      case 'create_entity_type':
        return find('entity-types', step.key) !== undefined
      case 'create_relation_type':
        return find('relation-types', step.key) !== undefined
      case 'add_property': {
        const owner = ownerOf(step)
        return find(owner.kind, owner.key)?.properties.some((p) => p.key === step.key) ?? false
      }
      case 'set_description': {
        const owner = ownerOf(step)
        const type = find(owner.kind, owner.key)
        const described = step.property === undefined ? type : type?.properties.find((p) => p.key === step.property)
        return described?.description === step.description
      }
    }
  })
}

/* ---------------------------------- state ---------------------------------- */

export type ReviewPhase = 'ready' | 'checking' | 'applying' | 'confirming' | 'applied' | 'rejected'

/** One proposal card's state: its latest check and what happened to it here. */
export interface ReviewState {
  check: ProposalCheck
  /**
   * Checked in this view: false for a restored proposal until it is
   * re-checked, and after a lost apply response the reloaded design says
   * was not applied.
   */
  fresh: boolean
  phase: ReviewPhase
  /** Apply met another design revision than the checked one (409 DESIGN_CHANGED). */
  stale: { checked: DesignRevision; current: DesignRevision } | null
  /** The design was edited here since the check: advisory, the server decides on Apply. */
  edited: boolean
  /** The last Apply was refused; nothing was written. The check is the refusing one. */
  refused: boolean
  /** The applied proposal's receipt; null when it was applied but its response was lost. */
  receipt: Receipt | null
  /** An Apply response was lost: what the reloaded design said, or 'unknown' when it could not be read. */
  lost: 'applied' | 'not-applied' | 'unknown' | null
  /** The last request's error, in words. */
  error: string | null
}

export type ReviewAction =
  | { type: 'check' }
  | { type: 'checked'; check: ProposalCheck }
  | { type: 'apply' }
  | { type: 'applied'; receipt: Receipt }
  | { type: 'designChanged'; current: DesignRevision }
  | { type: 'refused'; check: ProposalCheck }
  | { type: 'lost' }
  | { type: 'reconciled'; applied: boolean | null }
  | { type: 'failed'; error: string }
  | { type: 'edited' }
  | { type: 'reject' }

/** A card's first state: its check, fresh for a live answer, not for a restored one. */
export function initialReview(check: ProposalCheck, fresh: boolean): ReviewState {
  return { check, fresh, phase: 'ready', stale: null, edited: false, refused: false, receipt: null, lost: null, error: null }
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  const busy = state.phase !== 'ready'
  switch (action.type) {
    case 'check':
      return state.phase === 'ready' ? { ...state, phase: 'checking', error: null } : state
    case 'checked':
      return state.phase === 'checking'
        ? { ...state, phase: 'ready', check: action.check, fresh: true, stale: null, edited: false, refused: false, lost: null }
        : state
    case 'apply':
      return applicable(state) ? { ...state, phase: 'applying', error: null } : state
    case 'applied':
      return state.phase === 'applying' ? { ...state, phase: 'applied', receipt: action.receipt } : state
    case 'designChanged':
      return state.phase === 'applying'
        ? { ...state, phase: 'ready', stale: { checked: state.check.baseRevision, current: action.current } }
        : state
    case 'refused':
      return state.phase === 'applying' ? { ...state, phase: 'ready', check: action.check, refused: true } : state
    case 'lost':
      return state.phase === 'applying' ? { ...state, phase: 'confirming', lost: null } : state
    case 'reconciled':
      if (state.phase !== 'confirming') return state
      if (action.applied === true) return { ...state, phase: 'applied', receipt: null, lost: 'applied' }
      // Not applied, or unknown: Apply waits for a fresh check either way.
      return { ...state, phase: 'ready', fresh: false, lost: action.applied === false ? 'not-applied' : 'unknown' }
    case 'failed':
      return state.phase === 'checking' || state.phase === 'applying' ? { ...state, phase: 'ready', error: action.error } : state
    case 'edited':
      return busy ? state : { ...state, edited: true }
    case 'reject':
      return busy ? state : { ...state, phase: 'rejected' }
  }
}

/** Why Apply is not offered now; null when it is. */
export function applyBlocker(state: ReviewState): string | null {
  if (state.phase !== 'ready') return state.phase
  if (state.stale !== null) return 'The schema changed since this check. Re-check first.'
  if (!state.fresh) return 'Re-check the proposal against the current schema first.'
  if (state.edited) return 'The schema was edited since this check. Re-check first.'
  if (state.check.refusals.length > 0) return 'A step is refused.'
  if (!state.check.ok) return 'The proposal introduces validation errors.'
  return null
}

/** Apply is offered: a fresh, unrefused, ok check of a design not known to have changed since. */
export const applicable = (state: ReviewState) => applyBlocker(state) === null

/** Re-check is offered: the card is idle and not decided. */
export const recheckable = (state: ReviewState) => state.phase === 'ready'
