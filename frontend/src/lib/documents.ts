/**
 * Helpers for `document` properties: stub detection (entity reads never carry
 * document content inline — see `DocumentStub`) and compact size formatting.
 */

import type { DocumentStub } from '@/api/types'

/** True when a property value is a document stub (`{document: true, length}`). */
export function isDocumentStub(value: unknown): value is DocumentStub {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { document?: unknown }).document === true &&
    typeof (value as { length?: unknown }).length === 'number'
  )
}

/** Compact human size for a character count, e.g. "312 chars", "47 KB". */
export function formatDocSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  if (chars < 1_000_000) {
    const kb = chars / 1000
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  return `${(chars / 1_000_000).toFixed(1)} MB`
}
