import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Clock, Loader2, Search, Waypoints } from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { EntityCard } from '@/api/entities'
import { useFeatures } from '@/api/hooks'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  Neighbor,
  RelationInstance,
  RuntimeSchema,
} from '@/api/types'
import { useAccess } from '@/components/auth/useAccess'
import type { Turn } from '@/components/assistants/chat/chatModel'
import { EmptyState } from '@/components/EmptyState'
import { EXPLORER_LIVE_ONLY_TEXT } from '@/components/changesets/changesets'
import { TypeDot } from '@/components/TypeChip'
import { PARENT_COLOR } from '@/components/studio/graph/RelationTypeEdge'
import { Button } from '@/components/ui/button'
import { canConnectLive } from '@/lib/access'
import { pinnedChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'
import { readRecents, type RecentEntity } from '@/lib/recents'
import { citedCards, mapBounded, planAdd, relationsToFetch, type AddPlan } from './answerCanvas'
import { AskDock, type Answer } from './AskDock'
import { CanvasToolbar, SelectionBar, type TypeFilterEntry } from './CanvasToolbar'
import { ConnectDialog, type ConnectPair } from './ConnectDialog'
import { EdgePopover } from './EdgePopover'
import { EntityNode } from './EntityNode'
import { NodePanel } from './NodePanel'
import { RelationEdge } from './RelationEdge'
import { useAskDock } from './useAskDock'
import {
  MAX_NODES,
  NODE_HEIGHT,
  NODE_WIDTH,
  canvasCenter,
  connectOptions,
  emptyWorkingSet,
  makeEdge,
  makeNode,
  persistWorkingSet,
  placeAnchored,
  placeNodes,
  readPersistedNodes,
  relayoutPositions,
  workingSetReducer,
  type EntityFlowNode,
  type RelationFlowEdge,
} from './workingSet'

const nodeTypes = { entity: EntityNode }
const edgeTypes = { relation: RelationEdge }

const capMessage = `Canvas limit reached (${MAX_NODES} nodes) — remove some nodes first.`

/** Fill in the endpoint ids the /neighbors relation payload omits. */
function neighborRelation(source: EntityInstance, neighbor: Neighbor): RelationInstance {
  const { direction, ...rest } = neighbor.relation
  return {
    ...rest,
    fromEntityId: direction === 'outgoing' ? source._id : neighbor.entity._id,
    toEntityId: direction === 'outgoing' ? neighbor.entity._id : source._id,
  }
}

const openPalette = () =>
  window.dispatchEvent(new CustomEvent('of:open-palette'))

/** Entity and relation reads in flight at once when an answer fills the canvas. */
const PARALLEL_READS = 6

/** Where each planned entity goes: next to its anchors, level by level. */
const placementOf = (plan: AddPlan) =>
  new Map(plan.fresh.map((p) => [p.card.id, { level: p.level, anchors: p.anchors }]))

interface ExplorerCanvasProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
}

/** Explorer canvas — remounted per ontology + lens (composite `key` upstream). */
export function ExplorerCanvas(props: ExplorerCanvasProps) {
  return (
    <ReactFlowProvider>
      <ExplorerCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function ExplorerCanvasInner({ ontologyKey, lensKey, schema }: ExplorerCanvasProps) {
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const reactFlow = useReactFlow()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const { data: features } = useFeatures()

  const [ws, dispatch] = useReducer(workingSetReducer, emptyWorkingSet)
  // Latest-value refs so imperative helpers (fetch callbacks, RF handlers)
  // never work on stale closures.
  const wsRef = useRef(ws)
  useEffect(() => {
    wsRef.current = ws
  }, [ws])
  const schemaRef = useRef(schema)
  useEffect(() => {
    schemaRef.current = schema
  }, [schema])

  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hydrated, setHydrated] = useState(false)
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set())
  /** The Hierarchy edges filter: only parent relations' edges show; no node moves. */
  const [hierarchyOnly, setHierarchyOnly] = useState(false)
  const [connectPair, setConnectPair] = useState<ConnectPair | null>(null)
  // Dragging from node to node creates a relation, live only: a Writer
  // while no changeset is pinned (`canConnectLive`).
  const access = useAccess()
  const pinned = usePinnedChangeset(ontologyKey, lensKey)
  const canConnect = canConnectLive(access, ontologyKey, lensKey, pinned)
  const [edgePopover, setEdgePopover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [relayouting, setRelayouting] = useState(false)
  const [recents] = useState<RecentEntity[]>(() => readRecents(ontologyKey, lensKey))
  // The ask dock: its width needs the room the Explorer has.
  const [rootWidth, setRootWidth] = useState(0)
  // Measured before the first paint, so the restored view is fitted beside the dock.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    setRootWidth(root.clientWidth)
    const observer = new ResizeObserver(([entry]) => setRootWidth(entry?.contentRect.width ?? 0))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const dock = useAskDock(ontologyKey, lensKey, rootWidth)
  // Optimistic like the navigation: the button and the dock show unless AI is known to be off.
  const askOff = features?.ai === false
  // An answer's entity under the pointer, the one an answer showed (while
  // selected) and the canvas node under the pointer.
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null)
  const [shownEntity, setShownEntity] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const typeNameOf = useCallback(
    (key: string) => schema.entityTypes.find((t) => t.key === key)?.displayName ?? key,
    [schema],
  )

  /**
   * Shared fit-view options: cap zoom at 1 so small graphs render at natural
   * size instead of blowing up to max zoom, and pad the right side while the
   * node panel overlay (w-80 + inset) is open so nodes stay clear of it.
   * The panel padding is clamped to 40% of the canvas width so narrow
   * viewports don't squeeze the graph into a sliver.
   */
  const fitOptions = useCallback(() => {
    const panelOpen = wsRef.current.nodes.filter((n) => n.selected).length === 1
    if (!panelOpen) return { maxZoom: 1, padding: 0.15 }
    const canvasWidth = containerRef.current?.clientWidth ?? Number.POSITIVE_INFINITY
    const right = Math.round(Math.min(344, canvasWidth * 0.4))
    return {
      maxZoom: 1,
      padding: { top: 0.12, left: 0.12, bottom: 0.12, right: `${right}px` } as const,
    }
  }, [])

  /* ------------------------------- restore ---------------------------------- */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = schemaRef.current
      const inScope = new Set(s.entityTypes.map((t) => t.key))
      const persisted = readPersistedNodes(ontologyKey, lensKey)
        .filter((p) => inScope.has(p.typeKey))
        .slice(0, MAX_NODES)
      if (persisted.length === 0) {
        if (!cancelled) setHydrated(true)
        return
      }
      // Refetch entities; 404s (deleted since last visit) drop silently.
      const results = await Promise.allSettled(
        persisted.map((p) => runtime.getEntity(ontologyKey, lensKey, p.typeKey, p.id)),
      )
      const nodes: EntityFlowNode[] = []
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled') return
        const p = persisted[i]!
        const entity = res.value
        nodes.push(
          makeNode(
            entity,
            s.entityTypes.find((t) => t.key === entity._entityTypeKey)?.displayName ??
              entity._entityTypeKey,
            p.position,
            p.pinned,
          ),
        )
      })
      // Relations BETWEEN restored nodes only: per relation type, one bounded
      // fromEntityId= query per on-canvas node of the source type.
      const ids = new Set(nodes.map((n) => n.id))
      const fetches: Promise<RelationInstance[]>[] = []
      for (const rt of s.relationTypes) {
        for (const n of nodes) {
          if (n.data.entity._entityTypeKey !== rt.fromEntityTypeKey) continue
          fetches.push(
            runtime
              .listRelations(ontologyKey, lensKey, rt.key, { fromEntityId: n.id, limit: 200 })
              .then(
                (res) => res.items.filter((rel) => ids.has(rel.toEntityId)),
                () => [],
              ),
          )
        }
      }
      const batches = await Promise.all(fetches)
      if (cancelled) return
      dispatch({ type: 'hydrate', nodes, edges: batches.flat().map(makeEdge) })
      setHydrated(true)
      window.setTimeout(() => {
        void reactFlow.fitView({ ...fitOptions(), duration: 250 })
      }, 60)
    })()
    return () => {
      cancelled = true
    }
  }, [ontologyKey, lensKey, reactFlow, fitOptions])

  /* -------------------------------- persist ---------------------------------- */

  useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => persistWorkingSet(ontologyKey, lensKey, ws.nodes), 400)
    return () => clearTimeout(timer)
  }, [ws.nodes, hydrated, ontologyKey, lensKey])

  /* -------------------------------- helpers ---------------------------------- */

  const centerOn = useCallback(
    (position: XYPosition) => {
      void reactFlow.setCenter(
        position.x + NODE_WIDTH / 2,
        position.y + NODE_HEIGHT / 2,
        { zoom: Math.max(reactFlow.getZoom(), 0.9), duration: 400 },
      )
    },
    [reactFlow],
  )

  /**
   * Add entities as nodes near `near` (or the canvas centroid). Existing
   * nodes are never moved; duplicates only flash. Enforces the hard cap.
   * Returns false when the add was blocked.
   */
  const addEntities = useCallback(
    (
      entities: readonly EntityInstance[],
      opts?: {
        near?: XYPosition
        select?: boolean
        center?: boolean
        /** Per entity id: placed next to the first of its anchors on the canvas, level by level (`placeAnchored`). */
        anchors?: ReadonlyMap<string, { level: number; anchors: readonly string[] }>
      },
    ): boolean => {
      const current = wsRef.current.nodes
      const onCanvas = new Set(current.map((n) => n.id))
      const seen = new Set<string>()
      const fresh: EntityInstance[] = []
      const dupIds: string[] = []
      for (const entity of entities) {
        if (seen.has(entity._id)) continue
        seen.add(entity._id)
        if (onCanvas.has(entity._id)) dupIds.push(entity._id)
        else fresh.push(entity)
      }
      if (dupIds.length > 0) dispatch({ type: 'flash', ids: dupIds })
      if (fresh.length === 0) {
        if (opts?.center === true && dupIds.length === 1) {
          const node = current.find((n) => n.id === dupIds[0])
          if (node !== undefined) centerOn(node.position)
        }
        return true
      }
      if (current.length + fresh.length > MAX_NODES) {
        toast.error(capMessage)
        return false
      }
      const anchors = opts?.anchors
      const positions = anchors !== undefined
        ? placeAnchored(
            fresh.map((entity) => ({ id: entity._id, ...(anchors.get(entity._id) ?? { level: 0, anchors: [] }) })),
            current,
          )
        : placeNodes(
            fresh.length,
            opts?.near ?? canvasCenter(current),
            current.map((n) => n.position),
          )
      dispatch({
        type: 'addNodes',
        nodes: fresh.map((entity, i) => ({
          entity,
          typeName: typeNameOf(entity._entityTypeKey),
          position: positions[i]!,
        })),
        select: opts?.select,
      })
      if (opts?.center === true && fresh.length === 1) centerOn(positions[0]!)
      return true
    },
    [centerOn, typeNameOf],
  )

  const selectOnly = useCallback((id: string | null) => {
    dispatch({
      type: 'nodesChange',
      changes: wsRef.current.nodes
        .filter((n) => (n.selected ?? false) !== (n.id === id))
        .map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === id })),
    })
  }, [])

  /** `?focus=` / recents / palette target: add (or find) + select + center. */
  const focusEntity = useCallback(
    (entity: EntityInstance) => {
      const existing = wsRef.current.nodes.find((n) => n.id === entity._id)
      if (existing !== undefined) {
        selectOnly(entity._id)
        dispatch({ type: 'flash', ids: [entity._id] })
        centerOn(existing.position)
        return
      }
      addEntities([entity], { select: true, center: true })
    },
    [addEntities, centerOn, selectOnly],
  )

  /* ------------------------------ answers → canvas ---------------------------- */

  /** Draws the answer's relations between canvas entities, each read by its id; gone ones are skipped. */
  const addAnswerEdges = useCallback(
    async (answer: Answer, onCanvas: ReadonlySet<string>, touching?: string) => {
      const edges = new Set(wsRef.current.edges.map((e) => e.id))
      const wanted = relationsToFetch(answer, onCanvas, edges, touching)
      if (wanted.length === 0) return
      const results = await mapBounded(wanted, PARALLEL_READS, (r) =>
        runtime.getRelation(ontologyKey, lensKey, r.type, r.id))
      const relations = results.flatMap((res) => (res.status === 'fulfilled' ? [res.value] : []))
      if (relations.length > 0) dispatch({ type: 'addEdges', relations })
    },
    [ontologyKey, lensKey],
  )

  /** A click on an answer's entity: on the canvas it is shown (selected, centred, ringed), else added and shown. */
  const showAnswerEntity = useCallback(
    async (card: EntityCard, answer: Answer) => {
      const existing = wsRef.current.nodes.find((n) => n.id === card.id)
      if (existing !== undefined) {
        selectOnly(card.id)
        centerOn(existing.position)
        setShownEntity(card.id)
        return
      }
      const current = wsRef.current.nodes
      const plan = planAdd([card], answer, new Set(current.map((n) => n.id)), current.length, MAX_NODES)
      if (plan.refused) {
        toast.error(capMessage)
        return
      }
      let entity: EntityInstance
      try {
        entity = await runtime.getEntity(ontologyKey, lensKey, card.type, card.id)
      } catch {
        toast.error(`"${card.label}" no longer exists.`)
        return
      }
      if (!addEntities([entity], { select: true, center: true, anchors: placementOf(plan) })) return
      setShownEntity(card.id)
      const onCanvas = new Set(wsRef.current.nodes.map((n) => n.id)).add(card.id)
      await addAnswerEdges(answer, onCanvas, card.id)
    },
    [ontologyKey, lensKey, addEntities, addAnswerEdges, centerOn, selectOnly],
  )

  /** Auto-add: a completed answer's cited entities and the relations between canvas entities, as one batch. */
  const addAnswer = useCallback(
    async (answer: Pick<Turn<unknown>, 'reply' | 'entities' | 'links'>): Promise<'added' | 'refused'> => {
      const cited = citedCards(answer.reply, answer.entities)
      if (cited.length === 0) return 'added'
      const current = wsRef.current.nodes
      const plan = planAdd(cited, answer, new Set(current.map((n) => n.id)), current.length, MAX_NODES)
      if (plan.refused) {
        toast.error(capMessage)
        return 'refused'
      }
      const results = await mapBounded(plan.fresh, PARALLEL_READS, (p) =>
        runtime.getEntity(ontologyKey, lensKey, p.card.type, p.card.id))
      const fetched = results.flatMap((res) => (res.status === 'fulfilled' ? [res.value] : []))
      const present = new Set(plan.present)
      const presentEntities = wsRef.current.nodes.filter((n) => present.has(n.id)).map((n) => n.data.entity)
      if (!addEntities([...presentEntities, ...fetched], { anchors: placementOf(plan) })) return 'refused'
      const onCanvas = new Set([...wsRef.current.nodes.map((n) => n.id), ...fetched.map((e) => e._id)])
      await addAnswerEdges(answer, onCanvas)
      if (fetched.length > 0) {
        window.setTimeout(() => {
          void reactFlow.fitView({ ...fitOptions(), duration: 300 })
        }, 60)
      }
      return 'added'
    },
    [ontologyKey, lensKey, addEntities, addAnswerEdges, reactFlow, fitOptions],
  )

  /* ------------------------------ ?focus param ------------------------------- */

  useEffect(() => {
    if (!hydrated) return
    const focus = searchParams.get('focus')
    if (focus === null) return
    // Strip the param first so a refresh doesn't re-add the node.
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
    const sep = focus.indexOf(':')
    if (sep <= 0 || sep === focus.length - 1) return
    const typeKey = focus.slice(0, sep)
    const id = focus.slice(sep + 1)
    void (async () => {
      try {
        const entity = await runtime.getEntity(ontologyKey, lensKey, typeKey, id)
        focusEntity(entity)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Entity not found')
      }
    })()
  }, [hydrated, searchParams, setSearchParams, ontologyKey, lensKey, focusEntity])

  /* --------------------------- added entities (state) ------------------------- */

  // "Show all in Explorer": entities handed over in the navigation state
  // join the working set together — unanchored, duplicates flashed, the
  // hard cap refusing the addition as a whole.
  useEffect(() => {
    if (!hydrated) return
    const handed = (location.state as { addEntities?: { typeKey: string; id: string }[] } | null)?.addEntities
    if (!Array.isArray(handed)) return
    // Clear the state first so a refresh or back navigation doesn't re-add them.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    void (async () => {
      const results = await Promise.allSettled(
        handed.map((ref) => runtime.getEntity(ontologyKey, lensKey, ref.typeKey, ref.id)),
      )
      const entities = results.flatMap((res) => (res.status === 'fulfilled' ? [res.value] : []))
      if (entities.length > 0 && addEntities(entities)) {
        window.setTimeout(() => {
          void reactFlow.fitView({ ...fitOptions(), duration: 300 })
        }, 60)
      }
    })()
  }, [hydrated, location, navigate, ontologyKey, lensKey, addEntities, reactFlow, fitOptions])

  /* ------------------------------ interactions ------------------------------- */

  const onNodesChange = useCallback(
    (changes: NodeChange<EntityFlowNode>[]) => {
      dispatch({ type: 'nodesChange', changes })
      // Deselected: no longer the node an answer showed.
      if (changes.some((c) => c.type === 'select' && !c.selected)) {
        setShownEntity((shown) =>
          shown !== null && changes.some((c) => c.type === 'select' && c.id === shown && !c.selected) ? null : shown)
      }
    },
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationFlowEdge>[]) => dispatch({ type: 'edgesChange', changes }),
    [],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) return
      // The canvas writes live only (its edges come from the written relation).
      if (pinnedChangeset(ontologyKey, lensKey) !== null) {
        toast.info(EXPLORER_LIVE_ONLY_TEXT)
        return
      }
      const source = wsRef.current.nodes.find((n) => n.id === connection.source)
      const target = wsRef.current.nodes.find((n) => n.id === connection.target)
      if (source === undefined || target === undefined) return
      const options = connectOptions(
        source.data.entity,
        target.data.entity,
        schemaRef.current.relationTypes,
      )
      if (options.length === 0) {
        toast.error(
          `No relation type connects ${typeNameOf(source.data.entity._entityTypeKey)} and ${typeNameOf(target.data.entity._entityTypeKey)}`,
        )
        return
      }
      setConnectPair({ source: source.data.entity, target: target.data.entity })
    },
    [typeNameOf, ontologyKey, lensKey],
  )

  /** Panel expansion: add neighbor nodes near the source + their edges. */
  const expandNeighbors = useCallback(
    (source: EntityFlowNode, neighbors: Neighbor[]) => {
      addEntities(
        neighbors.map((n) => n.entity),
        { near: source.position },
      )
      dispatch({
        type: 'addEdges',
        relations: neighbors.map((n) => neighborRelation(source.data.entity, n)),
      })
    },
    [addEntities],
  )

  const relayout = useCallback(() => {
    const positions = relayoutPositions(wsRef.current.nodes, wsRef.current.edges)
    setRelayouting(true)
    dispatch({ type: 'setPositions', positions })
    window.setTimeout(() => {
      void reactFlow.fitView({ ...fitOptions(), duration: 380 })
    }, 60)
    window.setTimeout(() => setRelayouting(false), 500)
  }, [reactFlow, fitOptions])

  const fit = useCallback(() => {
    void reactFlow.fitView({ ...fitOptions(), duration: 300 })
  }, [reactFlow, fitOptions])

  const togglePinSelection = useCallback(() => {
    const selected = wsRef.current.nodes.filter((n) => n.selected)
    if (selected.length === 0) return
    const pinned = !selected.every((n) => n.data.pinned)
    dispatch({ type: 'setPinned', ids: selected.map((n) => n.id), pinned })
  }, [])

  // F = fit view, P = pin toggle, A = ask dock (Delete/Backspace handled by React Flow).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]',
        )
      ) {
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        fit()
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        togglePinSelection()
      } else if ((e.key === 'a' || e.key === 'A') && !askOff) {
        e.preventDefault()
        dock.toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fit, togglePinSelection, askOff, dock])

  /* ------------------------------ derived state ------------------------------ */

  // Entity ids on the canvas, a new set only when they change (not on every drag).
  const idsKey = ws.nodes.map((n) => n.id).join('|')
  const onCanvas = useMemo<ReadonlySet<string>>(() => new Set(idsKey === '' ? [] : idsKey.split('|')), [idsKey])

  // The node an answer points at: hovered there, else the one it showed while that stays selected.
  const highlighted =
    (hoveredEntity !== null && onCanvas.has(hoveredEntity) ? hoveredEntity : null) ??
    (shownEntity !== null && ws.nodes.some((n) => n.id === shownEntity && n.selected === true)
      ? shownEntity
      : null)

  const rfNodes = useMemo(() => {
    if (hiddenTypes.size === 0 && highlighted === null) return ws.nodes
    return ws.nodes.map((n) => {
      const hidden = hiddenTypes.has(n.data.entity._entityTypeKey)
      if (!hidden && n.id !== highlighted) return n
      return {
        ...n,
        ...(hidden && { hidden: true }),
        ...(n.id === highlighted && { data: { ...n.data, highlighted: true } }),
      }
    })
  }, [ws.nodes, hiddenTypes, highlighted])

  const parentRelationKeys = useMemo(
    () => new Set(schema.relationTypes.filter((rt) => rt.parent !== null).map((rt) => rt.key)),
    [schema],
  )

  const rfEdges = useMemo(() => {
    if (hiddenTypes.size === 0 && highlighted === null && parentRelationKeys.size === 0) {
      return ws.edges
    }
    const hiddenIds = new Set(
      ws.nodes
        .filter((n) => hiddenTypes.has(n.data.entity._entityTypeKey))
        .map((n) => n.id),
    )
    return ws.edges.map((e) => {
      const parent = parentRelationKeys.has(e.data!.relation._relationTypeKey)
      const hidden =
        hiddenIds.has(e.source) || hiddenIds.has(e.target) || (hierarchyOnly && !parent)
      const emphasised = highlighted !== null && (e.source === highlighted || e.target === highlighted)
      if (!hidden && !emphasised && !parent) return e
      return {
        ...e,
        ...(hidden && { hidden: true }),
        ...(parent && {
          data: { ...e.data!, parent: true },
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: PARENT_COLOR },
        }),
        ...(emphasised && {
          data: { ...e.data!, emphasised: true },
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: 'var(--primary)' },
        }),
      }
    })
  }, [ws.edges, ws.nodes, hiddenTypes, highlighted, parentRelationKeys, hierarchyOnly])

  const selectedNodes = useMemo(() => ws.nodes.filter((n) => n.selected), [ws.nodes])
  const panelNode = selectedNodes.length === 1 ? selectedNodes[0]! : null

  const typeFilters = useMemo<TypeFilterEntry[]>(() => {
    const countByType = new Map<string, number>()
    for (const n of ws.nodes) {
      const key = n.data.entity._entityTypeKey
      countByType.set(key, (countByType.get(key) ?? 0) + 1)
    }
    return [...countByType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([typeKey, count]) => ({
        typeKey,
        displayName: typeNameOf(typeKey),
        count,
        hidden: hiddenTypes.has(typeKey),
      }))
  }, [ws.nodes, hiddenTypes, typeNameOf])

  const pinnedCount = useMemo(
    () => ws.nodes.filter((n) => n.data.pinned).length,
    [ws.nodes],
  )

  const popoverEdge =
    edgePopover !== null ? ws.edges.find((e) => e.id === edgePopover.id) : undefined

  const addRecent = async (recent: RecentEntity) => {
    try {
      const entity = await runtime.getEntity(ontologyKey, lensKey, recent.typeKey, recent.id)
      focusEntity(entity)
    } catch {
      toast.error(`"${recent.label}" no longer exists.`)
    }
  }

  /* --------------------------------- render ---------------------------------- */

  return (
    <div ref={rootRef} className="flex h-full w-full">
      {!askOff && dock.settings.open && (
        <AskDock
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          dock={dock}
          onCanvas={onCanvas}
          pointed={hoveredNode ?? highlighted}
          onEntity={showAnswerEntity}
          onHover={setHoveredEntity}
          onAnswer={addAnswer}
        />
      )}
      <div ref={containerRef} className="relative h-full min-w-0 flex-1">
        <div className={relayouting ? 'of-relayout h-full w-full' : 'h-full w-full'}>
          <ReactFlow<EntityFlowNode, RelationFlowEdge>
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodesConnectable={canConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            minZoom={0.1}
            maxZoom={2.5}
            deleteKeyCode={['Backspace', 'Delete']}
            multiSelectionKeyCode={['Meta', 'Shift']}
            onEdgeClick={(event, edge) =>
              setEdgePopover({ id: edge.id, x: event.clientX, y: event.clientY })
            }
            onNodeDoubleClick={(_event, node) => {
              void navigate(
                `/o/${ontologyKey}/w/${lensKey}/e/${node.data.entity._entityTypeKey}/${node.id}`,
              )
            }}
            onNodeMouseEnter={(_event, node) => setHoveredNode(node.id)}
            onNodeMouseLeave={() => setHoveredNode(null)}
            onPaneClick={() => setEdgePopover(null)}
            onMoveStart={() => setEdgePopover(null)}
            style={{ background: 'transparent' }}
          >
            <Background gap={22} size={1} />
          </ReactFlow>
        </div>

        <CanvasToolbar
          nodeCount={ws.nodes.length}
          pinnedCount={pinnedCount}
          types={typeFilters}
          onSearch={openPalette}
          onFit={fit}
          onRelayout={relayout}
          onClear={(mode) => dispatch({ type: 'clear', mode })}
          onToggleType={(typeKey) =>
            setHiddenTypes((prev) => {
              const next = new Set(prev)
              if (next.has(typeKey)) next.delete(typeKey)
              else next.add(typeKey)
              return next
            })
          }
          ask={askOff ? undefined : { open: dock.settings.open, onToggle: dock.toggle }}
          hierarchy={
            parentRelationKeys.size === 0
              ? undefined
              : { on: hierarchyOnly, onToggle: () => setHierarchyOnly((on) => !on) }
          }
        />

        {!hydrated && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Restoring working set…
            </div>
          </div>
        )}

        {hydrated && ws.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="pointer-events-auto flex max-w-md flex-col items-center">
              <EmptyState
                icon={Waypoints}
                title="Search to start exploring"
                description="Find entities and pull them onto the canvas, then expand along their relations."
                action={
                  <Button size="sm" onClick={openPalette}>
                    <Search className="size-3.5" /> Search entities
                    <kbd className="ml-1 rounded border border-primary-foreground/30 px-1 font-mono text-[10px]">
                      ⌘K
                    </kbd>
                  </Button>
                }
              />
              {recents.length > 0 && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Or add a recent entity
                  </span>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {recents.slice(0, 6).map((recent) => (
                      <button
                        key={recent.id}
                        type="button"
                        onClick={() => void addRecent(recent)}
                        className="inline-flex max-w-48 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[12px] transition-colors hover:bg-muted/60"
                      >
                        <Clock className="size-3 shrink-0 text-muted-foreground" />
                        <TypeDot typeKey={recent.typeKey} />
                        <span className="truncate">{recent.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {panelNode !== null && (
          <NodePanel
            key={panelNode.id}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            node={panelNode}
            entityTypes={schema.entityTypes}
            relationTypes={schema.relationTypes}
            onExpand={(neighbors) => expandNeighbors(panelNode, neighbors)}
            onRelationCreated={(relation, target) => {
              addEntities([target], { near: panelNode.position })
              dispatch({ type: 'addEdges', relations: [relation] })
            }}
            onTogglePin={() =>
              dispatch({
                type: 'setPinned',
                ids: [panelNode.id],
                pinned: !panelNode.data.pinned,
              })
            }
            onRemove={() => dispatch({ type: 'removeNodes', ids: [panelNode.id] })}
            onDeselect={() => selectOnly(null)}
          />
        )}

        {selectedNodes.length > 1 && (
          <SelectionBar
            count={selectedNodes.length}
            allPinned={selectedNodes.every((n) => n.data.pinned)}
            onPinAll={togglePinSelection}
            onRemove={() =>
              dispatch({ type: 'removeNodes', ids: selectedNodes.map((n) => n.id) })
            }
          />
        )}

        {edgePopover !== null && popoverEdge !== undefined && (
          <EdgePopover
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            edge={popoverEdge}
            at={{ x: edgePopover.x, y: edgePopover.y }}
            sourceEntity={
              ws.nodes.find((n) => n.id === popoverEdge.source)?.data.entity
            }
            targetEntity={
              ws.nodes.find((n) => n.id === popoverEdge.target)?.data.entity
            }
            relationType={schema.relationTypes.find(
              (rt) => rt.key === popoverEdge.data?.relation._relationTypeKey,
            )}
            onClose={() => setEdgePopover(null)}
            onDeleted={(edgeId) => {
              dispatch({ type: 'removeEdge', id: edgeId })
              setEdgePopover(null)
            }}
          />
        )}

        <ConnectDialog
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          pair={connectPair}
          entityTypes={schema.entityTypes}
          relationTypes={schema.relationTypes}
          onClose={() => setConnectPair(null)}
          onCreated={(relation) => dispatch({ type: 'addEdges', relations: [relation] })}
        />
      </div>
    </div>
  )
}
