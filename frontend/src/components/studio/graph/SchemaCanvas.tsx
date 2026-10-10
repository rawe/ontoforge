/**
 * The schema graph: one node per entity type, one edge per relation type.
 * React Flow is controlled. Node positions are computed once (dagre on the
 * first open, a free spot near the viewport centre for a type created
 * elsewhere), then only the user moves them; schema edits merge into the
 * nodes by id and never re-lay out. Selection comes from the address: a
 * click here selects without moving the view, a selection made anywhere else
 * is revealed.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronsDownUp, ChevronsUpDown, LayoutGrid, Maximize } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPlainKey, isTyping, overlayOpen } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { useModelSchema, type ModelSchema } from '../modeling/useModelSchema'
import type { SchemaSelection } from '../schema/schemaUrl'
import { useSchemaWorkspace, type SelectOptions } from '../schema/workspaceContext'
import { EntityTypeNode, type EntityFlowNode } from './EntityTypeNode'
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
import { EDGE_COLOR, RelationTypeEdge, type RelationFlowEdge } from './RelationTypeEdge'

const nodeTypes = { entityType: EntityTypeNode }
const edgeTypes = { relation: RelationTypeEdge }

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
 * (and React Flow's measurements), stored positions are restored, and the
 * rest is placed — dagre for everything when nothing is placed yet, else the
 * free spot nearest the viewport centre.
 */
function syncNodes(
  prev: Node[],
  schema: ModelSchema,
  stored: Positions,
  collapsed: Collapsed,
  viewportCentre: () => XY,
): Node[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const placed: Positions = {}
  for (const t of schema.entityTypes) {
    const p = prevById.get(t.entityTypeId)?.position ?? stored[t.entityTypeId]
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

const isMoveOrResize = (c: NodeChange<EntityFlowNode>): c is NodePositionChange | NodeDimensionChange =>
  c.type === 'position' || c.type === 'dimensions'

function Canvas() {
  const { ontologyKey, selection, select } = useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const collapsed = useCollapsed(ontologyKey)
  const { resolvedTheme } = useTheme()
  const { fitView, setCenter, getZoom, getInternalNode, getViewport } = useReactFlow()
  const storeApi = useStoreApi()
  const paneReady = useStore((s) => s.width > 0 && s.height > 0)
  const nodesInitialized = useNodesInitialized()

  const [stored] = useState(() => loadPositions(ontologyKey))
  const [keptAtMount] = useState(() => keptView(ontologyKey))
  const [nodes, setNodes] = useState<Node[]>([])
  const [relayout, setRelayout] = useState(false)

  const { entityTypes, relationTypes, properties } = schema
  const entityIds = useMemo(() => entityTypes.map((t) => t.entityTypeId), [entityTypes])
  const idOfKey = useMemo(() => new Map(entityTypes.map((t) => [t.key, t.entityTypeId])), [entityTypes])
  const selectedEntityId =
    selection?.kind === 'entity-types' ? (idOfKey.get(selection.key) ?? null) : null

  // Merge the schema into the nodes whenever the entity types change. The
  // first time waits for the property lists (dagre needs node heights) and
  // for the pane's size (free spots need the viewport centre).
  const [syncedTypes, setSyncedTypes] = useState<ModelSchema['entityTypes'] | null>(null)
  const ready = syncedTypes !== null || (schema.propertiesLoaded && paneReady)
  if (ready && !schema.isPending && syncedTypes !== entityTypes) {
    setSyncedTypes(entityTypes)
    setNodes((prev) =>
      syncNodes(prev, schema, stored, collapsed, () => {
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

  const reveal = useCallback(
    (sel: SchemaSelection) => {
      if (sel.kind === 'entity-types') {
        const id = idOfKey.get(sel.key)
        const n = id === undefined ? undefined : getInternalNode(id)
        if (n === undefined) return
        const x = n.internals.positionAbsolute.x + (n.measured.width ?? NODE_WIDTH) / 2
        const y = n.internals.positionAbsolute.y + (n.measured.height ?? 80) / 2
        void setCenter(x, y, { zoom: Math.max(getZoom(), 0.9), duration: 400 })
      } else {
        const r = relationTypes.find((t) => t.key === sel.key)
        const ends = [r?.sourceEntityTypeKey, r?.targetEntityTypeKey].flatMap((key) => {
          const id = key === undefined ? undefined : idOfKey.get(key)
          return id === undefined ? [] : [{ id }]
        })
        if (ends.length > 0) void fitView({ nodes: ends, padding: 0.15, duration: 400, maxZoom: 1.1 })
      }
    },
    [idOfKey, relationTypes, getInternalNode, setCenter, getZoom, fitView],
  )

  // Reveal every selection that did not come from a click here: outline,
  // palette, address, back/forward, or a different one when coming back from Classic.
  const seenSelection = useRef(keptAtMount?.selection ?? null)
  useEffect(() => {
    if (!nodesInitialized || sameSelection(selection, seenSelection.current)) return
    const own = sameSelection(selection, ownSelection.current)
    seenSelection.current = selection
    ownSelection.current = null
    if (selection !== null && !own) reveal(selection)
  }, [selection, nodesInitialized, reveal])

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

  const flowNodes = useMemo(
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
            },
          },
        ]
      }),
    [nodes, entityTypes, properties, collapsed, selectedEntityId, ontologyKey, selectHere],
  )

  const edges = useMemo<RelationFlowEdge[]>(() => {
    const boxes = new Map<string, Box>(
      nodes.map((n) => [
        n.id,
        { ...n.position, w: n.measured?.width ?? NODE_WIDTH, h: n.measured?.height ?? 80 },
      ]),
    )
    const ends = relationTypes.flatMap((r) => {
      const source = idOfKey.get(r.sourceEntityTypeKey)
      const target = idOfKey.get(r.targetEntityTypeKey)
      if (source === undefined || target === undefined || !boxes.has(source) || !boxes.has(target)) return []
      return [{ id: r.relationTypeId, source, target, label: r.key }]
    })
    const shapes = edgeSpecs(ends)
    const shaped = ends.map((e) => ({ ...e, ...shapes.get(e.id)! }))
    const labelT = placeLabels(shaped, boxes)
    return shaped.map((e) => {
      const isSelected = selection?.kind === 'relation-types' && selection.key === e.label
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'relation' as const,
        selected: isSelected,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: isSelected ? 'var(--primary)' : EDGE_COLOR,
        },
        data: {
          label: e.label,
          offset: e.offset,
          loopIndex: e.loopIndex,
          labelT: labelT.get(e.id) ?? 0.5,
          onSelect: () => selectHere({ kind: 'relation-types', key: e.label }),
        },
      }
    })
  }, [nodes, relationTypes, idOfKey, selection, selectHere])

  /* -------------------------------- actions -------------------------------- */

  const tidy = () => {
    const positions = dagreLayout(
      nodes.map((n) => ({
        id: n.id,
        width: n.measured?.width ?? NODE_WIDTH,
        height: n.measured?.height ?? 80,
      })),
      edges,
    )
    setRelayout(true)
    setNodes((nds) => nds.map((n) => ({ ...n, position: positions[n.id] ?? n.position })))
    window.setTimeout(() => {
      setRelayout(false)
      void fitView({ padding: 0.25, duration: 300 })
    }, 420)
  }

  const allCollapsed = allCollapsedOf(collapsed, entityIds)

  // H hides or shows the properties of every node, ⇧H only of the selected one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'h' && e.key !== 'H') || e.repeat || !isPlainKey(e)) return
      if (e.defaultPrevented || isTyping() || overlayOpen(e)) return
      e.preventDefault()
      if (!e.shiftKey) toggleAllCollapsed(ontologyKey, entityIds)
      else if (selectedEntityId !== null) toggleCollapsed(ontologyKey, selectedEntityId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ontologyKey, entityIds, selectedEntityId])

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="relative h-full w-full overflow-hidden">
      <ReactFlow<EntityFlowNode, RelationFlowEdge>
        className={cn(relayout && 'of-relayout')}
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes.filter(isMoveOrResize), nds))}
        onNodeClick={(_, node) => selectHere({ kind: 'entity-types', key: node.data.entityType.key })}
        onEdgeClick={(_, edge) => edge.data !== undefined && edge.data.onSelect()}
        onPaneClick={() => selectHere(null)}
        nodesConnectable={false}
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        defaultViewport={keptAtMount?.viewport}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        style={{ background: 'transparent' }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 rounded-xl border bg-card/95 p-1 shadow-md backdrop-blur-sm">
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
      </div>

      {/* Inside the canvas (it clips), clear of the zoom controls; wraps when narrow. */}
      <div className="pointer-events-none absolute right-3 bottom-3 left-14 z-10 flex justify-center">
        <div className="rounded-xl border bg-card/90 px-3 py-1 text-center text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          Click a type or relation: select · drag a type: move · <Kbd>H</Kbd> hide/show properties ·{' '}
          <Kbd>⇧H</Kbd> selected type only · <Kbd>V</Kbd> Graph/Classic
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono">{children}</kbd>
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
