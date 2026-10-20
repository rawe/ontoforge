/**
 * The schema graph: one node per entity type, one edge per relation type.
 * React Flow is controlled. Node positions are computed once (dagre on the
 * first open, the gesture point for a type created here, a free spot near
 * the viewport centre for one created elsewhere), then only the user moves
 * them; schema edits merge into the nodes by id and never re-lay out.
 * Selection comes from the address: a click here selects without moving the
 * view (beyond keeping the selected node visible when the canvas narrows), a
 * selection made anywhere else is revealed. Types are created here by
 * double-click, `N` or the toolbar; relation types by dragging a node's "+"
 * onto a node, itself or empty canvas. A naming popover asks for the names.
 * The outline search rings matching nodes and dims the rest; focus mode (`F`)
 * keeps the selection and its one-hop neighbours and dims everything else.
 * The Hierarchy toggle dims the same way, keeping the parent relations and
 * the types they join; neither moves a node.
 * Nodes carry their lint issue count.
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getViewportForBounds,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronsDownUp, ChevronsUpDown, Crosshair, LayoutGrid, Maximize, Network, Plus } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPlainKey, isTyping, overlayOpen } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { useRequestDelete } from '../modeling/deleteContext'
import { useCreateEntityType, useCreateRelationType } from '../modeling/mutations'
import { searchSchema } from '../modeling/search'
import { useIssues } from '../modeling/useIssues'
import { useModelSchema, type ModelSchema } from '../modeling/useModelSchema'
import { focusSet, hierarchySet } from '../schema/focus'
import type { SchemaSelection } from '../schema/schemaUrl'
import { useSchemaWorkspace, type SelectOptions } from '../schema/workspaceContext'
import {
  CreatePopover,
  COMBINED_POPOVER_HEIGHT,
  POPOVER_HEIGHT,
  type PopoverAnchor,
  type PopoverState,
  type PopoverValues,
  type SubmitError,
} from './CreatePopover'
import {
  EntityTypeNode,
  GHOST_HEIGHT,
  GhostNode,
  type EntityFlowNode,
  type GhostFlowNode,
} from './EntityTypeNode'
import { edgeSpecs, freeSpot, placeLabels, type Box, type XY } from './geometry'
import {
  allCollapsedOf,
  keepView,
  keptView,
  loadPositions,
  savePositions,
  toggleAllCollapsed,
  toggleCollapsed,
  useCollapsed,
  type Collapsed,
} from './graphStore'
import { dagreLayout, estimateHeight, NODE_WIDTH, type Positions } from './layout'
import { EDGE_COLOR, PARENT_COLOR, RelationTypeEdge, type RelationFlowEdge } from './RelationTypeEdge'

const nodeTypes = { entityType: EntityTypeNode, ghost: GhostNode }
const edgeTypes = { relation: RelationTypeEdge }
const GHOST_ID = '__ghost'
const PENDING_EDGE_ID = '__pending'
const CONNECTION_LINE_STYLE = { stroke: 'var(--primary)', strokeWidth: 1.5, strokeDasharray: '5 4' }
const MIN_ZOOM = 0.2
/** How far from the canvas edge a node kept in view stays (pixels). */
const IN_VIEW_MARGIN = 16

type AppNode = EntityFlowNode | GhostFlowNode

/** A type created by a gesture here, to be placed at the gesture point. */
interface Placement {
  key: string
  at: XY
}

/** How far to move the span [lo, hi] into [margin, size - margin]; its start wins when it does not fit. */
const shiftInto = (lo: number, hi: number, size: number) =>
  lo < IN_VIEW_MARGIN
    ? IN_VIEW_MARGIN - lo
    : hi > size - IN_VIEW_MARGIN
      ? Math.max(size - IN_VIEW_MARGIN - hi, IN_VIEW_MARGIN - lo)
      : 0

const sameSelection = (a: SchemaSelection | null, b: SchemaSelection | null) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.key === b.key)

export function SchemaCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}

/**
 * The nodes for the current entity types: existing nodes keep their position
 * (and React Flow's measurements), stored positions are restored, a type
 * created by a gesture here goes to its gesture point, and the rest is
 * placed — dagre for everything when nothing is placed yet, else the free
 * spot nearest the viewport centre.
 */
function syncNodes(
  prev: Node[],
  schema: ModelSchema,
  stored: Positions,
  collapsed: Collapsed,
  placement: Placement | null,
  viewportCentre: () => XY,
): Node[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const placed: Positions = {}
  for (const t of schema.entityTypes) {
    const p =
      prevById.get(t.entityTypeId)?.position ??
      stored[t.entityTypeId] ??
      (placement?.key === t.key ? placement.at : undefined)
    if (p !== undefined) placed[t.entityTypeId] = p
  }
  const missing = schema.entityTypes.filter((t) => placed[t.entityTypeId] === undefined)
  const height = (id: string) =>
    prevById.get(id)?.measured?.height ??
    estimateHeight(schema.properties[id]?.length ?? 1, collapsed[id] === true)

  if (missing.length > 0 && missing.length === schema.entityTypes.length) {
    const idOf = new Map(schema.entityTypes.map((t) => [t.key, t.entityTypeId]))
    Object.assign(
      placed,
      dagreLayout(
        schema.entityTypes.map((t) => ({ id: t.entityTypeId, width: NODE_WIDTH, height: height(t.entityTypeId) })),
        schema.relationTypes.map((r) => ({
          source: idOf.get(r.sourceEntityTypeKey) ?? '',
          target: idOf.get(r.targetEntityTypeKey) ?? '',
        })),
      ),
    )
  } else if (missing.length > 0) {
    const centre = viewportCentre()
    const taken: Box[] = Object.entries(placed).map(([id, p]) => ({
      ...p,
      w: prevById.get(id)?.measured?.width ?? NODE_WIDTH,
      h: height(id),
    }))
    for (const t of missing) {
      const h = height(t.entityTypeId)
      const spot = freeSpot({ x: centre.x - NODE_WIDTH / 2, y: centre.y - h / 2 }, taken, NODE_WIDTH, h)
      placed[t.entityTypeId] = spot
      taken.push({ ...spot, w: NODE_WIDTH, h })
    }
  }

  const next = schema.entityTypes.map(
    (t): Node => prevById.get(t.entityTypeId) ?? { id: t.entityTypeId, position: placed[t.entityTypeId]!, data: {} },
  )
  return next.length === prev.length && next.every((n, i) => n === prev[i]) ? prev : next
}

const isMoveOrResize = (c: NodeChange<AppNode>): c is NodePositionChange | NodeDimensionChange =>
  c.type === 'position' || c.type === 'dimensions'

function Canvas() {
  const {
    ontologyKey,
    selection,
    select,
    revealRequest,
    focusMode,
    toggleFocus,
    exitFocus,
    search,
    tidyRequest,
  } = useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const { countByType } = useIssues(ontologyKey)
  const requestDelete = useRequestDelete()
  const { create: createEntityType } = useCreateEntityType(ontologyKey)
  const { create: createRelationType } = useCreateRelationType(ontologyKey)
  const collapsed = useCollapsed(ontologyKey)
  const { resolvedTheme } = useTheme()
  const { fitView, setViewport, getZoom, getInternalNode, getNodesBounds, getViewport, screenToFlowPosition } =
    useReactFlow()
  const storeApi = useStoreApi()
  const paneWidth = useStore((s) => s.width)
  const paneHeight = useStore((s) => s.height)
  const paneReady = paneWidth > 0 && paneHeight > 0
  const connecting = useStore((s) => s.connection.inProgress)
  const nodesInitialized = useNodesInitialized()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [stored] = useState(() => loadPositions(ontologyKey))
  const [keptAtMount] = useState(() => keptView(ontologyKey))
  const [nodes, setNodes] = useState<Node[]>([])
  const [relayout, setRelayout] = useState(false)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  // Kept after the create: the type may reach the cache before or after the request resolves.
  const [placement, setPlacement] = useState<Placement | null>(null)

  const { entityTypes, relationTypes, properties } = schema
  const entityIds = useMemo(() => entityTypes.map((t) => t.entityTypeId), [entityTypes])
  const idOfKey = useMemo(() => new Map(entityTypes.map((t) => [t.key, t.entityTypeId])), [entityTypes])
  const selectedEntityId =
    selection?.kind === 'entity-types' ? (idOfKey.get(selection.key) ?? null) : null

  // The outline search and focus mode both dim what they leave out.
  const matches = useMemo(
    () => searchSchema({ entityTypes, relationTypes, properties }, search),
    [entityTypes, relationTypes, properties, search],
  )
  const focus = useMemo(
    () => (focusMode ? focusSet({ entityTypes, relationTypes }, selection) : null),
    [focusMode, entityTypes, relationTypes, selection],
  )
  const [hierarchyMode, setHierarchyMode] = useState(false)
  const hierarchy = useMemo(
    () => (hierarchyMode ? hierarchySet({ entityTypes, relationTypes }) : null),
    [hierarchyMode, entityTypes, relationTypes],
  )

  // Merge the schema into the nodes whenever the entity types change. The
  // first time waits for the property lists (dagre needs node heights) and
  // for the pane's size (free spots need the viewport centre).
  const [syncedTypes, setSyncedTypes] = useState<ModelSchema['entityTypes'] | null>(null)
  const ready = syncedTypes !== null || (schema.propertiesLoaded && paneReady)
  if (ready && !schema.isPending && syncedTypes !== entityTypes) {
    setSyncedTypes(entityTypes)
    setNodes((prev) =>
      syncNodes(prev, schema, stored, collapsed, placement, () => {
        const { width, height, transform } = storeApi.getState()
        const [tx, ty, zoom] = transform
        return { x: (width / 2 - tx) / zoom, y: (height / 2 - ty) / zoom }
      }),
    )
  }

  // Positions are stored whenever they settle: first layout, placement, drag end, tidy.
  useEffect(() => {
    if (syncedTypes === null || nodes.some((n) => n.dragging === true)) return
    savePositions(ontologyKey, Object.fromEntries(nodes.map((n) => [n.id, n.position])), entityIds)
  }, [nodes, syncedTypes, ontologyKey, entityIds])

  /* ------------------------------ selection ------------------------------ */

  // A selection made on the canvas is remembered, so it is not revealed.
  const ownSelection = useRef<SchemaSelection | null>(null)
  const selectHere = useCallback(
    (next: SchemaSelection | null, options?: SelectOptions) => {
      ownSelection.current = next
      select(next, options)
    },
    [select],
  )

  /* ------------------------------- viewport ------------------------------- */

  // The canvas's size now. React Flow learns a new size (the inspector opened
  // with the selection) only a frame later, so moves for a selection use this.
  const paneSize = useCallback(
    () => ({ width: wrapperRef.current?.clientWidth ?? 0, height: wrapperRef.current?.clientHeight ?? 0 }),
    [],
  )

  // An animated move is remembered until it ends: a move computed meanwhile
  // starts from where it is going, not from where it is.
  const moving = useRef<{ to: Viewport; until: number } | null>(null)
  const moveTo = useCallback(
    (to: Viewport, duration: number, interpolate?: 'linear') => {
      moving.current = { to, until: performance.now() + duration }
      void setViewport(to, { duration, interpolate })
    },
    [setViewport],
  )

  const fitNodes = useCallback(
    (ids: string[], maxZoom: number) => {
      const { width, height } = paneSize()
      if (ids.length === 0 || width === 0) return
      moveTo(getViewportForBounds(getNodesBounds(ids), width, height, MIN_ZOOM, maxZoom, 0.15), 400)
    },
    [paneSize, moveTo, getNodesBounds],
  )

  const reveal = useCallback(
    (sel: SchemaSelection) => {
      if (sel.kind === 'entity-types') {
        const id = idOfKey.get(sel.key)
        const n = id === undefined ? undefined : getInternalNode(id)
        const { width, height } = paneSize()
        if (n === undefined || width === 0) return
        const x = n.internals.positionAbsolute.x + (n.measured.width ?? NODE_WIDTH) / 2
        const y = n.internals.positionAbsolute.y + (n.measured.height ?? 80) / 2
        const zoom = Math.max(getZoom(), 0.9)
        moveTo({ x: width / 2 - x * zoom, y: height / 2 - y * zoom, zoom }, 400)
      } else {
        const r = relationTypes.find((t) => t.key === sel.key)
        const ends = [r?.sourceEntityTypeKey, r?.targetEntityTypeKey].flatMap((key) => {
          const id = key === undefined ? undefined : idOfKey.get(key)
          return id === undefined ? [] : [id]
        })
        fitNodes(ends, 1.1)
      }
    },
    [idOfKey, relationTypes, getInternalNode, getZoom, paneSize, moveTo, fitNodes],
  )

  const fitFocus = useCallback((ids: Iterable<string>) => fitNodes([...ids], 1.2), [fitNodes])

  // The selected node stays in view when the canvas changes size (the
  // inspector opens, the sidebar expands) and after a type is created here:
  // the view pans just enough, and not at all when the node is fully visible.
  // `keepInView` holds the type's key until it is selected and measured.
  const keepInView = useRef<string | null>(null)
  const lastPaneSize = useRef({ width: 0, height: 0 })
  const onPaneResize = useEffectEvent(() => {
    if (selection?.kind === 'entity-types') keepInView.current = selection.key
  })

  const panIntoView = useEffectEvent(() => {
    const key = keepInView.current
    if (key === null || selection?.kind !== 'entity-types' || selection.key !== key) return
    const id = idOfKey.get(key)
    const n = id === undefined ? undefined : getInternalNode(id)
    const { width, height } = paneSize()
    if (n?.measured.width === undefined || n.measured.height === undefined || width === 0) return
    keepInView.current = null
    const m = moving.current
    const v = m !== null && performance.now() < m.until ? m.to : getViewport()
    const left = n.internals.positionAbsolute.x * v.zoom + v.x
    const top = n.internals.positionAbsolute.y * v.zoom + v.y
    const dx = shiftInto(left, left + n.measured.width * v.zoom, width)
    const dy = shiftInto(top, top + n.measured.height * v.zoom, height)
    // Linear, so a short pan does not zoom out on the way.
    if (dx !== 0 || dy !== 0) moveTo({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, 200, 'linear')
  })
  // After every commit: the selection and the node's measurements arrive in their own time.
  useEffect(() => panIntoView())
  useEffect(() => {
    const was = lastPaneSize.current
    lastPaneSize.current = { width: paneWidth, height: paneHeight }
    if (was.width === 0 || was.height === 0) return
    // Once the size has settled: the sidebar's width transition resizes the
    // canvas on every frame, and one pan at the end does not jitter.
    const settled = setTimeout(() => {
      onPaneResize()
      panIntoView()
    }, 100)
    return () => clearTimeout(settled)
  }, [paneWidth, paneHeight])

  // Reveal every selection that did not come from a click here: outline,
  // palette, address, back/forward, or a different one when coming back from
  // Classic. A reveal request (outline) also reveals an unchanged selection.
  // In focus mode the focus set is framed instead (the effect below follows
  // a changed selection).
  const seenSelection = useRef(keptAtMount?.selection ?? null)
  const seenReveal = useRef(revealRequest?.nonce ?? 0)
  useEffect(() => {
    if (!nodesInitialized) return
    // A request waits until the address names its selection (a navigation, a
    // moment later), so the reveal sees the canvas beside the inspector it opens.
    const requested =
      revealRequest !== null &&
      revealRequest.nonce !== seenReveal.current &&
      sameSelection(revealRequest.selection, selection)
        ? revealRequest.selection
        : null
    const changed = !sameSelection(selection, seenSelection.current)
    if (requested === null && !changed) return
    if (requested !== null && revealRequest !== null) seenReveal.current = revealRequest.nonce
    let own = false
    if (changed) {
      own = sameSelection(selection, ownSelection.current)
      seenSelection.current = selection
      ownSelection.current = null
    }
    if (focus !== null) {
      if (requested !== null) fitFocus(focus)
    } else {
      const target = requested ?? (own ? null : selection)
      if (target !== null) reveal(target)
    }
  }, [selection, revealRequest, nodesInitialized, focus, reveal, fitFocus])

  // Frame the focus set when focus mode turns on or follows another selection.
  const focusKey = focus === null ? '' : [...focus].sort().join(',')
  useEffect(() => {
    if (focusKey !== '' && nodesInitialized) fitFocus(focusKey.split(','))
  }, [focusKey, nodesInitialized, fitFocus])

  // Fit once, after the first nodes are measured — unless restoring a kept view or revealing.
  const fitted = useRef(false)
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return
    fitted.current = true
    if (keptAtMount === null && selection === null) void fitView({ padding: 0.25 })
  }, [nodesInitialized, keptAtMount, selection, fitView])

  // Keep the viewport (and the selection it shows) for the next visit of this ontology's graph.
  const latestSelection = useRef(selection)
  useEffect(() => {
    latestSelection.current = selection
  }, [selection])
  useEffect(
    () => () => keepView(ontologyKey, { viewport: getViewport(), selection: latestSelection.current }),
    [ontologyKey, getViewport],
  )

  /* ------------------------------ nodes, edges ------------------------------ */

  // Where the type being named will appear. One object per popover, so React
  // Flow keeps its measurements (it is not part of `nodes`).
  const ghostAt = popover !== null && popover.mode !== 'relation' ? popover.ghost : null
  const ghost = useMemo<GhostFlowNode | null>(
    () =>
      ghostAt === null
        ? null
        : { id: GHOST_ID, type: 'ghost', position: ghostAt, data: {}, selectable: false, draggable: false },
    [ghostAt],
  )

  const entityNodes = useMemo(
    () =>
      nodes.flatMap((n): EntityFlowNode[] => {
        const et = entityTypes.find((t) => t.entityTypeId === n.id)
        if (et === undefined) return []
        return [
          {
            ...n,
            type: 'entityType',
            selected: n.id === selectedEntityId,
            data: {
              entityType: et,
              properties: properties[n.id],
              collapsed: collapsed[n.id] === true,
              onToggleCollapsed: () => toggleCollapsed(ontologyKey, n.id),
              onSelectProperty: (propertyKey) =>
                selectHere({ kind: 'entity-types', key: et.key }, { propertyKey }),
              dim:
                (focus !== null && !focus.has(n.id)) ||
                (hierarchy !== null && !hierarchy.has(n.id)) ||
                (matches.active && !matches.entityIds.has(n.id)),
              match: matches.active && matches.entityIds.has(n.id),
              issues: countByType.get(n.id) ?? 0,
            },
          },
        ]
      }),
    [nodes, entityTypes, properties, collapsed, selectedEntityId, ontologyKey, selectHere, focus, hierarchy, matches, countByType],
  )
  const flowNodes = useMemo<AppNode[]>(
    () => (ghost === null ? entityNodes : [...entityNodes, ghost]),
    [entityNodes, ghost],
  )

  const edges = useMemo<RelationFlowEdge[]>(() => {
    const boxes = new Map<string, Box>(
      nodes.map((n) => [
        n.id,
        { ...n.position, w: n.measured?.width ?? NODE_WIDTH, h: n.measured?.height ?? 80 },
      ]),
    )
    if (ghost !== null) boxes.set(GHOST_ID, { ...ghost.position, w: NODE_WIDTH, h: GHOST_HEIGHT })
    const ends = relationTypes.flatMap((r) => {
      const source = idOfKey.get(r.sourceEntityTypeKey)
      const target = idOfKey.get(r.targetEntityTypeKey)
      if (source === undefined || target === undefined || !boxes.has(source) || !boxes.has(target)) return []
      return [{ id: r.relationTypeId, source, target, label: r.key, parent: r.parent }]
    })
    // The relation type being named, dashed, to its target or the ghost.
    if (popover !== null && popover.mode !== 'entity' && boxes.has(popover.sourceId)) {
      const target = popover.mode === 'relation' ? popover.targetId : GHOST_ID
      if (boxes.has(target)) ends.push({ id: PENDING_EDGE_ID, source: popover.sourceId, target, label: '…', parent: null })
    }
    const shapes = edgeSpecs(ends)
    const shaped = ends.map((e) => ({ ...e, ...shapes.get(e.id)! }))
    const labelT = placeLabels(shaped, boxes)
    return shaped.map((e) => {
      const pending = e.id === PENDING_EDGE_ID
      const isSelected = !pending && selection?.kind === 'relation-types' && selection.key === e.label
      // Dimmed unless both endpoints are in focus, (Hierarchy) unless a parent relation,
      // and (searching) unless it or both endpoints match.
      const match = !pending && matches.active && matches.relationIds.has(e.id)
      const dim =
        !pending &&
        ((focus !== null && !(focus.has(e.source) && focus.has(e.target))) ||
          (hierarchy !== null && e.parent === null) ||
          (matches.active && !match && !(matches.entityIds.has(e.source) && matches.entityIds.has(e.target))))
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'relation' as const,
        selected: isSelected,
        selectable: !pending,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color:
            isSelected || pending
              ? 'var(--primary)'
              : match
                ? 'var(--tc-amber)'
                : e.parent !== null
                  ? PARENT_COLOR
                  : EDGE_COLOR,
        },
        data: {
          label: e.label,
          offset: e.offset,
          loopIndex: e.loopIndex,
          labelT: labelT.get(e.id) ?? 0.5,
          pending,
          dim,
          match,
          parent: e.parent,
          onSelect: pending ? undefined : () => selectHere({ kind: 'relation-types', key: e.label }),
        },
      }
    })
  }, [nodes, ghost, popover, relationTypes, idOfKey, selection, selectHere, focus, hierarchy, matches])

  /* -------------------------------- actions -------------------------------- */

  const tidy = () => {
    const positions = dagreLayout(
      nodes.map((n) => ({
        id: n.id,
        width: n.measured?.width ?? NODE_WIDTH,
        height: n.measured?.height ?? 80,
      })),
      edges.filter((e) => e.data?.pending !== true),
    )
    setRelayout(true)
    setNodes((nds) => nds.map((n) => ({ ...n, position: positions[n.id] ?? n.position })))
    window.setTimeout(() => {
      setRelayout(false)
      void fitView({ padding: 0.25, duration: 300 })
    }, 420)
  }

  // The palette's "Tidy layout"; a request made before this mount is not repeated.
  const seenTidy = useRef(tidyRequest)
  const onTidyRequest = useEffectEvent(tidy)
  useEffect(() => {
    if (tidyRequest === seenTidy.current) return
    seenTidy.current = tidyRequest
    onTidyRequest()
  }, [tidyRequest])

  const allCollapsed = allCollapsedOf(collapsed, entityIds)

  /* ----------------------------- create gestures ----------------------------- */

  // Where the popover for a gesture at `client` (pixels) goes. A ghost is
  // centred on the point, with the popover below it, or above it when there
  // is no room below; after a drop on a node the popover sits at the pointer.
  // The popover clamps itself into the canvas.
  const placePopover = useCallback(
    (client: XY, mode: PopoverState['mode']) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (rect === undefined) return null
      const flow = screenToFlowPosition(client)
      const ghost = { x: flow.x - NODE_WIDTH / 2, y: flow.y - GHOST_HEIGHT / 2 }
      const zoom = getZoom()
      const x = client.x - rect.left
      const y = client.y - rect.top
      const half = mode === 'relation' ? 0 : (GHOST_HEIGHT / 2) * zoom
      const height = mode === 'entity+relation' ? COMBINED_POPOVER_HEIGHT : POPOVER_HEIGHT
      const left = mode === 'relation' ? x + 8 : x - (NODE_WIDTH / 2) * zoom
      const top = y + half + 8
      const at: PopoverAnchor =
        top + height + 8 <= rect.height || y - half - 8 - height < 8
          ? { left, top }
          : { left, bottom: rect.height - (y - half - 8) }
      return { at, ghost }
    },
    [screenToFlowPosition, getZoom],
  )

  const newEntityAt = useCallback(
    (client: XY) => {
      const place = placePopover(client, 'entity')
      if (place !== null) setPopover({ mode: 'entity', ...place })
    },
    [placePopover],
  )

  const newEntityAtCentre = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect !== undefined) newEntityAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [newEntityAt])

  const typeById = (id: string) => entityTypes.find((t) => t.entityTypeId === id)

  // Entity type first (placed at the ghost), then the relation type. When the
  // relation fails after a new type was created, the popover stays, in
  // relation mode against that type, with the typed name and the error.
  const submitPopover = async (values: PopoverValues): Promise<SubmitError | null> => {
    if (popover === null) return null
    const state = popover
    const source = state.mode === 'entity' ? undefined : typeById(state.sourceId)
    let target = state.mode === 'relation' ? typeById(state.targetId) : undefined

    if (state.mode !== 'relation' && values.entity !== undefined) {
      setPlacement({ key: values.entity.key, at: state.ghost })
      fitted.current = true // the first type of an empty graph must not trigger the initial fit
      try {
        target = await createEntityType({ key: values.entity.key, displayName: values.entity.name.trim() })
      } catch (error) {
        return { part: 'entity', error }
      }
      if (state.mode === 'entity') {
        setPopover(null)
        keepInView.current = target.key
        selectHere({ kind: 'entity-types', key: target.key })
        return null
      }
    }

    if (values.relation === undefined || source === undefined || target === undefined) return null
    try {
      const created = await createRelationType({
        key: values.relation.key,
        displayName: values.relation.name.trim(),
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key,
      })
      setPopover(null)
      selectHere({ kind: 'relation-types', key: created.key })
      return null
    } catch (error) {
      if (state.mode !== 'entity+relation') return { part: 'relation', error }
      setPopover({
        mode: 'relation',
        at: state.at,
        sourceId: state.sourceId,
        targetId: target.entityTypeId,
        initial: values.relation,
        failure: { part: 'relation', error },
      })
      return null
    }
  }

  // Esc during a connection drag ends it here, and its end event is ignored.
  const dragCancelled = useRef(false)

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (dragCancelled.current) {
        dragCancelled.current = false
        return
      }
      const sourceId = state.fromNode?.id
      if (sourceId === undefined || sourceId === GHOST_ID) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      if (point === undefined) return
      const client = { x: point.clientX, y: point.clientY }
      if (state.isValid === true && state.toNode !== null && state.toNode.id !== GHOST_ID) {
        const place = placePopover(client, 'relation')
        if (place !== null) setPopover({ mode: 'relation', at: place.at, sourceId, targetId: state.toNode.id })
      } else if ((event.target as Element | null)?.classList.contains('react-flow__pane') === true) {
        const place = placePopover(client, 'entity+relation')
        if (place !== null) setPopover({ mode: 'entity+relation', ...place, sourceId })
      }
    },
    [placePopover],
  )

  // The selected type's id, for the delete dialog.
  const selectedId =
    selection?.kind === 'relation-types'
      ? (relationTypes.find((r) => r.key === selection.key)?.relationTypeId ?? null)
      : selectedEntityId

  // H hides or shows the properties of every node, ⇧H only of the selected
  // one. N names a new entity type at the viewport centre. F toggles focus
  // mode. Del / Backspace deletes the selected type (with the dialog's
  // preview). Esc cancels a connection drag, else closes the popover, else
  // exits focus mode, else clears the selection (the popover's own fields
  // handle Esc themselves). An effect event, so the listener always sees the
  // latest render, never the one before it.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && connecting) {
      // React Flow ends the drag on mouseup; its end event is then ignored.
      e.preventDefault()
      dragCancelled.current = true
      document.dispatchEvent(new MouseEvent('mouseup'))
      return
    }
    if (e.repeat || !isPlainKey(e)) return
    if (e.defaultPrevented || isTyping(e) || overlayOpen(e)) return
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault()
      if (!e.shiftKey) toggleAllCollapsed(ontologyKey, entityIds)
      else if (selectedEntityId !== null) toggleCollapsed(ontologyKey, selectedEntityId)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection !== null && selectedId !== null) {
      e.preventDefault()
      requestDelete({ what: 'type', kind: selection.kind, id: selectedId })
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      newEntityAtCentre()
    } else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
      e.preventDefault()
      toggleFocus()
    } else if (e.key === 'Escape' && popover !== null) {
      e.preventDefault()
      setPopover(null)
    } else if (e.key === 'Escape' && focusMode) {
      e.preventDefault()
      exitFocus()
    } else if (e.key === 'Escape' && selection !== null) {
      e.preventDefault()
      selectHere(null)
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const focusLabel = () => {
    if (focus === null || selection === null) return 'Focus — select a type'
    if (selection.kind === 'relation-types') {
      const r = relationTypes.find((t) => t.key === selection.key)
      return `Focus: ${selection.key} (${r?.sourceEntityTypeKey} → ${r?.targetEntityTypeKey})`
    }
    const name = entityTypes.find((t) => t.key === selection.key)?.displayName ?? selection.key
    const n = focus.size - 1
    return `Focus: ${name} + ${n} ${n === 1 ? 'neighbour' : 'neighbours'}`
  }

  /* -------------------------------- render -------------------------------- */

  const popoverSource = popover !== null && popover.mode !== 'entity' ? typeById(popover.sourceId) : undefined
  const popoverTarget = popover?.mode === 'relation' ? typeById(popover.targetId) : undefined

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden"
      onDoubleClick={(e) => {
        if ((e.target as Element).classList.contains('react-flow__pane')) newEntityAt({ x: e.clientX, y: e.clientY })
      }}
    >
      <ReactFlow<AppNode, RelationFlowEdge>
        className={cn(relayout && 'of-relayout')}
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes.filter(isMoveOrResize), nds))}
        onNodeClick={(_, node) =>
          node.type === 'entityType' && selectHere({ kind: 'entity-types', key: node.data.entityType.key })
        }
        onEdgeClick={(_, edge) => edge.data?.onSelect?.()}
        onPaneClick={() => {
          setPopover(null)
          selectHere(null)
        }}
        onConnectStart={() => setPopover(null)}
        onConnectEnd={onConnectEnd}
        connectOnClick={false}
        connectionLineType={ConnectionLineType.Straight}
        connectionLineStyle={CONNECTION_LINE_STYLE}
        zoomOnDoubleClick={false}
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={MIN_ZOOM}
        maxZoom={2}
        defaultViewport={keptAtMount?.viewport}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        style={{ background: 'transparent' }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {!schema.isPending && entityTypes.length === 0 && popover === null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-xl border bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm">
            Double-click or press <Kbd>N</Kbd> to create the first entity type
          </p>
        </div>
      )}

      <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 rounded-xl border bg-card/95 p-1 shadow-md backdrop-blur-sm">
        <ToolButton label="New entity type (N)" text onClick={newEntityAtCentre}>
          <Plus /> Entity type
        </ToolButton>
        <Separator orientation="vertical" className="mx-0.5 h-5!" />
        <ToolButton label="Tidy layout" onClick={tidy}>
          <LayoutGrid />
        </ToolButton>
        <ToolButton label="Fit view" onClick={() => void fitView({ padding: 0.25, duration: 300 })}>
          <Maximize />
        </ToolButton>
        <ToolButton
          label={allCollapsed ? 'Show all properties (H)' : 'Hide all properties (H)'}
          onClick={() => toggleAllCollapsed(ontologyKey, entityIds)}
        >
          {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
        </ToolButton>
        <ToolButton
          label={focusMode ? 'Exit focus (F)' : 'Focus on selection (F)'}
          active={focusMode}
          onClick={toggleFocus}
        >
          <Crosshair />
        </ToolButton>
        <ToolButton
          label={hierarchyMode ? 'Show every relation type' : 'Dim everything but the parent relations'}
          text
          active={hierarchyMode}
          onClick={() => setHierarchyMode((on) => !on)}
        >
          <Network /> Hierarchy
        </ToolButton>
      </div>

      {focusMode ? (
        <div className="absolute top-14 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-primary/40 bg-card/95 px-3 py-1 text-[11.5px] shadow-sm backdrop-blur-sm">
          <span className="truncate">{focusLabel()}</span>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="shrink-0 cursor-pointer text-primary hover:underline" onClick={exitFocus}>
            exit <Kbd>F</Kbd>
          </button>
        </div>
      ) : (
        matches.active && (
          <div className="absolute top-14 left-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full border border-(--tc-amber-border) bg-card/95 px-3 py-1 text-[11.5px] shadow-sm backdrop-blur-sm">
            “{search.trim()}” — {matches.entityIds.size} entity / {matches.relationIds.size} relation types
          </div>
        )
      )}

      {/* Inside the canvas (it clips), clear of the zoom controls; wraps when narrow. */}
      <div className="pointer-events-none absolute right-3 bottom-3 left-14 z-10 flex justify-center">
        <div className="rounded-xl border bg-card/90 px-3 py-1 text-center text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          <Kbd>⌘K</Kbd> commands · click: select · drag a type: move · double-click or <Kbd>N</Kbd>: new type · drag{' '}
          <b className="font-semibold">+</b> onto a type, itself or empty space: relation ·{' '}
          <Kbd>F</Kbd> focus · <Kbd>/</Kbd> search · <Kbd>H</Kbd> hide/show properties · <Kbd>⇧H</Kbd>{' '}
          selected type only · <Kbd>Del</Kbd> delete selected · <Kbd>Esc</Kbd> cancel / exit focus / clear
          selection · <Kbd>V</Kbd> Graph/Classic
        </div>
      </div>

      {popover !== null && (
        <CreatePopover
          key={`${popover.mode}:${JSON.stringify(popover.at)}:${popover.mode === 'relation' ? popover.targetId : ''}`}
          state={popover}
          source={popoverSource}
          target={popoverTarget}
          onSubmit={submitPopover}
          onCancel={() => setPopover(null)}
        />
      )}
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono">{children}</kbd>
}

function ToolButton({
  label,
  text = false,
  active,
  onClick,
  children,
}: {
  label: string
  /** A button with a text label rather than an icon only. */
  text?: boolean
  /** A toggle and whether it is on; absent for a plain button. */
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size={text ? 'sm' : 'icon-sm'}
          onClick={onClick}
          aria-label={text ? undefined : label}
          aria-pressed={active}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
