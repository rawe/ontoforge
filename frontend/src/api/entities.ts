/**
 * The entities an assistant's turn met, as every assistant kind streams
 * them: one shared `entities` event of cards and the stored relations
 * between them. Cards upsert by `ref`, links by `id`; a link's ends are
 * refs of cards of the same turn.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { optional, record, text } from './checks.ts'

/** An entity the turn met, as one card; `ref` (`E1`, `E2`, …) is unique within the turn and what an answer may cite. */
export interface EntityCard {
  ref: string
  id: string
  /** Its readable identity, when its type has one the lens shows. */
  identity?: string
  /** The entity type's key. */
  type: string
  typeName: string
  label: string
  fields: { name: string; value: string }[]
  /** Handed to the answer model — only evidence can be cited. */
  evidence: boolean
  /** Why the entity is here, in plain words; sent by kinds that tell. */
  reason?: string
  /** Where a graph walk met it (`anchor`, `reached`, `focus`); kinds that do not walk send none. */
  role?: string
  /** Distance from the nearest anchor, for kinds that walk. */
  hop?: number
}

/** A stored relation between two cards of the same turn, directed as stored. */
export interface EntityLink {
  /** The stored relation's id; a link's identity. */
  id: string
  /** Refs of cards of this turn. */
  from: string
  to: string
  /** The relation type's key. */
  type: string
  label: string
}

export interface EntitiesEvent {
  type: 'entities'
  entities: EntityCard[]
  links: EntityLink[]
}

const validCard = (c: unknown): c is EntityCard => record(c) &&
  text(c.ref) && c.ref !== '' && text(c.id) && optional(c.identity, text) && text(c.type) && text(c.typeName) && text(c.label) &&
  Array.isArray(c.fields) && c.fields.every((f) => record(f) && text(f.name) && text(f.value)) &&
  typeof c.evidence === 'boolean' && optional(c.reason, text) && optional(c.role, text) &&
  optional(c.hop, (v) => typeof v === 'number' && Number.isFinite(v))

const validLink = (l: unknown): l is EntityLink => record(l) &&
  text(l.id) && text(l.from) && text(l.to) && text(l.type) && text(l.label)

/**
 * An `entities` event checked against the refs this turn has seen, which
 * it adds its cards' refs to. Throws on a malformed one, or a link whose
 * end is no card of this turn.
 */
export function checkEntities(e: Record<string, unknown>, seen: Set<string>): EntitiesEvent {
  if (!Array.isArray(e.entities) || !e.entities.every(validCard) || !Array.isArray(e.links) || !e.links.every(validLink)) {
    throw new Error('Invalid entities event')
  }
  for (const card of e.entities) seen.add(card.ref)
  if (e.links.some((link) => !seen.has(link.from) || !seen.has(link.to))) throw new Error('Invalid entities event')
  return { type: 'entities', entities: e.entities, links: e.links }
}
