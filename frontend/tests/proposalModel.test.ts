import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appliedIn, applicable, applyBlocker, checkedCall, checkLine, countsLine, createdTypes, designOf, initialReview, liveProposalCall, proposalArtifact,
  proposalRows, restoredCalls, reviewReducer, strayRefusals, type Design, type Proposal, type ProposalCheck, type ReviewAction,
  type ReviewState,
} from '../src/assistants/proposal/proposalModel.ts'
import type { ToolCall } from '../src/api/types.ts'

const proposal: Proposal = {
  summary: 'Adds contracts signed by people.',
  steps: [
    { id: 's1', op: 'create_entity_type', key: 'contract', name: 'Contract' },
    { id: 's2', op: 'add_property', entityType: 'contract', key: 'start', name: 'Start', dataType: 'date', required: true },
    { id: 's3', op: 'create_relation_type', key: 'signed_by', name: 'Signed by', source: 'contract', target: 'person', reason: 'who signs' },
    { id: 's4', op: 'set_description', entityType: 'person', description: 'A natural person' },
    { id: 's5', op: 'set_description', relationType: 'knows', property: 'since', description: 'Since when' },
  ],
}

const rev = (revision: number) => ({ ontologyId: 'o1', revision })

const ok: ProposalCheck = {
  ok: true, baseRevision: rev(41), refusals: [],
  validation: { introduced: [], preExisting: [{ path: 'entityTypes.old', message: 'bad' }] },
  warnings: [{ stepId: 's2', message: 'existing entities get no value' }, { message: 'loose' }],
  impact: { lenses: [], indices: [] }, limits: ['The check rolled back.'],
}
const refused: ProposalCheck = {
  ...ok, ok: false, refusals: [{ stepId: 's3', code: 'NOT_FOUND', message: "Target entity type 'person' does not exist" }],
  warnings: [], limits: ['The full check did not run.'],
}

const design: Design = {
  entityTypes: [{ key: 'person', description: null, properties: [{ key: 'name', description: null }] }],
  relationTypes: [{ key: 'knows', description: 'Knows', properties: [{ key: 'since', description: 'Old' }] }],
}

test('reads a proposal call and a restored artifact; a failed call or another artifact is none', () => {
  assert.deepEqual(checkedCall(proposal, ok), { proposal, check: ok })
  assert.equal(checkedCall(proposal, { error: 'Invalid input' }), null)
  assert.equal(checkedCall({ steps: [] }, ok), null)
  assert.equal(checkedCall({ steps: [{ id: 's1', op: 'delete_type' }] }, ok), null)
  const artifact = (check: ProposalCheck) => ({ type: 'proposal', version: 1, value: { proposal, check } })
  assert.deepEqual(proposalArtifact([artifact(refused), artifact(ok)]), { proposal, check: ok })
  assert.equal(proposalArtifact([{ type: 'proposal', version: 2, value: { proposal, check: ok } }, { type: 'draft' }]), null)
})

test("an answer's live proposal is its last call, only when that call succeeded", () => {
  const call = (callId: string, result: unknown, status: ToolCall['status'] = 'completed'): ToolCall =>
    ({ callId, tool: 'propose_schema_change', args: proposal as unknown as Record<string, unknown>, result, status })
  const read: ToolCall = { callId: 'r', tool: 'get_schema', args: {}, result: {}, status: 'completed' }
  const first = call('c1', ok)
  const second = call('c2', refused)
  assert.equal(liveProposalCall([first, read, second, read]), second)
  // A failed replacement never revives the earlier proposal.
  assert.equal(liveProposalCall([first, call('c2', { error: { code: 'RESOURCE_CONFLICT', message: 'busy' } })]), null)
  assert.equal(liveProposalCall([first, call('c2', undefined, 'interrupted')]), null)
  assert.equal(liveProposalCall([read]), null)
})

test('a restored answer gets its proposal back as one completed call', () => {
  const [call, ...more] = restoredCalls([{ type: 'proposal', version: 1, value: { proposal, check: ok } }])
  assert.equal(more.length, 0)
  assert.deepEqual(checkedCall(call!.args, call!.result), { proposal, check: ok })
  assert.deepEqual([call!.tool, call!.status], ['propose_schema_change', 'completed'])
  assert.deepEqual(restoredCalls([]), [])
})

test('reads the design of a schema export', () => {
  const read = designOf({
    entityTypes: [{ key: 'person', description: 'P', properties: [{ key: 'name', description: null }] }],
    relationTypes: [{ key: 'knows' }],
  })
  assert.deepEqual(read, {
    entityTypes: [{ key: 'person', description: 'P', properties: [{ key: 'name', description: null }] }],
    relationTypes: [{ key: 'knows', description: null, properties: [] }],
  })
  assert.equal(designOf({ error: 'x' }), null)
})

test('rows group by what they touch, with descriptions before and after', () => {
  const groups = proposalRows(proposal, ok, design)
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => `${r.mark} ${r.target}`)]), [
    ['Entity types', ['+ contract']],
    ['Properties', ['+ contract.start']],
    ['Relation types', ['+ signed_by']],
    ['Descriptions', ['~ person', '~ knows.since']],
  ])
  assert.equal(countsLine(groups), '1 entity type · 1 property · 1 relation type · 2 descriptions')
  const [types, properties, relations, descriptions] = groups
  assert.equal(properties!.rows[0]!.detail, 'date, required, “Start”')
  assert.equal(relations!.rows[0]!.detail, '“Signed by”, contract → person')
  assert.equal(relations!.rows[0]!.reason, 'who signs')
  assert.deepEqual(descriptions!.rows.map((r) => r.change), [{ before: '', after: 'A natural person' }, { before: 'Old', after: 'Since when' }])
  assert.deepEqual(types!.rows[0]!.type, { kind: 'entity-types', key: 'contract' })
  assert.deepEqual(descriptions!.rows[1]!.type, { kind: 'relation-types', key: 'knows' })
  // Unknown design: the before is unknown, not empty.
  assert.equal(proposalRows(proposal, ok, null).at(-1)!.rows[0]!.change!.before, undefined)
})

test("an added item's description is plain; a description set to its current text is unchanged", () => {
  const steps: Proposal['steps'] = [
    { id: 'a', op: 'create_entity_type', key: 'team', name: 'Team', description: 'A team' },
    { id: 'b', op: 'create_relation_type', key: 'in', name: 'In', source: 'person', target: 'team', description: 'Member of' },
    { id: 'c', op: 'add_property', entityType: 'team', key: 'size', name: 'Size', dataType: 'integer', description: 'Head count' },
    { id: 'd', op: 'set_description', relationType: 'knows', description: 'Knows' },
  ]
  const rows = proposalRows({ steps }, ok, design).flatMap((g) => g.rows)
  assert.deepEqual(rows.map((r) => [r.stepId, r.mark, r.description, r.change]), [
    ['a', '+', 'A team', undefined],
    ['c', '+', 'Head count', undefined],
    ['b', '+', 'Member of', undefined],
    ['d', '=', undefined, { before: 'Knows', after: 'Knows' }],
  ])
  // While the design is unknown it reads as a change.
  assert.equal(proposalRows({ steps }, ok, null).at(-1)!.rows[0]!.mark, '~')
})

test('a row carries only its own refusal and warnings from the check', () => {
  const rows = proposalRows(proposal, refused, design).flatMap((g) => g.rows)
  assert.deepEqual(rows.filter((r) => r.refusal !== undefined).map((r) => r.stepId), ['s3'])
  const withWarnings = proposalRows(proposal, ok, design).flatMap((g) => g.rows).filter((r) => r.warnings.length > 0)
  assert.deepEqual(withWarnings.map((r) => [r.stepId, r.warnings]), [['s2', ['existing entities get no value']]])
  assert.deepEqual(strayRefusals(proposal, { ...refused, refusals: [...refused.refusals, { stepId: 'x', code: 'INVALID', message: 'm' }] }).map((r) => r.stepId), ['x'])
})

test('the check line states the verdict, issues and impact', () => {
  assert.deepEqual(checkLine(ok), { verdict: 'ok', text: 'ok · 0 new issues · 1 pre-existing · touches no lens' })
  assert.equal(checkLine(refused).verdict, 'refused')
  assert.match(checkLine(refused).text, /^refused · 1 step refused/)
  const issues = { ...ok, ok: false, validation: { introduced: [{ path: 'a', message: 'b' }], preExisting: [] }, impact: { lenses: ['hr', 'all'], indices: ['people'] } }
  assert.deepEqual(checkLine(issues), {
    verdict: 'issues', text: 'not applicable · 1 new issue · 0 pre-existing · touches 2 lenses: hr, all · changes 1 search index: people',
  })
})

test('the first new type, in step order', () => {
  assert.deepEqual(createdTypes(proposal)[0], { kind: 'entity-types', key: 'contract' })
  assert.deepEqual(createdTypes({ steps: [proposal.steps[3]!] }), [])
})

test('a reloaded design shows the proposal applied only when every step took effect', () => {
  assert.equal(appliedIn(proposal, design), false)
  const after: Design = {
    entityTypes: [
      { key: 'person', description: 'A natural person', properties: [{ key: 'name', description: null }] },
      { key: 'contract', description: null, properties: [{ key: 'name', description: null }, { key: 'start', description: null }] },
    ],
    relationTypes: [
      { key: 'knows', description: 'Knows', properties: [{ key: 'since', description: 'Since when' }] },
      { key: 'signed_by', description: null, properties: [] },
    ],
  }
  assert.equal(appliedIn(proposal, after), true)
  assert.equal(appliedIn(proposal, { ...after, relationTypes: after.relationTypes.slice(0, 1) }), false)
})

test('a lost apply of repeated description steps on one target: only the last one decides', () => {
  const twice: Proposal = {
    steps: [
      { id: 's1', op: 'set_description', entityType: 'person', description: 'A' },
      { id: 's2', op: 'set_description', entityType: 'person', property: 'name', description: 'Name' },
      { id: 's3', op: 'set_description', entityType: 'person', description: 'B' },
    ],
  }
  const described = (type: string, name: string): Design => ({
    ...design, entityTypes: [{ key: 'person', description: type, properties: [{ key: 'name', description: name }] }],
  })
  assert.equal(appliedIn(twice, described('B', 'Name')), true)
  assert.equal(appliedIn(twice, described('A', 'Name')), false)
  assert.equal(appliedIn(twice, described('B', 'Old')), false)
})

const run = (state: ReviewState, ...actions: ReviewAction[]) => actions.reduce(reviewReducer, state)

test('Apply is offered only for a fresh, unrefused, ok check', () => {
  assert.equal(applicable(initialReview(ok, true)), true)
  assert.equal(applicable(initialReview(refused, true)), false)
  assert.equal(applicable(initialReview({ ...ok, ok: false }, true)), false)
  // A restored proposal: only after a re-check.
  const restored = initialReview(ok, false)
  assert.equal(applicable(restored), false)
  assert.equal(applicable(run(restored, { type: 'check' }, { type: 'checked', check: ok })), true)
  // A local edit since the check asks for one too.
  const edited = run(initialReview(ok, true), { type: 'edited' })
  assert.match(applyBlocker(edited)!, /edited/)
  assert.equal(applicable(run(edited, { type: 'check' }, { type: 'checked', check: { ...ok, baseRevision: rev(42) } })), true)
})

test('a local edit while a check runs still asks for a re-check', () => {
  const during = run(initialReview(ok, true), { type: 'check' }, { type: 'edited' }, { type: 'checked', check: { ...ok, baseRevision: rev(42) } })
  assert.equal(during.phase, 'ready')
  assert.match(applyBlocker(during)!, /edited/)
  // A failed check keeps it, and so does the edit before a check that then fails.
  assert.equal(run(initialReview(ok, true), { type: 'check' }, { type: 'edited' }, { type: 'failed', error: 'x' }).edited, true)
  assert.equal(run(initialReview(ok, true), { type: 'edited' }, { type: 'check' }, { type: 'failed', error: 'x' }).edited, true)
  // The next check, with no write during it, clears it.
  assert.equal(applicable(run(during, { type: 'check' }, { type: 'checked', check: ok })), true)
})

test('apply: the receipt, a stale design, a refusal', () => {
  const receipt = { revision: rev(42), created: { 'entityTypes.contract': 'id1' } }
  const applied = run(initialReview(ok, true), { type: 'apply' }, { type: 'applied', receipt })
  assert.equal(applied.phase, 'applied')
  assert.deepEqual(applied.receipt, receipt)
  assert.equal(run(applied, { type: 'edited' }, { type: 'reject' }).phase, 'applied')

  const stale = run(initialReview(ok, true), { type: 'apply' }, { type: 'designChanged', current: rev(43) })
  assert.deepEqual(stale.stale, { checked: rev(41), current: rev(43) })
  assert.equal(applicable(stale), false)
  const rechecked = run(stale, { type: 'check' }, { type: 'checked', check: { ...ok, baseRevision: rev(43) } })
  assert.equal(rechecked.stale, null)
  assert.equal(applicable(rechecked), true)

  const refusedApply = run(initialReview(ok, true), { type: 'apply' }, { type: 'refused', check: refused })
  assert.equal(refusedApply.refused, true)
  assert.equal(refusedApply.check, refused)
  assert.equal(applicable(refusedApply), false)
  // Apply is ignored while it is not offered.
  assert.equal(run(initialReview(refused, true), { type: 'apply' }).phase, 'ready')
})

test('a lost apply response: the reloaded design decides, and nothing retries', () => {
  const confirming = run(initialReview(ok, true), { type: 'apply' }, { type: 'lost' })
  assert.equal(confirming.phase, 'confirming')
  assert.equal(applicable(confirming), false)
  const applied = run(confirming, { type: 'reconciled', applied: true })
  assert.deepEqual([applied.phase, applied.lost, applied.receipt], ['applied', 'applied', null])
  const notApplied = run(confirming, { type: 'reconciled', applied: false })
  assert.deepEqual([notApplied.phase, notApplied.lost], ['ready', 'not-applied'])
  assert.equal(applicable(notApplied), false)
  assert.equal(run(confirming, { type: 'reconciled', applied: null }).lost, 'unknown')
  assert.equal(applicable(run(notApplied, { type: 'check' }, { type: 'checked', check: ok })), true)
})

test('reject ends the card; a failed request keeps it', () => {
  assert.equal(run(initialReview(ok, true), { type: 'reject' }).phase, 'rejected')
  const failed = run(initialReview(ok, true), { type: 'check' }, { type: 'failed', error: 'offline' })
  assert.deepEqual([failed.phase, failed.error], ['ready', 'offline'])
})
