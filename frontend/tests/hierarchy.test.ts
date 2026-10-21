import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ParentEnd, SchemaRelationType } from '../src/api/types.ts'
import {
  formatPath,
  hierarchyLinks,
  labelParentError,
  linkedTypeKey,
  sharesLinkedType,
  splitParentErrors,
  stepLabel,
} from '../src/components/entity/hierarchy.ts'

const relation = (
  key: string,
  from: string,
  to: string,
  parent: ParentEnd | null,
): SchemaRelationType => ({
  key,
  displayName: key,
  description: null,
  fromEntityTypeKey: from,
  toEntityTypeKey: to,
  parent,
  properties: [],
})

// The project_hierarchy fixture's relation types.
const schema = [
  relation('has_project', 'customer', 'project', 'source'),
  relation('has_task', 'project', 'task', 'source'),
  relation('has_subtask', 'task', 'task', 'source'),
  relation('belongs_to', 'milestone', 'project', 'target'),
  relation('assigned_to', 'task', 'person', null),
]

const keys = (links: ReturnType<typeof hierarchyLinks>['parents']) =>
  links.map((l) => `${l.relationType.key}:${l.direction}`)

test('a project: its parent over has_project, its children over has_task and the up-pointing belongs_to', () => {
  const { parents, children } = hierarchyLinks(schema, 'project')
  assert.deepEqual(keys(parents), ['has_project:incoming'])
  assert.deepEqual(keys(children), ['has_task:outgoing', 'belongs_to:incoming'])
  assert.deepEqual(children.map(linkedTypeKey), ['task', 'milestone'])
  assert.deepEqual(parents.map(linkedTypeKey), ['customer'])
})

test('a task: a parent self-relation is on both sides; ordinary relations are on neither', () => {
  const { parents, children } = hierarchyLinks(schema, 'task')
  assert.deepEqual(keys(parents), ['has_task:incoming', 'has_subtask:incoming'])
  assert.deepEqual(keys(children), ['has_subtask:outgoing'])
})

test('a milestone reaches its parent outgoing over an up-pointing relation; a root type has no parent link', () => {
  assert.deepEqual(keys(hierarchyLinks(schema, 'milestone').parents), ['belongs_to:outgoing'])
  assert.deepEqual(hierarchyLinks(schema, 'milestone').children, [])
  assert.deepEqual(hierarchyLinks(schema, 'customer').parents, [])
  assert.deepEqual(hierarchyLinks(schema, 'person'), { parents: [], children: [] })
})

test('sharesLinkedType tells when two links reach the same type', () => {
  const twoToTask = [...schema, relation('has_backlog_task', 'project', 'task', 'source')]
  const { children } = hierarchyLinks(twoToTask, 'project')
  assert.deepEqual(children.map((link) => sharesLinkedType(link, children)), [true, false, true])
  const alone = hierarchyLinks(schema, 'project').children
  assert.deepEqual(alone.map((link) => sharesLinkedType(link, alone)), [false, false])
})

test('formatPath joins the step names root first; a missing name falls back to the short id', () => {
  const path = [
    { type: 'customer', id: 'c1', name: 'ACME' },
    { type: 'project', id: 'p1', name: 'P1' },
    { type: 'task', id: '0123456789abcdef', name: null },
  ]
  assert.equal(formatPath(path), 'ACME › P1 › 0123456789ab')
  assert.equal(stepLabel({ type: 'task', id: '0123456789abcdef', name: '  ' }), '0123456789ab')
  assert.equal(formatPath([]), '')
})

test('labelParentError names the entity by its label; other messages pass through', () => {
  const labels = { 'id-t1': 'T1' }
  assert.equal(labelParentError("Entity 'id-t1' already has a parent", labels), 'T1 already has a parent')
  assert.equal(
    labelParentError("Entity 'id-x' already has a parent", labels),
    "Entity 'id-x' already has a parent",
  )
  assert.equal(labelParentError('Entity not found', labels), 'Entity not found')
})

test('splitParentErrors separates the entity, the relation properties and other parent relation faults', () => {
  assert.deepEqual(
    splitParentErrors({
      name: 'Required property missing',
      'parentRelation.properties.phase': 'Required property missing',
      'parentRelation.parentId': "Entity 'x' not found",
    }),
    {
      entity: { name: 'Required property missing' },
      relation: { phase: 'Required property missing' },
      form: "Entity 'x' not found",
    },
  )
  assert.deepEqual(splitParentErrors({ name: 'bad' }), {
    entity: { name: 'bad' },
    relation: {},
    form: null,
  })
})
