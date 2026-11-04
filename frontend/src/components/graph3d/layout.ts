/** Stable, graph-aware positions; independent of the renderer and input ordering. */
export interface Point3D { x: number; y: number; z: number }
interface LayoutNode { id: string }
interface LayoutEdge { source: string; target: string }

export function hashKey(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash >>> 0
}

export function layoutGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Map<string, Point3D> {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  const index = new Map(ordered.map((node, i) => [node.id, i]))
  const links = edges.filter(e => e.source !== e.target && index.has(e.source) && index.has(e.target))
    .map(e => ({ a: index.get(e.source)!, b: index.get(e.target)! }))
    .sort((a, b) => a.a - b.a || a.b - b.b)
  const count = ordered.length
  if (!count) return new Map()
  if (count === 1) return new Map([[ordered[0].id, { x: 0, y: 0, z: 0 }]])
  const size = Math.max(30, Math.cbrt(count) * 24)
  const points = ordered.map((node, i) => {
    const y = 1 - (i + 0.5) / count * 2
    const angle = i * Math.PI * (3 - Math.sqrt(5)) + (hashKey(node.id) % 100) / 700
    const r = Math.sqrt(1 - y * y)
    return { x: Math.cos(angle) * r * size, y: y * size * 0.8, z: Math.sin(angle) * r * size }
  })
  // Keep layout work bounded for large working sets; every node still participates.
  const iterations = count > 600 ? 55 : 115
  const neighbours = count > 600 ? 44 : count - 1
  for (let iteration = 0; iteration < iterations; iteration++) {
    const force = points.map(() => ({ x: 0, y: 0, z: 0 }))
    for (let i = 0; i < count; i++) {
      for (let sample = 0; sample < neighbours; sample++) {
        const j = count > 600 ? (i + 1 + (sample * 7919 + iteration * 37) % (count - 1)) % count : sample >= i ? sample + 1 : sample
        const dx = points[i].x - points[j].x
        const dy = points[i].y - points[j].y
        const dz = points[i].z - points[j].z
        const square = dx * dx + dy * dy + dz * dz + 4
        const strength = Math.min(2.5, 680 / square) / Math.sqrt(square)
        force[i].x += dx * strength
        force[i].y += dy * strength
        force[i].z += dz * strength
      }
    }
    for (const link of links) {
      const a = points[link.a], b = points[link.b]
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const attraction = (length - 29) * 0.018 / length
      force[link.a].x += dx * attraction; force[link.b].x -= dx * attraction
      force[link.a].y += dy * attraction; force[link.b].y -= dy * attraction
      force[link.a].z += dz * attraction; force[link.b].z -= dz * attraction
    }
    const cooling = 1 - iteration / iterations * 0.75
    for (let i = 0; i < count; i++) {
      points[i].x += (force[i].x - points[i].x * 0.004) * cooling
      points[i].y += (force[i].y - points[i].y * 0.004) * cooling
      points[i].z += (force[i].z - points[i].z * 0.004) * cooling
    }
  }
  const centre = points.reduce((sum, p) => ({ x: sum.x + p.x / count, y: sum.y + p.y / count, z: sum.z + p.z / count }), { x: 0, y: 0, z: 0 })
  return new Map(ordered.map((node, i) => [node.id, { x: points[i].x - centre.x, y: points[i].y - centre.y, z: points[i].z - centre.z }]))
}

/** Parallel edges use separate lanes; reversed directions share the same group. */
export function edgeLanes(edges: readonly (LayoutEdge & { id: string })[]): Map<string, number> {
  const groups = new Map<string, { id: string }[]>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target].sort())
    const group = groups.get(key) ?? []
    group.push(edge)
    groups.set(key, group)
  }
  const lanes = new Map<string, number>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id))
    group.forEach((edge, i) => lanes.set(edge.id, i - (group.length - 1) / 2))
  }
  return lanes
}
