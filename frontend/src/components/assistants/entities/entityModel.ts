/**
 * Pure helpers of the entity cards every assistant kind streams: grouping
 * by the role a graph walk gave them, and an answer's `[E2]` / `[E2, E5]`
 * citations split into text and card references.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import type { EntityCard } from '@/api/entities'

/* ---------------------------------- roles ---------------------------------- */

/** The roles a kind may send, in the order the card list groups them. */
export const ROLE_ORDER = ['anchor', 'focus', 'result', 'flagged', 'reached'] as const

const ROLES: Record<string, { title: string; hint: string; color: string }> = {
  anchor: { title: 'Anchors', hint: 'Named in the question', color: 'var(--primary)' },
  focus: { title: 'From the previous answer', hint: 'Where this follow-up starts', color: 'var(--tc-amber)' },
  result: { title: 'Results', hint: 'Returned by the query', color: 'var(--tc-emerald)' },
  flagged: { title: 'Flagged', hint: 'Found by a check', color: 'var(--destructive)' },
  reached: { title: 'Reached', hint: 'Found by following relations', color: 'var(--muted-foreground)' },
}

/** A role's group title, its one-line meaning and its color (a CSS value); an unknown role shows as sent, none as "Other". */
export const roleInfo = (role: string) => ROLES[role] ?? { title: role || 'Other', hint: '', color: 'var(--muted-foreground)' }

/**
 * Cards grouped by role: known roles in `ROLE_ORDER`, others after them as
 * they first appear, cards without a role (`''`) last. Null when no card
 * carries a role — the kind does not walk, the list stays flat.
 */
export function groupByRole(entities: readonly EntityCard[]): { role: string; cards: EntityCard[] }[] | null {
  if (!entities.some((card) => card.role !== undefined)) return null
  const groups = new Map<string, EntityCard[]>()
  for (const card of entities) {
    const role = card.role ?? ''
    groups.set(role, [...(groups.get(role) ?? []), card])
  }
  const rank = (role: string) => {
    const i = (ROLE_ORDER as readonly string[]).indexOf(role)
    return role === '' ? ROLE_ORDER.length + 1 : i === -1 ? ROLE_ORDER.length : i
  }
  return [...groups.keys()].sort((a, b) => rank(a) - rank(b)).map((role) => ({ role, cards: groups.get(role)! }))
}

/* -------------------------------- citations -------------------------------- */

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; ref: string; card: EntityCard }

const CITATION = /\[\s*(E\d+(?:\s*,\s*E\d+)*)\s*\]/g

/**
 * The answer text split at its citations: `[E2]` and `[E2, E5]` become one
 * `cite` segment per evidence card. A ref that is not an evidence card of
 * this turn stays text (`[E9]`); a group without any stays as written.
 */
export function citations(text: string, entities: readonly EntityCard[]): Segment[] {
  const evidence = new Map(entities.filter((card) => card.evidence).map((card) => [card.ref, card]))
  const segments: Segment[] = []
  const push = (value: string) => {
    if (value === '') return
    const last = segments.at(-1)
    if (last?.kind === 'text') last.text += value
    else segments.push({ kind: 'text', text: value })
  }
  let at = 0
  for (const match of text.matchAll(CITATION)) {
    const refs = match[1]!.split(',').map((ref) => ref.trim())
    if (!refs.some((ref) => evidence.has(ref))) continue
    push(text.slice(at, match.index))
    for (const ref of refs) {
      const card = evidence.get(ref)
      if (card === undefined) push(`[${ref}]`)
      else segments.push({ kind: 'cite', ref, card })
    }
    at = match.index + match[0].length
  }
  push(text.slice(at))
  return segments
}
