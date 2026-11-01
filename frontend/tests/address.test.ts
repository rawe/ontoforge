import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addressFromId, addressId, addressLabel, addressOf, itemKey, sameAddress, type DesignAddress,
} from '../src/assistants/address.ts'

const EVERY_KIND: DesignAddress[] = [
  { kind: 'entityType', entityType: 'person' },
  { kind: 'relationType', relationType: 'works_at' },
  { kind: 'entityTypeProperty', entityType: 'person', property: 'email' },
  { kind: 'relationTypeProperty', relationType: 'works_at', property: 'since' },
  { kind: 'lens', lens: 'main' },
  { kind: 'agent', lens: 'main', agent: 'support' },
  { kind: 'agent', lens: 'main', agent: null },
]

test('an address id stands for its kind and keys and reads back to the same address', () => {
  for (const address of EVERY_KIND) {
    assert.deepEqual(addressFromId(addressId(address)), address)
    assert.deepEqual(addressOf(address), address)
  }
  assert.equal(addressId({ kind: 'agent', lens: 'main', agent: 'support' }), addressId({ agent: 'support', kind: 'agent', lens: 'main' }))
})

test('an entity type and a relation type of the same key are different addresses, on the chip too', () => {
  const ofEntity: DesignAddress = { kind: 'entityTypeProperty', entityType: 'x', property: 'name' }
  const ofRelation: DesignAddress = { kind: 'relationTypeProperty', relationType: 'x', property: 'name' }
  assert.equal(sameAddress(ofEntity, ofRelation), false)
  assert.equal(sameAddress({ kind: 'entityType', entityType: 'x' }, { kind: 'relationType', relationType: 'x' }), false)
  assert.notDeepEqual(addressLabel(ofEntity), addressLabel(ofRelation))
})

test('two new items in the same owner have the same address; a saved one another', () => {
  assert.equal(sameAddress({ kind: 'agent', lens: 'main', agent: null }, { kind: 'agent', lens: 'main', agent: null }), true)
  assert.equal(sameAddress({ kind: 'agent', lens: 'main', agent: null }, { kind: 'agent', lens: 'main', agent: 'support' }), false)
  assert.equal(sameAddress({ kind: 'agent', lens: 'main', agent: null }, { kind: 'agent', lens: 'hr', agent: null }), false)
})

test('reads an address only of a known kind with exactly its fields, null only for the item', () => {
  assert.equal(addressOf(null), null)
  assert.equal(addressOf({ lensKey: 'main', agentKey: 'support' }), null)
  assert.equal(addressOf({ kind: 'property', key: 'email', typeKey: 'person' }), null)
  assert.equal(addressOf({ kind: 'agent', lens: 'main' }), null)
  assert.equal(addressOf({ kind: 'agent', lens: 'main', agent: 'support', key: 'support' }), null)
  assert.equal(addressOf({ kind: 'agent', lens: null, agent: 'support' }), null)
  assert.equal(addressOf({ kind: 'agent', lens: 'main', agent: '' }), null)
  assert.equal(addressOf({ kind: 'entityTypeProperty', relationType: 'works_at', property: 'since' }), null)
  assert.equal(addressOf({ kind: 'toString', toString: 'x' }), null)
})

test('the chip names the item by its keys and what it is, a new one as new', () => {
  assert.deepEqual(addressLabel({ kind: 'entityType', entityType: 'person' }), { name: 'person', what: 'entity type' })
  assert.deepEqual(addressLabel({ kind: 'entityTypeProperty', entityType: 'person', property: 'email' }),
    { name: 'person.email', what: 'entity type property' })
  assert.deepEqual(addressLabel({ kind: 'relationTypeProperty', relationType: 'works_at', property: 'since' }),
    { name: 'works_at.since', what: 'relation type property' })
  assert.deepEqual(addressLabel({ kind: 'lens', lens: 'main' }), { name: 'main', what: 'lens' })
  assert.deepEqual(addressLabel({ kind: 'agent', lens: 'main', agent: 'support' }), { name: 'main.support', what: 'agent' })
  assert.deepEqual(addressLabel({ kind: 'agent', lens: 'main', agent: null }), { name: 'main', what: 'new agent' })
  assert.equal(itemKey({ kind: 'agent', lens: 'main', agent: null }), null)
  assert.equal(itemKey({ kind: 'entityTypeProperty', entityType: 'person', property: 'email' }), 'email')
})
