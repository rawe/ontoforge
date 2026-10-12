/**
 * What the Explorer does with the entities an assistant's answer met:
 * which of them a click or an auto-add puts on the canvas, in which order
 * and next to which node, and which of the answer's relations then
 * become edges. Cards and links only name entities and relations — the
 * canvas reads every one of them itself before showing it.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import type { EntityCard, EntityLink } from '../../api/entities.ts'
import { citations } from '../assistants/entities/entityModel.ts'

/** The evidence cards an answer cites, in order of first citation. */
export function citedCards(reply: string, entities: readonly EntityCard[]): EntityCard[] {
  const cited = new Map<string, EntityCard>()
  for (const segment of citations(reply, entities)) {
    if (segment.kind === 'cite' && !cited.has(segment.card.id)) cited.set(segment.card.id, segment.card)
  }
  return [...cited.values()]
}

/** One entity to add: its placement level and the entities it is placed next to, best first. */
export interface PlannedEntity {
  card: EntityCard
  /** 0 for anchors, carried-over entities and cards without a hop (kinds that do not walk), else the hop. */
  level: number
  /** Entity ids of the cards it is linked to, nearer to the anchors first. */
  anchors: string[]
}

export interface AddPlan {
  /** Not on the canvas yet, in placement order: anchors first, then hop by hop. */
  fresh: PlannedEntity[]
  /** Entity ids already on the canvas: they flash. */
  present: string[]
  /** The fresh entities would pass the hard cap: nothing is added. */
  refused: boolean
}

const levelOf = (card: EntityCard) => (card.role === 'anchor' || card.role === 'focus' ? 0 : card.hop ?? 0)

/**
 * What adding `chosen` would do, given the answer's cards and links, the
 * entity ids on the canvas, how many nodes it has and the hard cap. Each
 * entity is placed next to an entity it is linked to — one nearer to an
 * anchor first, so paths grow outward from where they start.
 */
export function planAdd(
  chosen: readonly EntityCard[],
  answer: { entities: readonly EntityCard[]; links: readonly EntityLink[] },
  onCanvas: ReadonlySet<string>,
  nodeCount: number,
  max: number,
): AddPlan {
  const byRef = new Map(answer.entities.map((card) => [card.ref, card]))
  const order = new Map(answer.entities.map((card, i) => [card.ref, i]))
  const seen = new Set<string>()
  const present: string[] = []
  const fresh: PlannedEntity[] = []
  for (const card of chosen) {
    if (seen.has(card.id)) continue
    seen.add(card.id)
    if (onCanvas.has(card.id)) {
      present.push(card.id)
      continue
    }
    const linked = new Map<string, EntityCard>()
    for (const link of answer.links) {
      const other = link.from === card.ref ? link.to : link.to === card.ref ? link.from : null
      const neighbour = other === null ? undefined : byRef.get(other)
      if (neighbour !== undefined && neighbour.id !== card.id) linked.set(neighbour.id, neighbour)
    }
    const anchors = [...linked.values()]
      .sort((a, b) => levelOf(a) - levelOf(b) || (order.get(a.ref) ?? 0) - (order.get(b.ref) ?? 0))
      .map((neighbour) => neighbour.id)
    fresh.push({ card, level: levelOf(card), anchors })
  }
  fresh.sort((a, b) => a.level - b.level || (order.get(a.card.ref) ?? 0) - (order.get(b.card.ref) ?? 0))
  return { fresh, present, refused: fresh.length > 0 && nodeCount + fresh.length > max }
}

/** A stored relation to read by its type and id. */
export interface RelationRef {
  type: string
  id: string
}

/**
 * The answer's relations to read and draw: those between two entities on
 * the canvas that are not edges yet — with `touching`, only those at that
 * entity. Each once.
 */
export function relationsToFetch(
  answer: { entities: readonly EntityCard[]; links: readonly EntityLink[] },
  onCanvas: ReadonlySet<string>,
  edges: ReadonlySet<string>,
  touching?: string,
): RelationRef[] {
  const idOf = new Map(answer.entities.map((card) => [card.ref, card.id]))
  const out = new Map<string, RelationRef>()
  for (const link of answer.links) {
    if (link.type === undefined || edges.has(link.id) || out.has(link.id)) continue
    const from = idOf.get(link.from)
    const to = idOf.get(link.to)
    if (from === undefined || to === undefined || !onCanvas.has(from) || !onCanvas.has(to)) continue
    if (touching !== undefined && from !== touching && to !== touching) continue
    out.set(link.id, { type: link.type, id: link.id })
  }
  return [...out.values()]
}

/** `fn` over `items`, at most `limit` at a time; each result settled, in order. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
