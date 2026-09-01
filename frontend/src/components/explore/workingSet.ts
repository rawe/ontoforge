/**
 * Working set model for the Explorer canvas.
 *
 * State is a pair of React Flow node/edge arrays managed by a reducer, so the
 * canvas can stay fully controlled (drag, selection and deletion all flow
 * through `nodesChange`). Nodes wrap entity instances; edges wrap relation
 * instances between on-canvas nodes. Layout stability is the contract: nothing
 * in here ever repositions an existing node — new nodes get positions computed
 * by `placeNodes`, and only the explicit `setPositions` action (re-layout)
 * moves things.
 *
 * Persistence (`of.explore.{lensKey}`) stores the slim shape only:
 * id / typeKey / position / pinned per node. Entities and edges are refetched
 * on restore.
 */

import dagre from 'dagre'
import {
  MarkerType,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import type {
  EntityInstance,
  RelationInstance,
  SchemaRelationType,
} from '@/api/types'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

export const NODE_WIDTH = 216
export const NODE_HEIGHT = 58

/** Soft cap — the node count badge switches to a warning look above this. */
export const WARN_NODES = 150
/** Hard cap — adds beyond this are blocked with a toast. */
export const MAX_NODES = 300

/* ---------------------------------- types ----------------------------------- */

export interface EntityNodeData extends Record<string, unknown> {
  entity: EntityInstance
  /** Display name of the entity type (resolved once at add time). */
  typeName: string
  pinned: boolean
  /** Bumped to re-trigger the "already on canvas" flash animation. */
  flashedAt: number
}

export interface RelationEdgeData extends Record<string, unknown> {
  relation: RelationInstance
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>
export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

export interface WorkingSet {
  nodes: EntityFlowNode[]
  edges: RelationFlowEdge[]
}

export const emptyWorkingSet: WorkingSet = { nodes: [], edges: [] }

export function makeNode(
  entity: EntityInstance,
  typeName: string,
  position: XYPosition,
  pinned = false,
  selected = false,
): EntityFlowNode {
  return {
    id: entity._id,
    type: 'entity',
    position,
    selected,
    data: { entity, typeName, pinned, flashedAt: 0 },
  }
}

export function makeEdge(relation: RelationInstance): RelationFlowEdge {
  return {
    id: relation._id,
    type: 'relation',
    source: relation.fromEntityId,
    target: relation.toEntityId,
    selectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    data: { relation },
  }
}

/* --------------------------------- reducer ----------------------------------- */

export type WorkingSetAction =
  | { type: 'hydrate'; nodes: EntityFlowNode[]; edges: RelationFlowEdge[] }
  | { type: 'nodesChange'; changes: NodeChange<EntityFlowNode>[] }
  | { type: 'edgesChange'; changes: EdgeChange<RelationFlowEdge>[] }
  | {
      type: 'addNodes'
      nodes: { entity: EntityInstance; typeName: string; position: XYPosition }[]
      /** Select the added nodes (deselecting everything else). */
      select?: boolean
    }
  | { type: 'addEdges'; relations: RelationInstance[] }
  | { type: 'flash'; ids: readonly string[] }
  | { type: 'removeNodes'; ids: readonly string[] }
  | { type: 'removeEdge'; id: string }
  | { type: 'setPinned'; ids: readonly string[]; pinned: boolean }
  | { type: 'clear'; mode: 'all' | 'unpinned' }
  | { type: 'setPositions'; positions: Record<string, XYPosition> }

/** Drop edges with a missing endpoint (after node removals). */
function pruneEdges(
  edges: RelationFlowEdge[],
  nodes: EntityFlowNode[],
): RelationFlowEdge[] {
  const ids = new Set(nodes.map((n) => n.id))
  const kept = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  return kept.length === edges.length ? edges : kept
}

export function workingSetReducer(
  state: WorkingSet,
  action: WorkingSetAction,
): WorkingSet {
  switch (action.type) {
    case 'hydrate':
      return { nodes: action.nodes, edges: action.edges }

    case 'nodesChange': {
      const nodes = applyNodeChanges(action.changes, state.nodes)
      const removed = action.changes.some((c) => c.type === 'remove')
      return { nodes, edges: removed ? pruneEdges(state.edges, nodes) : state.edges }
    }

    case 'edgesChange':
      // Edges are not selectable/deletable via React Flow — removal happens
      // only through the explicit `removeEdge` action (after an API delete).
      return state

    case 'addNodes': {
      if (action.nodes.length === 0) return state
      const existing = new Set(state.nodes.map((n) => n.id))
      const fresh = action.nodes
        .filter((n) => !existing.has(n.entity._id))
        .map((n) =>
          makeNode(n.entity, n.typeName, n.position, false, action.select === true),
        )
      if (fresh.length === 0) return state
      const nodes =
        action.select === true
          ? [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...fresh]
          : [...state.nodes, ...fresh]
      return { nodes, edges: state.edges }
    }

    case 'addEdges': {
      const nodeIds = new Set(state.nodes.map((n) => n.id))
      const edgeIds = new Set(state.edges.map((e) => e.id))
      const fresh = action.relations
        .filter(
          (r) =>
            !edgeIds.has(r._id) &&
            nodeIds.has(r.fromEntityId) &&
            nodeIds.has(r.toEntityId),
        )
        .map(makeEdge)
      if (fresh.length === 0) return state
      return { nodes: state.nodes, edges: [...state.edges, ...fresh] }
    }

    case 'flash': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const now = Date.now()
      return {
        nodes: state.nodes.map((n) =>
          ids.has(n.id) ? { ...n, data: { ...n.data, flashedAt: now } } : n,
        ),
        edges: state.edges,
      }
    }

    case 'removeNodes': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const nodes = state.nodes.filter((n) => !ids.has(n.id))
      return { nodes, edges: pruneEdges(state.edges, nodes) }
    }

    case 'removeEdge':
      return {
        nodes: state.nodes,
        edges: state.edges.filter((e) => e.id !== action.id),
      }

    case 'setPinned': {
      const ids = new Set(action.ids)
      return {
        nodes: state.nodes.map((n) =>
          ids.has(n.id) && n.data.pinned !== action.pinned
            ? { ...n, data: { ...n.data, pinned: action.pinned } }
            : n,
        ),
        edges: state.edges,
      }
    }

    case 'clear': {
      if (action.mode === 'all') return emptyWorkingSet
      const nodes = state.nodes.filter((n) => n.data.pinned)
      return { nodes, edges: pruneEdges(state.edges, nodes) }
    }

    case 'setPositions':
      return {
        nodes: state.nodes.map((n) => {
          const position = action.positions[n.id]
          return position !== undefined ? { ...n, position } : n
        }),
        edges: state.edges,
      }
  }
}

/* -------------------------------- persistence -------------------------------- */

export interface PersistedNode {
  id: string
  typeKey: string
  position: XYPosition
  pinned: boolean
}

export function readPersistedNodes(ontologyKey: string, lensKey: string): PersistedNode[] {
  const raw = readJson<unknown>(storageKeys.explore(ontologyKey, lensKey))
  if (raw === null || typeof raw !== 'object') return []
  const nodes = (raw as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return []
  return nodes.filter((n): n is PersistedNode => {
    if (n === null || typeof n !== 'object') return false
    const p = n as PersistedNode
    return (
      typeof p.id === 'string' &&
      typeof p.typeKey === 'string' &&
      p.position !== null &&
      typeof p.position === 'object' &&
      typeof p.position.x === 'number' &&
      typeof p.position.y === 'number' &&
      typeof p.pinned === 'boolean'
    )
  })
}

export function persistWorkingSet(
  ontologyKey: string,
  lensKey: string,
  nodes: readonly EntityFlowNode[],
): void {
  writeJson(storageKeys.explore(ontologyKey, lensKey), {
    nodes: nodes.map(
      (n): PersistedNode => ({
        id: n.id,
        typeKey: n.data.entity._entityTypeKey,
        position: n.position,
        pinned: n.data.pinned,
      }),
    ),
  })
}

/* --------------------------------- placement --------------------------------- */

const GAP_X = 32
const GAP_Y = 26

function collides(p: XYPosition, occupied: readonly XYPosition[]): boolean {
  return occupied.some(
    (o) =>
      Math.abs(o.x - p.x) < NODE_WIDTH + GAP_X &&
      Math.abs(o.y - p.y) < NODE_HEIGHT + GAP_Y,
  )
}

/**
 * Compute positions for `count` new nodes near `near` without touching any
 * existing node: candidates on growing elliptical rings around the anchor,
 * first non-colliding slots win. Deterministic, no layout of existing nodes.
 */
export function placeNodes(
  count: number,
  near: XYPosition,
  occupied: readonly XYPosition[],
): XYPosition[] {
  if (count <= 0) return []
  const taken = [...occupied]
  const out: XYPosition[] = []
  // The anchor itself is the best slot when it is free (e.g. first node
  // on an empty canvas).
  const anchor = { x: Math.round(near.x), y: Math.round(near.y) }
  if (!collides(anchor, taken)) {
    out.push(anchor)
    taken.push(anchor)
  }
  for (let ring = 1; ring <= 40 && out.length < count; ring++) {
    const rx = ring * (NODE_WIDTH + 90)
    const ry = ring * (NODE_HEIGHT + 90)
    const steps = 6 + ring * 6
    for (let i = 0; i < steps && out.length < count; i++) {
      const angle = (i / steps) * Math.PI * 2 + ring * 0.35
      const p = {
        x: Math.round(near.x + Math.cos(angle) * rx),
        y: Math.round(near.y + Math.sin(angle) * ry),
      }
      if (!collides(p, taken)) {
        out.push(p)
        taken.push(p)
      }
    }
  }
  // Extremely dense canvas — stack below the anchor as a last resort.
  let y = near.y + NODE_HEIGHT + GAP_Y
  while (out.length < count) {
    const p = { x: near.x, y }
    if (!collides(p, taken)) {
      out.push(p)
      taken.push(p)
    }
    y += NODE_HEIGHT + GAP_Y
  }
  return out
}

/** Centroid of the current nodes — the default anchor for unanchored adds. */
export function canvasCenter(nodes: readonly EntityFlowNode[]): XYPosition {
  if (nodes.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const n of nodes) {
    x += n.position.x
    y += n.position.y
  }
  return { x: x / nodes.length, y: y / nodes.length }
}

/* -------------------------------- connecting --------------------------------- */

export interface ConnectOption {
  relationType: SchemaRelationType
  from: EntityInstance
  to: EntityInstance
}

/**
 * Relation types valid between two concrete entities, in either direction.
 * A drag A→B offers both `A -rt-> B` and `B -rt-> A` shaped options; for a
 * self-loop (same node) the duplicate direction is collapsed.
 */
export function connectOptions(
  source: EntityInstance,
  target: EntityInstance,
  relationTypes: readonly SchemaRelationType[],
): ConnectOption[] {
  const options: ConnectOption[] = []
  const seen = new Set<string>()
  const push = (
    relationType: SchemaRelationType,
    from: EntityInstance,
    to: EntityInstance,
  ) => {
    const key = `${relationType.key}:${from._id}:${to._id}`
    if (seen.has(key)) return
    seen.add(key)
    options.push({ relationType, from, to })
  }
  for (const rt of relationTypes) {
    if (
      rt.fromEntityTypeKey === source._entityTypeKey &&
      rt.toEntityTypeKey === target._entityTypeKey
    ) {
      push(rt, source, target)
    }
    if (
      rt.fromEntityTypeKey === target._entityTypeKey &&
      rt.toEntityTypeKey === source._entityTypeKey
    ) {
      push(rt, target, source)
    }
  }
  return options
}

/* ---------------------------------- layout ----------------------------------- */

/** Full dagre re-layout — only ever run as an explicit user action. */
export function relayoutPositions(
  nodes: readonly EntityFlowNode[],
  edges: readonly RelationFlowEdge[],
): Record<string, XYPosition> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 130, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const e of edges) {
    if (e.source !== e.target) g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const positions: Record<string, XYPosition> = {}
  for (const n of nodes) {
    const pos = g.node(n.id)
    positions[n.id] = {
      x: pos.x - NODE_WIDTH / 2,
      y: pos.y - NODE_HEIGHT / 2,
    }
  }
  return positions
}
