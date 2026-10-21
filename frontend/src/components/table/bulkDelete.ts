/**
 * The closing text of a type table's bulk delete: deleted live or staged
 * into the pinned changeset, with what failed or was skipped. Pure, no React.
 */

export interface BulkDeleteResult {
  total: number
  failed: number
  /** Not tried: the pinned changeset changed (pinned or left) during the run. */
  skipped: number
  /** Whether the run staged into the pinned changeset instead of deleting. */
  staged: boolean
}

export function bulkDeleteSummary({ total, failed, skipped, staged }: BulkDeleteResult): {
  ok: boolean
  text: string
} {
  const done = total - failed - skipped
  if (failed === 0 && skipped === 0) {
    return {
      ok: true,
      text: staged
        ? `Staged ${total} ${total === 1 ? 'delete' : 'deletes'}`
        : `Deleted ${total} ${total === 1 ? 'entity' : 'entities'}`,
    }
  }
  const parts = [`${staged ? 'Staged' : 'Deleted'} ${done} of ${total}`]
  if (failed > 0) parts.push(`${failed} failed`)
  if (skipped > 0) parts.push(`${skipped} skipped: the pinned changeset changed`)
  return { ok: false, text: parts.join('; ') }
}
