import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ArrowLeft, Crosshair, Focus, Maximize2, Minimize2, Orbit, Pause, Play, Search, Sparkles, X } from 'lucide-react'
import type { Graph3DProps } from './types'
import { createGraphScene, type SceneController, type SceneView } from './scene'
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
  const [fullscreen, setFullscreen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [fullscreenError, setFullscreenError] = useState(false)
  const selectNode = useEffectEvent((id: string | null) => props.onSelectNode(id))
  const selectEdge = useEffectEvent((id: string, at: { x: number; y: number }) => props.onSelectEdge?.(id, at))
  const hoverNode = useEffectEvent((id: string | null) => props.onHoverNode?.(id))
  const navigation = useEffectEvent(() => { setFly(false); setTour(false) })
  const sceneError = useEffectEvent(() => setFailed(true))
  const initializeScene = useEffectEvent((mount: HTMLElement, labels: HTMLElement) => createGraphScene({
    mount, labels, nodes, edges, previousPositions: viewRef.current?.nodePositions,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onSelectNode: id => selectNode(id), onSelectEdge: (id, at) => selectEdge(id, at), onHoverNode: id => hoverNode(id),
    onNavigation: () => navigation(), onError: () => sceneError(),
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
  useEffect(() => { sceneRef.current?.select(selectedNodeId, selectedEdgeId) }, [topology, selectedNodeId, selectedEdgeId, failed])
  useEffect(() => { sceneRef.current?.setFly(fly) }, [topology, fly, failed])
  useEffect(() => { sceneRef.current?.setFocus(focus) }, [topology, focus, failed])
  useEffect(() => { sceneRef.current?.setAnimated(animated) }, [topology, animated, failed])
  useEffect(() => { sceneRef.current?.setTour(tour) }, [topology, tour, failed])
  useEffect(() => { if (fitRequest !== undefined) sceneRef.current?.fit() }, [fitRequest])
  useEffect(() => { if (revealRequest !== undefined) revealSelected() }, [revealRequest])
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => { if (preference.matches) { setAnimated(false); setTour(false) } }
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
  const selected = nodes.find(node => node.id === selectedNodeId)
  const selectedRelation = edges.find(edge => edge.id === selectedEdgeId)
  const matches = query.trim() ? nodes.filter(node => `${node.label} ${node.typeKey} ${node.subtitle ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 12) : nodes.slice(0, 8)
  return <div ref={rootRef} className="graph3d-root" data-fly={fly || undefined}>
    <div ref={mountRef} className="graph3d-mount" />
    <div ref={labelsRef} className="graph3d-labels" />
    {nodes.length === 0 && <div className="graph3d-empty"><Sparkles size={30} /><strong>Your graph starts here</strong><span>Add entity types or entities to explore their connections in 3D.</span></div>}
    <div className="graph3d-vignette" />
    {fullscreen && (selected || selectedRelation) && <aside className="graph3d-detail-panel" aria-label="Selected graph item">
      <span className="graph3d-detail-kind">{selected ? selected.subtitle || selected.typeKey : 'Relationship'}</span>
      <h3>{selected?.label || selectedRelation?.label}</h3>
      {selected?.description && <p>{selected.description}</p>}
      {selected && <><button type="button" onClick={() => sceneRef.current?.focus(selected.id)}><Crosshair size={13} /> Approach node</button><dl>{selected.properties?.map((property, i) => <div key={i}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl></>}
      {selectedRelation && <>
        <p>{nodes.find(node => node.id === selectedRelation.source)?.label} <span aria-hidden="true">→</span> {nodes.find(node => node.id === selectedRelation.target)?.label}</p>
        {selectedRelation.description && <p>{selectedRelation.description}</p>}
        <button type="button" onClick={() => sceneRef.current?.focusEdge(selectedRelation.id)}><Crosshair size={13} /> Frame relationship</button>
        <dl>{selectedRelation.properties?.map((property, i) => <div key={i}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>
      </>}
    </aside>}
    <div className="graph3d-hud">
      {searchOpen && <div className="graph3d-search">
        <div className="graph3d-search-field"><Search size={15} /><input aria-label="Find a node in the 3D graph" placeholder="Find a node…" value={query} onChange={e => setQuery(e.target.value)} autoFocus /><button type="button" aria-label="Close graph search" onClick={() => setSearchOpen(false)}><X size={14} /></button></div>
        <div className="graph3d-search-results">
          {matches.map(node => <button key={node.id} type="button" onClick={() => { props.onSelectNode(node.id); sceneRef.current?.focus(node.id); setSearchOpen(false); setTour(false) }}><span>{node.label}</span><small>{node.subtitle || node.typeKey}</small></button>)}
          {matches.length === 0 && <p>No matching nodes</p>}
        </div>
      </div>}
      <div className="graph3d-caption"><span className="graph3d-live-dot" /><span>{props.title || 'Ontology in space'}</span><span className="graph3d-count">{nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {edges.length} {edges.length === 1 ? 'relation' : 'relations'}</span></div>
      <div className="graph3d-controls" role="toolbar" aria-label="3D graph controls">
        <button type="button" title="Fit the whole graph" aria-label="Fit the whole graph" onClick={() => { sceneRef.current?.fit(); setTour(false) }}><Crosshair size={16} /></button>
        <button type="button" title="Find and fly to a node" aria-label="Find and fly to a node" aria-pressed={searchOpen} onClick={() => setSearchOpen(v => !v)}><Search size={16} /></button>
        <span className="graph3d-divider" />
        <button type="button" aria-label="Orbit" title="Orbit: drag to rotate, scroll to approach" aria-pressed={!fly} onClick={() => setFly(false)}><Orbit size={16} /><span>Orbit</span></button>
        <button type="button" aria-label="Fly" title="Fly: drag to look, WASD to move, Q/E for height, Shift to accelerate, Escape to stop" aria-pressed={fly} onClick={() => { setFly(v => !v); setTour(false) }}><span className="graph3d-flight-icon">↗</span><span>Fly</span></button>
        <span className="graph3d-divider" />
        <button type="button" title={selectedNodeId ? 'Focus on the selected node and its neighbours' : 'Select a node to focus on its neighbours'} aria-label="Focus on neighbours" aria-pressed={focus} disabled={!selectedNodeId} onClick={() => setFocus(v => !v)}><Focus size={16} /></button>
        <button type="button" title={tour ? 'Stop guided tour' : 'Take a guided tour'} aria-pressed={tour} disabled={!nodes.length} onClick={() => { setTour(v => !v); setFly(false); setAnimated(true) }}><Sparkles size={16} /><span>Tour</span></button>
        <button type="button" title={animated ? 'Pause scene animation' : 'Resume scene animation'} aria-label={animated ? 'Pause scene animation' : 'Resume scene animation'} aria-pressed={!animated} onClick={() => { setAnimated(v => !v); setTour(false) }}>{animated ? <Pause size={15} /> : <Play size={15} />}</button>
        <button type="button" title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      <div className="graph3d-hint" aria-live="polite">{fullscreenError ? 'Full screen is unavailable in this browser.' : fly ? 'Drag to look · W A S D move · Q / E height · Shift boost · Esc orbit' : tour ? 'Guided tour · drag the scene to take control' : selectedRelation ? `Relationship: ${selectedRelation.label}` : selected ? `${selected.label} · double-click to approach` : 'Drag to orbit · scroll to approach · click to inspect · double-click to fly to a node'}</div>
    </div>
  </div>
}
