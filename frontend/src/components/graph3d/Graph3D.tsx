import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ArrowLeft, Crosshair, Focus, Maximize2, Minimize2, Orbit, Pause, Play, Search, Sparkles, Square, Waves, X } from 'lucide-react'
import type { Graph3DProps } from './types'
import { createGraphScene, type SceneController, type SceneView } from './scene'
import { followTourDetails, manualDetail, manualDetails, reconcileDetails, shownDetail, type DetailItem, type DetailState } from './details'
import './graph3d.css'

/** Shared presentation only. Hosts own data, authorization, selection and inspectors. */
export function Graph3D(props: Graph3DProps) {
  const { nodes, edges, selectedNodeId = null, selectedEdgeId = null, fitRequest, revealRequest } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneController | null>(null)
  const viewRef = useRef<SceneView | null>(null)
  /** The topology the live scene shows, so a change rebuilds the graph and not the renderer. */
  const sceneTopologyRef = useRef<string | null>(null)
  const topology = JSON.stringify([
    nodes.map(node => [node.id, node.typeKey]).sort((a, b) => a[0].localeCompare(b[0])),
    edges.map(edge => [edge.id, edge.source, edge.target, edge.parent ?? false]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ])
  const [failed, setFailed] = useState(false)
  const [fly, setFly] = useState(false)
  const [focus, setFocus] = useState(false)
  const [animated, setAnimated] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [tour, setTour] = useState(false)
  const [tourPaused, setTourPaused] = useState(false)
  if (!tour && tourPaused) setTourPaused(false)
  const [details, setDetails] = useState<DetailState>({ manualNodeId: selectedNodeId, manualEdgeId: selectedEdgeId, tourNodeId: null, followTour: true, pinned: null })
  const reconciledDetails = reconcileDetails(details, selectedNodeId, selectedEdgeId, nodes, edges)
  if (reconciledDetails !== details) {
    setDetails(reconciledDetails)
    if (tour && (details.manualNodeId !== selectedNodeId || details.manualEdgeId !== selectedEdgeId)) setTour(false)
  }
  if (tour && !nodes.some(node => !node.dimmed)) setTour(false)
  const [lastRequests, setLastRequests] = useState({ fitRequest, revealRequest })
  if (lastRequests.fitRequest !== fitRequest || lastRequests.revealRequest !== revealRequest) {
    setLastRequests({ fitRequest, revealRequest })
    if (tour) setTour(false)
    if (lastRequests.revealRequest !== revealRequest) setDetails(state => manualDetails(state, manualDetail(selectedNodeId, selectedEdgeId)))
  }
  const detailItem = shownDetail(reconciledDetails)
  const [fullscreen, setFullscreen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [fullscreenError, setFullscreenError] = useState(false)
  const takeControl = (item?: DetailItem) => {
    sceneRef.current?.setTour(false)
    setTour(false)
    if (item !== undefined) setDetails(state => manualDetails(state, item))
  }
  const selectNode = useEffectEvent((id: string | null) => { takeControl(id ? { kind: 'node', id } : null); props.onSelectNode(id) })
  const selectEdge = useEffectEvent((id: string, at: { x: number; y: number }) => { takeControl({ kind: 'edge', id }); props.onSelectEdge?.(id, at) })
  const tourNode = useEffectEvent((id: string) => setDetails(state => ({ ...state, tourNodeId: id })))
  const hoverNode = useEffectEvent((id: string | null) => props.onHoverNode?.(id))
  const navigation = useEffectEvent(() => { setFly(false); setTour(false) })
  const sceneError = useEffectEvent(() => setFailed(true))
  const initializeScene = useEffectEvent((mount: HTMLElement, labels: HTMLElement) => createGraphScene({
    mount, labels, nodes, edges, previousPositions: viewRef.current?.nodePositions,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onSelectNode: id => selectNode(id), onSelectEdge: (id, at) => selectEdge(id, at), onHoverNode: id => hoverNode(id),
    onTourNode: id => tourNode(id), onNavigation: () => navigation(), onError: () => sceneError(),
  }))
  const currentTopology = useEffectEvent(() => topology)
  const applyGraph = useEffectEvent(() => sceneRef.current?.setGraph(nodes, edges))
  const revealSelected = useEffectEvent(() => {
    if (selectedNodeId) sceneRef.current?.focus(selectedNodeId)
    else if (selectedEdgeId) sceneRef.current?.focusEdge(selectedEdgeId)
  })
  useEffect(() => {
    if (!mountRef.current || !labelsRef.current || failed) return
    let current = true
    try {
      const scene = initializeScene(mountRef.current, labelsRef.current)
      if (viewRef.current) scene.restoreView(viewRef.current)
      sceneRef.current = scene
      sceneTopologyRef.current = currentTopology()
      return () => { current = false; viewRef.current = scene.getView(); scene.dispose(); sceneRef.current = null; sceneTopologyRef.current = null; hoverNode(null) }
    } catch {
      queueMicrotask(() => { if (current) setFailed(true) })
    }
    return () => { current = false }
    // Mounted once per WebGL attempt; topology changes reuse this renderer below.
  }, [failed])
  useEffect(() => {
    if (!sceneRef.current || sceneTopologyRef.current === topology) return
    applyGraph()
    sceneTopologyRef.current = topology
  }, [topology, failed])
  useEffect(() => { sceneRef.current?.updateData(nodes, edges) }, [nodes, edges, topology, failed])
  const detailNodeId = detailItem?.kind === 'node' ? detailItem.id : null
  const detailEdgeId = detailItem?.kind === 'edge' ? detailItem.id : null
  useEffect(() => { sceneRef.current?.select(detailNodeId, detailEdgeId) }, [topology, detailNodeId, detailEdgeId, failed])
  useEffect(() => { sceneRef.current?.setFly(fly) }, [topology, fly, failed])
  useEffect(() => { sceneRef.current?.setFocus(focus, selectedNodeId) }, [topology, focus, selectedNodeId, failed])
  useEffect(() => { sceneRef.current?.setAnimated(animated) }, [topology, animated, failed])
  useEffect(() => { sceneRef.current?.setTour(tour) }, [topology, tour, failed])
  useEffect(() => { sceneRef.current?.setTourPaused(tourPaused) }, [topology, tour, tourPaused, failed])
  useEffect(() => { if (fitRequest !== undefined) sceneRef.current?.fit() }, [fitRequest])
  useEffect(() => { if (revealRequest !== undefined) revealSelected() }, [revealRequest])
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => { sceneRef.current?.setReducedMotion(preference.matches); if (preference.matches) { setAnimated(false); setTour(false) } }
    preference.addEventListener('change', onChange)
    return () => preference.removeEventListener('change', onChange)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen()
      else await rootRef.current?.requestFullscreen()
      setFullscreenError(false)
    } catch { setFullscreenError(true) }
  }
  if (failed) return <div className="graph3d-fallback" role="status">
    <Orbit size={38} strokeWidth={1} />
    <h3>3D is unavailable in this browser</h3>
    <p>The interactive scene needs WebGL. You can continue exploring the graph in 2D.</p>
    <button type="button" onClick={props.onExit3D}><ArrowLeft size={15} /> Return to 2D</button>
  </div>
  const selected = detailItem?.kind === 'node' ? nodes.find(node => node.id === detailItem.id) : undefined
  const selectedRelation = detailItem?.kind === 'edge' ? edges.find(edge => edge.id === detailItem.id) : undefined
  const previewingTour = details.followTour && !!details.tourNodeId
  const matches = query.trim() ? nodes.filter(node => `${node.label} ${node.typeKey} ${node.subtitle ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 12) : nodes.slice(0, 8)
  return <div ref={rootRef} className="graph3d-root" data-fly={fly || undefined}>
    <div ref={mountRef} className="graph3d-mount" />
    <div ref={labelsRef} className="graph3d-labels" />
    {nodes.length === 0 && <div className="graph3d-empty"><Sparkles size={30} /><strong>Your graph starts here</strong><span>Add entity types or entities to explore their connections in 3D.</span></div>}
    <div className="graph3d-vignette" />
    {/* The panel is this view's inspector: its presses must not reach a host's click-away handlers. */}
    {fullscreen && (selected || selectedRelation || tour) && <aside className="graph3d-detail-panel" aria-label="Graph details" onPointerDown={event => event.stopPropagation()}>
      <label className="graph3d-follow-tour"><input type="checkbox" checked={details.followTour} onChange={event => { const followTour = event.target.checked; setDetails(state => followTourDetails(state, followTour)) }} /> Follow tour</label>
      <span className="graph3d-detail-source">{previewingTour ? tour ? tourPaused ? 'Paused tour stop' : 'Tour stop' : 'Last tour stop' : !details.followTour && details.pinned ? 'Pinned details' : 'Selected item'}</span>
      {!selected && !selectedRelation && <p>{details.followTour ? 'The next tour stop will appear here.' : 'Select a node to pin its details, or enable Follow tour.'}</p>}
      {(selected || selectedRelation) && <><span className="graph3d-detail-kind">{selected ? selected.subtitle || selected.typeKey : 'Relationship'}</span><h3>{selected?.label || selectedRelation?.label}</h3></>}
      {selected?.description && <p>{selected.description}</p>}
      {selected && <>
        {selected.identity && <dl className="graph3d-detail-identity"><div><dt>Identity</dt><dd>{selected.identity}</dd></div></dl>}
        <button type="button" onClick={() => { takeControl(); sceneRef.current?.focus(selected.id) }}><Crosshair size={13} /> Approach node</button>
        {!!selected.properties?.length && <dl>{selected.properties.map((property, i) => <div key={i}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
        {!!selected.connections?.length && <>
          <h4>Connections in this view</h4>
          <dl>{selected.connections.map((connection, i) => <div key={i}><dt>{connection.label}</dt><dd>{connection.value}</dd></div>)}</dl>
        </>}
      </>}
      {selectedRelation && <>
        <p>{nodes.find(node => node.id === selectedRelation.source)?.label} <span aria-hidden="true">→</span> {nodes.find(node => node.id === selectedRelation.target)?.label}</p>
        {selectedRelation.description && <p>{selectedRelation.description}</p>}
        <button type="button" onClick={() => { takeControl(); sceneRef.current?.focusEdge(selectedRelation.id) }}><Crosshair size={13} /> Frame relationship</button>
        <dl>{selectedRelation.properties?.map((property, i) => <div key={i}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>
      </>}
    </aside>}
    <div className="graph3d-hud">
      {searchOpen && <div className="graph3d-search">
        <div className="graph3d-search-field"><Search size={15} /><input aria-label="Find a node in the 3D graph" placeholder="Find a node…" value={query} onChange={e => setQuery(e.target.value)} autoFocus /><button type="button" aria-label="Close graph search" onClick={() => setSearchOpen(false)}><X size={14} /></button></div>
        <div className="graph3d-search-results">
          {matches.map(node => <button key={node.id} type="button" onClick={() => { takeControl({ kind: 'node', id: node.id }); props.onSelectNode(node.id); sceneRef.current?.focus(node.id); setSearchOpen(false) }}><span>{node.label}</span><small>{node.subtitle || node.typeKey}</small></button>)}
          {matches.length === 0 && <p>No matching nodes</p>}
        </div>
      </div>}
      <div className="graph3d-caption"><span className="graph3d-live-dot" /><span>{props.title || 'Ontology in space'}</span><span className="graph3d-count">{nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {edges.length} {edges.length === 1 ? 'relation' : 'relations'}</span></div>
      <div className="graph3d-controls" role="toolbar" aria-label="3D graph controls">
        <button type="button" title="Fit the whole graph" aria-label="Fit the whole graph" onClick={() => { takeControl(); sceneRef.current?.fit() }}><Crosshair size={16} /></button>
        <button type="button" title="Find and fly to a node" aria-label="Find and fly to a node" aria-pressed={searchOpen} onClick={() => { takeControl(); setSearchOpen(v => !v) }}><Search size={16} /></button>
        <span className="graph3d-divider" />
        <button type="button" aria-label="Orbit" title="Orbit: drag to rotate, scroll to approach" aria-pressed={!fly} onClick={() => { takeControl(); setFly(false) }}><Orbit size={16} /><span>Orbit</span></button>
        <button type="button" aria-label="Fly" title="Fly: drag to look, WASD to move, Q/E for height, Shift to accelerate, Escape to stop" aria-pressed={fly} onClick={() => { setFly(v => !v); setTour(false) }}><span className="graph3d-flight-icon">↗</span><span>Fly</span></button>
        <span className="graph3d-divider" />
        <button type="button" title={selectedNodeId ? 'Focus on the selected node and its neighbours' : 'Select a node to focus on its neighbours'} aria-label="Focus on neighbours" aria-pressed={focus} disabled={!selectedNodeId} onClick={() => { takeControl(); setFocus(v => !v) }}><Focus size={16} /></button>
        <button type="button" title={tour ? 'Stop guided tour' : 'Take a guided tour'} aria-pressed={tour} disabled={!nodes.some(node => !node.dimmed)} onClick={() => { setTour(v => !v); setTourPaused(false); setFly(false) }}>{tour ? <Square size={15} /> : <Sparkles size={16} />}<span>{tour ? 'Stop tour' : 'Tour'}</span></button>
        {tour && <button type="button" title={tourPaused ? 'Resume tour' : 'Pause tour'} aria-label={tourPaused ? 'Resume tour' : 'Pause tour'} onClick={() => setTourPaused(value => !value)}>{tourPaused ? <Play size={15} /> : <Pause size={15} />}<span>{tourPaused ? 'Resume' : 'Pause'}</span></button>}
        <button type="button" title="Animate particles, highlights and the slow tour orbit" aria-label="Motion" aria-pressed={animated} onClick={() => setAnimated(value => !value)}><Waves size={15} /><span>Motion</span></button>
        <button type="button" title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      <div className="graph3d-hint" aria-live="polite">{fullscreenError ? 'Full screen is unavailable in this browser.' : fly ? 'Drag to look · W A S D move · Q / E height · Shift boost · Esc orbit' : tour ? tourPaused ? 'Tour paused · resume to continue from here' : 'Guided tour · drag the scene to take control' : selectedRelation ? `Relationship: ${selectedRelation.label}` : selected ? `${selected.label} · double-click to approach` : 'Drag to orbit · scroll to approach · click to inspect · double-click to fly to a node'}</div>
    </div>
  </div>
}
