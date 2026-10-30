import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Lens } from '../src/api/types.ts'
import {
  pickLens,
  studioContext,
  studioTarget,
  workbenchLensPage,
} from '../src/components/layout/surfaceSwitch.ts'

const OK = 'org'
const W = `/o/${OK}/w/directory`
const S = `/o/${OK}/studio`

/* ---------------------------- Workbench → Studio ---------------------------- */

test('a type table or entity opens that entity type in the schema graph', () => {
  assert.equal(studioTarget(OK, `${W}/t/person`, '', 'L1'), `${S}/schema/graph?sel=entity:person`)
  assert.equal(studioTarget(OK, `${W}/e/person/42`, '', 'L1'), `${S}/schema/graph?sel=entity:person`)
  assert.equal(studioTarget(OK, `${W}/t/person`, '', undefined), `${S}/schema/graph?sel=entity:person`)
})

test('lens-level pages open the lens, on the matching tab', () => {
  assert.equal(studioTarget(OK, W, '', 'L1'), `${S}/lenses/L1`)
  assert.equal(studioTarget(OK, `${W}/explore`, '?focus=person:1', 'L1'), `${S}/lenses/L1`)
  assert.equal(studioTarget(OK, `${W}/query`, '?tab=library', 'L1'), `${S}/lenses/L1?tab=queries`)
  assert.equal(studioTarget(OK, `${W}/search`, '', 'L1'), `${S}/lenses/L1`)
  assert.equal(studioTarget(OK, `${W}/ai`, '', 'L1'), `${S}/lenses/L1?tab=agents`)
  assert.equal(studioTarget(OK, `${W}/ai`, '?tab=retriever', 'L1'), `${S}/lenses/L1?tab=retriever-agents`)
  assert.equal(studioTarget(OK, `${W}/ai`, '?tab=navigator&assistant=x', 'L1'), `${S}/lenses/L1?tab=navigators`)
  assert.equal(studioTarget(OK, `${W}/rulesets`, '', 'L1'), `${S}/lenses/L1?tab=connect`)
  // No old route: an /anchors address is no page of its own.
  assert.equal(studioTarget(OK, `${W}/anchors`, '', 'L1'), `${S}/lenses/L1`)
  assert.equal(studioTarget(OK, `${W}/changesets`, '', 'L1'), `${S}/lenses/L1`)
  assert.equal(studioTarget(OK, `${W}/changesets/cs-1`, '', 'L1'), `${S}/lenses/L1`)
})

test('lens-level pages fall back to the lens list while the lens id is unknown', () => {
  assert.equal(studioTarget(OK, `${W}/query`, '', undefined), `${S}/lenses`)
})

/* ---------------------------- Studio → Workbench ---------------------------- */

test('studio context: a lens, a selected entity type, or nothing', () => {
  assert.deepEqual(studioContext(`${S}/lenses/L1`, '?tab=queries'), { kind: 'lens', lensId: 'L1', tab: 'queries' })
  assert.deepEqual(studioContext(`${S}/lenses/L1`, ''), { kind: 'lens', lensId: 'L1', tab: null })
  assert.deepEqual(studioContext(`${S}/schema/graph`, '?sel=entity:person&prop=name'), { kind: 'type', typeKey: 'person' })
  assert.deepEqual(studioContext(`${S}/schema/types/entity/person`, ''), { kind: 'type', typeKey: 'person' })
  assert.deepEqual(studioContext(`${S}/schema/graph`, '?sel=relation:manages'), { kind: 'none' })
  assert.deepEqual(studioContext(`${S}/lenses`, ''), { kind: 'none' })
  assert.deepEqual(studioContext(`${S}/search/person~default`, ''), { kind: 'none' })
})

test('a lens tab opens the matching workbench page', () => {
  assert.equal(workbenchLensPage(OK, 'directory', null), W)
  assert.equal(workbenchLensPage(OK, 'directory', 'scope'), W)
  assert.equal(workbenchLensPage(OK, 'directory', 'connect'), W)
  assert.equal(workbenchLensPage(OK, 'directory', 'queries'), `${W}/query?tab=library`)
  assert.equal(workbenchLensPage(OK, 'directory', 'agents'), `${W}/ai`)
  assert.equal(workbenchLensPage(OK, 'directory', 'retriever-agents'), `${W}/ai?tab=retriever`)
  assert.equal(workbenchLensPage(OK, 'directory', 'navigators'), `${W}/ai?tab=navigator`)
})

/* ------------------------------- target lens -------------------------------- */

const lens = (key: string): Lens => ({
  lensId: `id-${key}`, key, name: key, description: null, createdAt: '', updatedAt: '',
})
const LENSES = [lens('directory'), lens('all'), lens('staffing')]

test('target lens: remembered, else first unscoped, else first, else none', () => {
  assert.equal(pickLens(LENSES, 'staffing', new Set(['all']))?.key, 'staffing')
  assert.equal(pickLens(LENSES, null, new Set(['all']))?.key, 'all')
  assert.equal(pickLens(LENSES, 'gone', new Set(['all']))?.key, 'all')
  assert.equal(pickLens(LENSES, null, new Set())?.key, 'directory')
  assert.equal(pickLens([], 'directory', new Set()), null)
})
