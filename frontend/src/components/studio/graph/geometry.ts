/**
 * Geometry of the schema graph — pure, unit-tested with `node --test`.
 * Edges float: they leave a node's border on the line between the two node
 * centres, so they re-attach whenever a node moves or changes size. Relation
 * types between the same two entity types curve apart with symmetric
 * offsets, self-relations loop above their node, and labels slide along
 * their edge to stay clear of nodes and of each other.
 */

export interface XY {
  x: number
  y: number
}

/** A node's box in flow coordinates. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Shape of one edge within its group. */
export interface EdgeShape {
  /** Signed perpendicular offset in px (0 = straight line). */
  offset: number
  /** 0-based index among the self-loops of the same node. */
  loopIndex: number
}

export interface EdgeEnds {
  id: string
  source: string
  target: string
}

/** Distance between neighbouring parallel edges. */
export const PARALLEL_STEP = 34

/**
 * Label positions along an edge (curve parameter), tried in order. The outer
 * pair keeps a label readable on a long edge that passes behind a node.
 */
export const LABEL_T = [0.5, 0.36, 0.64, 0.25, 0.75, 0.15, 0.85] as const

/** Label box estimate for the mono 10 px label. */
const LABEL_HEIGHT = 18
const labelWidth = (label: string) => label.length * 6.1 + 12

const centre = (b: Box): XY => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Where the ray from the box centre towards `toward` leaves the box, plus `gap`. */
export function borderPoint(b: Box, toward: XY, gap = 2): XY {
  const c = centre(b)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const t = Math.min(
    dx === 0 ? Infinity : (b.w / 2 + gap) / Math.abs(dx),
    dy === 0 ? Infinity : (b.h / 2 + gap) / Math.abs(dy),
  )
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/** A straight line, or a quadratic curve bulging `offset` px to the side. */
function between(a: Box, b: Box, offset: number, t: number) {
  const ca = centre(a)
  const cb = centre(b)
  if (offset === 0) {
    const s = borderPoint(a, cb)
    const e = borderPoint(b, ca)
    return {
      path: `M ${s.x} ${s.y} L ${e.x} ${e.y}`,
      start: s,
      end: e,
      label: { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t },
    }
  }
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  const len = Math.hypot(dx, dy) || 1
  // The control point sits twice the bulge away from the midpoint.
  const cp = {
    x: (ca.x + cb.x) / 2 + (-dy / len) * offset * 2,
    y: (ca.y + cb.y) / 2 + (dx / len) * offset * 2,
  }
  const s = borderPoint(a, cp)
  const e = borderPoint(b, cp)
  const u = 1 - t
  return {
    path: `M ${s.x} ${s.y} Q ${cp.x} ${cp.y} ${e.x} ${e.y}`,
    start: s,
    end: e,
    label: {
      x: u * u * s.x + 2 * u * t * cp.x + t * t * e.x,
      y: u * u * s.y + 2 * u * t * cp.y + t * t * e.y,
    },
  }
}

/** A loop above the node's top edge; further loops nest outside. The label sits on its apex. */
function selfLoop(b: Box, k: number) {
  const cx = b.x + b.w / 2
  const spread = 22 + k * 14
  const rise = 56 + k * 30
  const s = { x: cx + spread, y: b.y - 1 }
  const e = { x: cx - spread, y: b.y - 2 }
  const c1 = { x: s.x + 44 + k * 10, y: b.y - rise }
  const c2 = { x: e.x - 44 - k * 10, y: b.y - rise }
  return {
    path: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`,
    start: s,
    end: e,
    label: {
      x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * e.x,
      y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * e.y,
    },
  }
}

/**
 * SVG path, its two end points (at the source and the target node) and the
 * label point of an edge; `t` places the label (ignored on loops).
 */
export function edgeGeometry(
  source: Box,
  target: Box,
  self: boolean,
  shape: EdgeShape,
  t = 0.5,
): { path: string; start: XY; end: XY; label: XY } {
  return self ? selfLoop(source, shape.loopIndex) : between(source, target, shape.offset, t)
}

const groupOf = (e: EdgeEnds) =>
  e.source === e.target ? `loop:${e.source}` : [e.source, e.target].sort().join('|')

/**
 * Offsets and loop indices: edges are grouped by their unordered pair of
 * nodes (or by node, for loops). Within a group the offsets are symmetric
 * around 0 in `PARALLEL_STEP`s; the sign is flipped for edges running
 * against the pair's canonical direction, so opposite edges bulge apart.
 */
export function edgeSpecs(edges: readonly EdgeEnds[]): Map<string, EdgeShape> {
  const groups = new Map<string, EdgeEnds[]>()
  for (const e of edges) groups.set(groupOf(e), [...(groups.get(groupOf(e)) ?? []), e])
  const out = new Map<string, EdgeShape>()
  for (const group of groups.values()) {
    group.forEach((e, i) => {
      if (e.source === e.target) {
        out.set(e.id, { offset: 0, loopIndex: i })
      } else {
        const canonical = e.source < e.target ? 1 : -1
        out.set(e.id, { offset: (i - (group.length - 1) / 2) * PARALLEL_STEP * canonical, loopIndex: 0 })
      }
    })
  }
  return out
}

/**
 * Label position (`t`) per edge. Loop labels are fixed on their apex and are
 * placed first, then the shorter edges, which have the fewer free slots.
 * Every other label takes the first `LABEL_T` slot that overlaps no node and
 * no label placed before it; failing that, the first slot clear of nodes (a
 * label behind a node cannot be read or clicked); else the middle.
 */
export function placeLabels(
  edges: readonly (EdgeEnds & EdgeShape & { label: string })[],
  boxes: ReadonlyMap<string, Box>,
): Map<string, number> {
  const nodes: Box[] = [...boxes.values()]
  const taken: Box[] = [...nodes]
  const out = new Map<string, number>()
  const length = (e: EdgeEnds) => {
    const sb = boxes.get(e.source)
    const tb = boxes.get(e.target)
    if (sb === undefined || tb === undefined || e.source === e.target) return 0
    const a = centre(sb)
    const b = centre(tb)
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
  const ordered = [...edges].sort((a, b) => length(a) - length(b))
  for (const e of ordered) {
    const sb = boxes.get(e.source)
    const tb = boxes.get(e.target)
    if (sb === undefined || tb === undefined) continue
    const self = e.source === e.target
    const w = labelWidth(e.label)
    const rectAt = (t: number): Box => {
      const p = edgeGeometry(sb, tb, self, e, t).label
      return { x: p.x - w / 2, y: p.y - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT }
    }
    const clearOf = (among: Box[]) => LABEL_T.find((c) => !among.some((b) => overlaps(rectAt(c), b)))
    const t = self ? 0.5 : (clearOf(taken) ?? clearOf(nodes) ?? 0.5)
    out.set(e.id, t)
    taken.push(rectAt(t))
  }
  return out
}

/**
 * The grid spot nearest `start` where a `w` × `h` box keeps `gap` px from
 * every taken box; `start` itself when nothing is free within 8 steps.
 */
export function freeSpot(start: XY, taken: readonly Box[], w: number, h: number, gap = 20): XY {
  const stepX = w + 2 * gap
  const stepY = h + gap
  const clear = (p: XY) =>
    taken.every(
      (b) => p.x + w + gap <= b.x || b.x + b.w + gap <= p.x || p.y + h + gap <= b.y || b.y + b.h + gap <= p.y,
    )
  const spots: XY[] = []
  for (let dx = -8; dx <= 8; dx++) {
    for (let dy = -8; dy <= 8; dy++) spots.push({ x: dx * stepX, y: dy * stepY })
  }
  spots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
  const spot = spots.map((d) => ({ x: start.x + d.x, y: start.y + d.y })).find(clear)
  return spot ?? start
}
