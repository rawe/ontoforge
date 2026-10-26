/**
 * Pure helpers of an entity type's identity editor: which properties may be
 * part of an identity, an example of its text form, and the report of a
 * refusal by the stored data. No React, no I/O — unit-tested with
 * `node --test`.
 */

import { ApiError } from '../../../api/http.ts'
import type { DataType } from '../../../api/types.ts'

/** The data types an identity property may have. */
export const IDENTITY_DATA_TYPES: readonly DataType[] = ['string', 'integer', 'date']

/** At most this many properties make up an identity. */
export const MAX_IDENTITY_PROPERTIES = 5

/** Whether a property of this data type may be part of an identity. */
export function identityEligible(dataType: DataType): boolean {
  return IDENTITY_DATA_TYPES.includes(dataType)
}

/** An example of the text form: each part a sample of its data type, joined with `~`. */
export function identityExample(properties: readonly { key: string; dataType: DataType }[]): string {
  return properties
    .map((p) => (p.dataType === 'integer' ? '42' : p.dataType === 'date' ? '2024-01-31' : p.key.toUpperCase()))
    .join('~')
}

/** The rules a refused identity reports on the stored entities. */
export type IdentityRule = 'missing_value' | 'duplicate' | 'too_long'

export interface IdentityViolation {
  rule: IdentityRule
  count: number
  /** The first five entities that break the rule. */
  entities: { type: string; id: string }[]
}

const RULES: readonly IdentityRule[] = ['missing_value', 'duplicate', 'too_long']

/** The stored-data conflicts of a refused identity (a 409 with `details.violations`); null for any other error. */
export function identityViolationsOf(error: unknown): IdentityViolation[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const violations = error.details?.violations
  if (!Array.isArray(violations)) return null
  const found = (violations as IdentityViolation[]).filter((v) => RULES.includes(v.rule))
  return found.length === 0 ? null : found
}

const RULE_LABELS: Record<IdentityRule, string> = {
  missing_value: 'Without a value (or with an empty one)',
  duplicate: 'Sharing an identity',
  too_long: 'Identity longer than 512 characters',
}

export interface IdentityLine {
  rule: IdentityRule
  /** "Sharing an identity · 2 entities". */
  summary: string
  entities: IdentityViolation['entities']
  /** Breaking entities beyond the listed ones. */
  more: number
}

/** One line per rule the stored data breaks, in a fixed order. */
export function identityReport(violations: readonly IdentityViolation[]): IdentityLine[] {
  return RULES.flatMap((rule) => {
    const v = violations.find((x) => x.rule === rule)
    if (v === undefined || v.count === 0) return []
    const amount = `${v.count} ${v.count === 1 ? 'entity' : 'entities'}`
    return [{ rule, summary: `${RULE_LABELS[rule]} · ${amount}`, entities: v.entities, more: Math.max(0, v.count - v.entities.length) }]
  })
}

/** The cascade an identity needs, in words for the cascade dialog. */
export const IDENTITY_CASCADE_NOTE =
  'The identity properties become required and lose their defaults, and every lens that lists ' +
  'properties of this type is given all of them.'
