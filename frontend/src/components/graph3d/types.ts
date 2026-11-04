/** Renderer input only: all reads, permissions and edits belong to the host surface. */
export interface Graph3DNode {
  id: string
  label: string
  typeKey: string
  subtitle?: string
  description?: string
  properties?: readonly { label: string; value: string }[]
  dimmed?: boolean
  highlighted?: boolean
}

export interface Graph3DEdge {
  id: string
  source: string
  target: string
  label: string
  parent?: boolean
  dimmed?: boolean
  description?: string
  properties?: readonly { label: string; value: string }[]
}

export interface Graph3DProps {
  nodes: readonly Graph3DNode[]
  edges: readonly Graph3DEdge[]
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  onSelectNode: (id: string | null) => void
  onSelectEdge?: (id: string, at: { x: number; y: number }) => void
  onHoverNode?: (id: string | null) => void
  onExit3D: () => void
  title?: string
  /** Host asks to fit the scene without owning the renderer's camera. */
  fitRequest?: number
  /** Repeated selection/reveal from a host outline or search. */
  revealRequest?: number
}
