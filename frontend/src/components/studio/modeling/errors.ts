/**
 * Pure error helpers of the modeling layer. No React, no I/O — unit-tested
 * with `node --test`.
 */

import { ApiError } from '../../../api/http.ts'
import type { ParentViolation } from '../../../api/types.ts'

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

/**
 * The broken parent rules of a refused flag write: a 409 whose
 * `details.violations` lists them. Null for any other error.
 */
export function parentViolationsOf(error: unknown): ParentViolation[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const violations = error.details?.violations
  return Array.isArray(violations) ? (violations as ParentViolation[]) : null
}

const RULE_LABELS: Record<ParentViolation['rule'], string> = {
  two_parents: 'Two parents',
  cycle: 'Cycles',
}

export interface RefusalLine {
  rule: ParentViolation['rule']
  /** "Two parents · 2 entities", "Cycles · none". */
  summary: string
  /** The first five breaking entities. */
  entities: ParentViolation['entities']
  /** Breaking entities beyond the listed ones. */
  more: number
}

/** The refusal report: one line per parent rule, in a fixed order, a rule without violators as "none". */
export function refusalReport(violations: readonly ParentViolation[]): RefusalLine[] {
  return (['two_parents', 'cycle'] as const).map((rule) => {
    const v = violations.find((x) => x.rule === rule)
    const count = v?.count ?? 0
    const entities = v?.entities ?? []
    const amount = count === 0 ? 'none' : `${count} ${count === 1 ? 'entity' : 'entities'}`
    return { rule, summary: `${RULE_LABELS[rule]} · ${amount}`, entities, more: Math.max(0, count - entities.length) }
  })
}
