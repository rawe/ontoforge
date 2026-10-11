/**
 * Layout of the schema graph — pure, unit-tested with `node --test`. dagre
 * runs once, on the first open, with estimated node heights, and again only
 * when the user asks for a tidy layout (then with measured sizes). In
 * between, positions are whatever the user set (`graphStore.ts`).
 */

import dagre from 'dagre'
import type { XY } from './geometry.ts'

export type Positions = Record<string, XY>

export const NODE_WIDTH = 232

/** Property rows shown before "+N more". */
export const TRUNCATE_AFTER = 6

/** Height of an entity type node before React Flow has measured it. */
export function estimateHeight(propertyCount: number, collapsed = false): number {
  const header = 49
  if (collapsed) return header + 25
  const rows = Math.max(Math.min(propertyCount, TRUNCATE_AFTER), 1)
  return header + 14 + rows * 19 + (propertyCount > TRUNCATE_AFTER ? 20 : 0)
}

/** Room kept free above a node per self-loop, so the loops and their labels fit. */
const LOOP_ROOM = 30

/**
 * dagre left to right. Self-loops are not laid out as edges; instead each one
 * reserves `LOOP_ROOM` above its node. Returns top-left positions.
 */
export function dagreLayout(
  nodes: readonly { id: string; width: number; height: number }[],
  edges: readonly { source: string; target: string }[],
): Positions {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 160, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  const room = (id: string) => edges.filter((e) => e.source === id && e.target === id).length * LOOP_ROOM
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height + room(n.id) })
  edges.forEach((e, i) => {
    if (e.source !== e.target && g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target, {}, `e${i}`)
    }
  })
  dagre.layout(g)
  const out: Positions = {}
  for (const n of nodes) {
    const p = g.node(n.id)
    const r = room(n.id)
    out[n.id] = { x: Math.round(p.x - n.width / 2), y: Math.round(p.y - (n.height + r) / 2 + r) }
  }
  return out
}
