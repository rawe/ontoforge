import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulkDeleteSummary } from '../src/components/table/bulkDelete.ts'

test('bulkDeleteSummary keeps the live texts', () => {
  assert.deepEqual(bulkDeleteSummary({ total: 1, failed: 0, skipped: 0, staged: false }), {
    ok: true,
    text: 'Deleted 1 entity',
  })
  assert.deepEqual(bulkDeleteSummary({ total: 5, failed: 2, skipped: 0, staged: false }), {
    ok: false,
    text: 'Deleted 3 of 5; 2 failed',
  })
})

test('bulkDeleteSummary names staged deletes and skipped ones', () => {
  assert.deepEqual(bulkDeleteSummary({ total: 3, failed: 0, skipped: 0, staged: true }), {
    ok: true,
    text: 'Staged 3 deletes',
  })
  assert.deepEqual(bulkDeleteSummary({ total: 5, failed: 1, skipped: 2, staged: true }), {
    ok: false,
    text: 'Staged 2 of 5; 1 failed; 2 skipped: the pinned changeset changed',
  })
})
