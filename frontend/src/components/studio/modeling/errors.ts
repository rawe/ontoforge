/**
 * Pure error helpers of the modeling layer. No React, no I/O — unit-tested
 * with `node --test`.
 */

import { ApiError } from '../../../api/http.ts'

/**
 * Field errors of a failed write, by field name. Service validation errors
 * carry `details.fields`; request-shape errors carry
 * `details.errors[{path: "/key", message}]`, mapped to the path's first
 * segment. `details.fields` wins when both name the same field. Anything
 * that is not an `ApiError` has none.
 */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  const fields: Record<string, string> = { ...(error.fieldErrors ?? {}) }
  const shape = error.details?.errors
  if (Array.isArray(shape)) {
    for (const issue of shape as { path?: unknown; message?: unknown }[]) {
      if (typeof issue?.path !== 'string') continue
      const field = issue.path.replace(/^\//, '').split('/')[0]
      if (field !== '' && fields[field] === undefined) {
        fields[field] = typeof issue.message === 'string' ? issue.message : 'Invalid value'
      }
    }
  }
  return fields
}
