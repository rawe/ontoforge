import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { Graph3DNode, Graph3DEdge } from './types'
import { edgeLanes, hashKey, layoutGraph } from './layout'
import { getTypeColor } from '@/lib/typeColors'

export interface SceneOptions {
  nodes: readonly Graph3DNode[]
  edges: readonly Graph3DEdge[]
  mount: HTMLElement
  labels: HTMLElement
  previousPositions?: Record<string, { x: number; y: number; z: number }>
  reducedMotion: boolean
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string, at: { x: number; y: number }) => void
  onHoverNode: (id: string | null) => void
  onError: () => void
  onNavigation: () => void
}
export interface SceneView { position: [number, number, number]; target: [number, number, number]; nodePositions?: Record<string, { x: number; y: number; z: number }> }
export interface SceneController {
  getView: () => SceneView
  restoreView: (view: SceneView) => void
  updateData: (nodes: readonly Graph3DNode[], edges: readonly Graph3DEdge[]) => void
  /** Replaces the graph's nodes and edges in the same renderer, keeping known positions and the camera. */
  setGraph: (nodes: readonly Graph3DNode[], edges: readonly Graph3DEdge[]) => void
  dispose: () => void
  fit: () => void
  focus: (id: string) => void
  focusEdge: (id: string) => void
  select: (nodeId: string | null, edgeId: string | null) => void
  setFly: (value: boolean) => void
  setFocus: (value: boolean) => void
  setAnimated: (value: boolean) => void
  setTour: (value: boolean) => void
}

export function createGraphScene(options: SceneOptions): SceneController {
  const { mount, labels } = options
  // Three's color parser does not accept CSS variables or OKLCH. Let the browser
  // resolve the shared palette, then read its sRGB equivalent for GPU materials.
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = 1; colorCanvas.height = 1
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })
  const paletteStyle = getComputedStyle(mount)
  const paletteCache = new Map<string, string>()
  const typeColor = (key: string): string => {
    const color = getTypeColor(key)
    const css = paletteStyle.getPropertyValue(`--tc-${color.name}`).trim()
    const cached = paletteCache.get(css)
    if (cached) return cached
    if (!colorContext || !css) return '#68cfe0'
    colorContext.clearRect(0, 0, 1, 1)
    colorContext.fillStyle = '#68cfe0'
    colorContext.fillStyle = css
    colorContext.fillRect(0, 0, 1, 1)
    const pixel = colorContext.getImageData(0, 0, 1, 1).data
    const resolved = `#${[pixel[0], pixel[1], pixel[2]].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
    paletteCache.set(css, resolved)
    return resolved
  }
  let nodes: readonly Graph3DNode[] = []
  let nodeIds = new Set<string>()
  let edges: readonly Graph3DEdge[] = []
  let disposed = false
  let stylesDirty = true
  let lastLabels = 0
  // Frames are drawn while something moves; a still, paused scene stops drawing.
  let renderUntil = 0
  const wake = () => { renderUntil = performance.now() + 250 }
  let fly = false, focused = false, animated = !options.reducedMotion, touring = false
  let selectedNode: string | null = null, selectedEdge: string | null = null
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor('#0b1426', 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  const canvas = renderer.domElement
  canvas.className = 'graph3d-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'Interactive 3D ontology. Drag to orbit, scroll to approach. Select a node or relationship. In fly mode use W A S D, Q and E to move, Shift to accelerate, Escape to stop.')
  mount.appendChild(canvas)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0b1426')
  scene.fog = new THREE.FogExp2('#0b1426', 0.0012)
  const camera = new THREE.PerspectiveCamera(48, 1, 0.2, 5000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.minDistance = 4
  controls.maxDistance = 2200
  controls.enablePan = true
  controls.zoomSpeed = 0.8
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.35, 1.4)
  composer.addPass(bloom)
  const output = new OutputPass()
  composer.addPass(output)
  scene.add(new THREE.HemisphereLight('#d9e9ff', '#17132d', 1.25))
  const keyLight = new THREE.DirectionalLight('#e4f1ff', 1.8)
  keyLight.position.set(30, 70, 80)
  scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight('#9678ff', 1.1)
  rimLight.position.set(-80, 10, -50)
  scene.add(rimLight)
  // Resources shared by every graph the renderer shows; disposed only with the scene.
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const ownGeometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.add(g); return g }
  const ownMaterial = <T extends THREE.Material>(m: T): T => { materials.add(m); return m }
  const nodeGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1))
  const ringGeometry = ownGeometry(new THREE.TorusGeometry(4.4, 0.035, 5, 64))
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(0.68, 1.9, 6))
  const up = new THREE.Vector3(0, 1, 0)
  const selectionMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color('#66cadd'), transparent: true, opacity: 0.65, depthWrite: false }))
  const selectionRing = new THREE.Mesh(ringGeometry, selectionMaterial)
  const selectionRing2 = new THREE.Mesh(ringGeometry, selectionMaterial)
  selectionRing.visible = false; selectionRing2.visible = false
  selectionRing2.scale.setScalar(1.2)
  scene.add(selectionRing, selectionRing2)
  // Soft halos supplement bloom without an expensive full-screen blur for each node.
  const haloCanvas = document.createElement('canvas')
  haloCanvas.width = 64; haloCanvas.height = 64
  const haloContext = haloCanvas.getContext('2d')!
  const gradient = haloContext.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,.6)')
  gradient.addColorStop(0.2, 'rgba(255,255,255,.15)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  haloContext.fillStyle = gradient; haloContext.fillRect(0, 0, 64, 64)
  const haloTexture = new THREE.CanvasTexture(haloCanvas)
  textures.add(haloTexture)

  // Everything below depends on the graph and is rebuilt by buildGraph in the same renderer.
  let vectorPositions = new Map<string, THREE.Vector3>()
  let radius = 22
  const nodeMeshes = new Map<string, THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>>()
  const halos = new Map<string, THREE.Sprite>()
  const pickObjects: THREE.Object3D[] = []
  const edgeObjects = new Map<string, { curve: THREE.Curve<THREE.Vector3>; material: THREE.MeshBasicMaterial; arrow: THREE.Mesh; pick: THREE.Line }>()
  let particleEdges: readonly Graph3DEdge[] = []
  let particlePositions = new Float32Array(0)
  let particleGeometry = new THREE.BufferGeometry()
  let particles = new THREE.Points()
  let content = new THREE.Group()
  const contentGeometries = new Set<THREE.BufferGeometry>()
  const contentMaterials = new Set<THREE.Material>()
  const ownContentGeometry = <T extends THREE.BufferGeometry>(g: T): T => { contentGeometries.add(g); return g }
  const ownContentMaterial = <T extends THREE.Material>(m: T): T => { contentMaterials.add(m); return m }
  const disposeContent = () => {
    content.removeFromParent()
    contentGeometries.forEach(g => g.dispose()); contentMaterials.forEach(m => m.dispose())
    contentGeometries.clear(); contentMaterials.clear()
    nodeMeshes.clear(); halos.clear(); edgeObjects.clear(); pickObjects.length = 0
  }
  const buildGraph = (nextNodes: readonly Graph3DNode[], nextEdges: readonly Graph3DEdge[], remembered?: Record<string, { x: number; y: number; z: number }>) => {
  disposeContent()
  content = new THREE.Group()
  scene.add(content)
  nodes = nextNodes
  nodeIds = new Set(nodes.map(n => n.id))
  edges = nextEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
  const positions = layoutGraph(nodes, edges)
  if (remembered && nodes.some(node => remembered[node.id] !== undefined)) {
    const placed: THREE.Vector3[] = []
    const anchors = new Map<string, THREE.Vector3>()
    for (const node of nodes) {
      const point = remembered[node.id]
      if (point && [point.x, point.y, point.z].every(Number.isFinite)) {
        positions.set(node.id, { ...point })
        const position = new THREE.Vector3(point.x, point.y, point.z)
        anchors.set(node.id, position); placed.push(position)
      }
    }
    for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (anchors.has(node.id)) continue
      const connections = edges.flatMap(edge => edge.source === node.id && anchors.has(edge.target) ? [anchors.get(edge.target)!] : edge.target === node.id && anchors.has(edge.source) ? [anchors.get(edge.source)!] : [])
      const centre = connections.length ? connections.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(connections.length) : new THREE.Vector3()
      let candidate = new THREE.Vector3()
      for (let attempt = 0; attempt < 30; attempt++) {
        const seed = hashKey(`${node.id}:${attempt}`)
        const angle = (seed % 6283) / 1000
        const y = ((seed >>> 10) % 1600) / 1000 - 0.8
        const direction = new THREE.Vector3(Math.cos(angle), y, Math.sin(angle)).normalize()
        candidate = centre.clone().addScaledVector(direction, 20 + Math.floor(attempt / 5) * 8)
        if (!placed.some(point => point.distanceToSquared(candidate) < 13 * 13)) break
      }
      positions.set(node.id, { x: candidate.x, y: candidate.y, z: candidate.z })
      anchors.set(node.id, candidate); placed.push(candidate)
    }
  }
  vectorPositions = new Map([...positions].map(([id, p]) => [id, new THREE.Vector3(p.x, p.y, p.z)]))
  radius = Math.max(22, ...[...vectorPositions.values()].map(p => p.length() + 8))
  const degrees = new Map<string, number>()
  edges.forEach(e => { degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1); degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1) })
  for (const node of nodes) {
    const color = typeColor(node.typeKey)
    const material = ownContentMaterial(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.14, metalness: 0.28, roughness: 0.58, flatShading: true, transparent: true }))
    const mesh = new THREE.Mesh(nodeGeometry, material)
    mesh.position.copy(vectorPositions.get(node.id)!)
    const size = 2.3 + Math.min(1.8, Math.log2(1 + (degrees.get(node.id) ?? 0)) * 0.42)
    mesh.scale.setScalar(size)
    mesh.rotation.set(hashKey(node.id) / 1000, hashKey(node.typeKey) / 700, 0.3)
    mesh.userData = { kind: 'node', id: node.id }
    content.add(mesh); nodeMeshes.set(node.id, mesh); pickObjects.push(mesh)
    const halo = new THREE.Sprite(ownContentMaterial(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })))
    halo.position.copy(mesh.position); halo.scale.setScalar(size * 6.5)
    content.add(halo); halos.set(node.id, halo)
  }
  const lanes = edgeLanes(edges)
  for (const edge of edges) {
    const source = vectorPositions.get(edge.source)!, target = vectorPositions.get(edge.target)!
    const lane = lanes.get(edge.id) ?? 0
    let curve: THREE.Curve<THREE.Vector3>
    if (edge.source === edge.target) {
      const spread = 9 + Math.abs(lane) * 4
      const angle = lane * 0.8 + hashKey(edge.id) % 5
      const side = new THREE.Vector3(Math.cos(angle), 0.35, Math.sin(angle)).normalize()
      curve = new THREE.CubicBezierCurve3(source.clone().addScaledVector(side, 1.5), source.clone().addScaledVector(side, spread * 2).add(new THREE.Vector3(0, spread, 0)), source.clone().addScaledVector(side, -spread).add(new THREE.Vector3(0, spread * 2, 0)), source.clone().add(new THREE.Vector3(0, 2, 0)))
    } else {
      // Canonical orientation gives reciprocal relations distinct, stable lanes.
      const canonical = edge.source < edge.target ? target.clone().sub(source) : source.clone().sub(target)
      let perpendicular = new THREE.Vector3().crossVectors(canonical, up)
      if (perpendicular.lengthSq() < 0.01) perpendicular = new THREE.Vector3(1, 0, 0)
      perpendicular.normalize()
      const midpoint = source.clone().add(target).multiplyScalar(0.5)
      midpoint.addScaledVector(perpendicular, lane * 10 + (lane === 0 ? 3 : 0))
      midpoint.y += Math.min(8, source.distanceTo(target) * 0.06)
      curve = new THREE.QuadraticBezierCurve3(source, midpoint, target)
    }
    const color = edge.parent ? '#c5a4ff' : '#58b5cc'
    const material = ownContentMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.6, depthWrite: false }))
    const tube = new THREE.Mesh(ownContentGeometry(new THREE.TubeGeometry(curve, edges.length > 800 ? 12 : 28, edge.parent ? 0.13 : 0.1, 4, false)), material)
    content.add(tube)
    const arrow = new THREE.Mesh(coneGeometry, material)
    arrow.position.copy(curve.getPoint(0.78))
    arrow.quaternion.setFromUnitVectors(up, curve.getTangent(0.78).normalize())
    content.add(arrow)
    const pick = new THREE.Line(ownContentGeometry(new THREE.BufferGeometry().setFromPoints(curve.getPoints(28))), ownContentMaterial(new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })))
    pick.userData = { kind: 'edge', id: edge.id }
    content.add(pick); pickObjects.push(pick)
    edgeObjects.set(edge.id, { curve, material, arrow, pick })
  }
  particleEdges = edges.slice(0, 1500)
  particlePositions = new Float32Array(particleEdges.length * 3)
  particleGeometry = ownContentGeometry(new THREE.BufferGeometry())
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  particles = new THREE.Points(particleGeometry, ownContentMaterial(new THREE.PointsMaterial({ color: '#9ce3ed', size: 0.7, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, map: haloTexture })))
  particles.frustumCulled = false
  content.add(particles)
  // A quiet spatial frame and distant stars make depth legible while preserving the graph.
  const starPositions = new Float32Array(900 * 3)
  for (let i = 0; i < 900; i++) {
    const seed = hashKey(`star-${i}`)
    const angle = (seed % 6283) / 1000
    const y = ((seed >>> 8) % 2000) / 1000 - 1
    const distance = Math.max(250, radius * 3) + (seed % 300)
    const r = Math.sqrt(1 - y * y)
    starPositions[i * 3] = Math.cos(angle) * r * distance
    starPositions[i * 3 + 1] = y * distance
    starPositions[i * 3 + 2] = Math.sin(angle) * r * distance
  }
  const starGeometry = ownContentGeometry(new THREE.BufferGeometry())
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const stars = new THREE.Points(starGeometry, ownContentMaterial(new THREE.PointsMaterial({ color: '#809cc4', size: 0.65, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false })))
  content.add(stars)
  const grid = new THREE.GridHelper(Math.max(250, radius * 3), 30, '#34516c', '#182b42')
  grid.position.y = -radius * 0.8 - 16
  const gridMaterial = grid.material as THREE.LineBasicMaterial
  gridMaterial.transparent = true; gridMaterial.opacity = 0.16; gridMaterial.depthWrite = false
  contentGeometries.add(grid.geometry); contentMaterials.add(gridMaterial)
  content.add(grid)
  stylesDirty = true
  lastLabels = 0
  wake()
  }

  let cameraFlight: { start: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3 } | null = null
  const moveTo = (position: THREE.Vector3, target: THREE.Vector3) => {
    if (options.reducedMotion || !animated) {
      camera.position.copy(position); controls.target.copy(target); camera.lookAt(target); controls.update()
      cameraFlight = null; wake()
    } else cameraFlight = { start: performance.now(), from: camera.position.clone(), to: position, targetFrom: controls.target.clone(), targetTo: target }
  }
  const fit = () => {
    const aspect = Math.max(0.4, camera.aspect)
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, aspect) * 1.08
    moveTo(new THREE.Vector3(distance * 0.53, distance * 0.35, distance * 0.79), new THREE.Vector3())
  }
  const focus = (id: string) => {
    const position = vectorPositions.get(id)
    if (!position) return
    const direction = camera.position.clone().sub(position).normalize()
    if (direction.lengthSq() < 0.1) direction.set(0.4, 0.25, 1).normalize()
    moveTo(position.clone().addScaledVector(direction, 40), position)
  }
  const focusEdge = (id: string) => {
    const relation = edgeObjects.get(id)
    if (!relation) return
    const bounds = new THREE.Box3().setFromPoints(relation.curve.getPoints(24))
    const centre = bounds.getCenter(new THREE.Vector3())
    const halfExtent = bounds.getSize(new THREE.Vector3()).length() / 2 + 5
    const distance = Math.max(26, halfExtent / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, Math.max(0.4, camera.aspect)) * 1.15)
    const direction = camera.position.clone().sub(centre).normalize()
    if (direction.lengthSq() < 0.1) direction.set(0.4, 0.25, 1).normalize()
    moveTo(centre.clone().addScaledVector(direction, distance), centre)
  }
  buildGraph(options.nodes, options.edges, options.previousPositions)
  camera.position.set(radius * 1.8, radius * 1.3, radius * 2.8)
  controls.target.set(0, 0, 0); camera.lookAt(controls.target)
  const resize = () => {
    const width = mount.clientWidth, height = mount.clientHeight
    if (!width || !height) return
    camera.aspect = width / height; camera.updateProjectionMatrix()
    renderer.setSize(width, height, false); composer.setSize(width, height)
    wake()
  }
  resize()
  fit()
  const observer = new ResizeObserver(resize)
  observer.observe(mount)
  const neighbours = new Set<string>()
  const paletteObserver = new MutationObserver(() => { stylesDirty = true; wake() })
  paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  const updateStyles = () => {
    neighbours.clear()
    if (selectedNode) {
      neighbours.add(selectedNode)
      edges.forEach(e => { if (e.source === selectedNode || e.target === selectedNode) { neighbours.add(e.source); neighbours.add(e.target) } })
    }
    for (const node of nodes) {
      const mesh = nodeMeshes.get(node.id)!
      const dim = node.dimmed || (focused && selectedNode && !neighbours.has(node.id))
      const color = typeColor(node.typeKey)
      mesh.material.color.set(color)
      mesh.material.emissive.set(color)
      mesh.material.opacity = dim ? 0.12 : 1
      mesh.material.emissiveIntensity = node.id === selectedNode ? 0.32 : node.highlighted ? 0.26 : 0.14
      const halo = halos.get(node.id)!
      ;(halo.material as THREE.SpriteMaterial).color.set(color)
      ;(halo.material as THREE.SpriteMaterial).opacity = dim ? 0.025 : node.id === selectedNode ? 0.32 : 0.22
    }
    for (const edge of edges) {
      const object = edgeObjects.get(edge.id)!
      const connected = edge.source === selectedNode || edge.target === selectedNode
      const dim = edge.dimmed || (focused && selectedNode && !connected)
      object.material.opacity = dim ? 0.045 : edge.id === selectedEdge ? 0.95 : connected ? 0.85 : 0.6
      object.material.color.set(edge.id === selectedEdge ? '#efd08b' : connected ? '#72cddd' : edge.parent ? '#b794ed' : '#58b5cc')
      object.arrow.scale.setScalar(edge.id === selectedEdge ? 1.6 : 1)
    }
    selectionRing.visible = selectedNode !== null && vectorPositions.has(selectedNode)
    selectionRing2.visible = selectionRing.visible
    if (selectedNode && vectorPositions.has(selectedNode)) {
      selectionRing.position.copy(vectorPositions.get(selectedNode)!)
      selectionRing2.position.copy(selectionRing.position)
      const coreSize = nodeMeshes.get(selectedNode)!.scale.x
      selectionRing.scale.setScalar(coreSize * 1.35 / 4.4)
      selectionRing2.scale.setScalar(coreSize * 1.6 / 4.4)
    }
    stylesDirty = false
  }
  let hoveredEdge: string | null = null
  const relationLabel = document.createElement('div')
  relationLabel.className = 'graph3d-relation-label'
  relationLabel.hidden = true
  labels.appendChild(relationLabel)
  const slots = Array.from({ length: 22 }, () => {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'graph3d-label'; button.hidden = true
    const name = document.createElement('span'); name.className = 'graph3d-label-name'
    const meta = document.createElement('span'); meta.className = 'graph3d-label-meta'
    const detail = document.createElement('span'); detail.className = 'graph3d-label-detail'
    button.append(name, meta, detail); labels.appendChild(button)
    button.addEventListener('click', e => { e.stopPropagation(); const id = button.dataset.id; if (id) options.onSelectNode(id) })
    button.addEventListener('dblclick', e => { e.stopPropagation(); const id = button.dataset.id; if (id) focus(id) })
    return { button, name, meta, detail }
  })
  const projected = new THREE.Vector3()
  const labelPosition = new THREE.Vector3()
  const updateLabels = (now: number) => {
    if (now - lastLabels < 80) return
    lastLabels = now
    const width = mount.clientWidth, height = mount.clientHeight
    const relation = edges.find(edge => edge.id === (hoveredEdge || selectedEdge))
    relationLabel.hidden = true
    if (relation) {
      projected.copy(edgeObjects.get(relation.id)!.curve.getPoint(0.5)).project(camera)
      if (projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.85) {
        relationLabel.hidden = false
        relationLabel.textContent = `${relation.label} →`
        relationLabel.style.transform = `translate(${(projected.x + 1) / 2 * width}px,${(1 - projected.y) / 2 * height - 10}px) translate(-50%,-100%)`
      }
    }
    const candidates = nodes.flatMap(node => {
      if ((node.dimmed || focused && selectedNode && !neighbours.has(node.id)) && node.id !== selectedNode) return []
      const position = vectorPositions.get(node.id)!
      labelPosition.copy(position).add(new THREE.Vector3(0, 5, 0))
      projected.copy(labelPosition).project(camera)
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 0.92 || Math.abs(projected.y) > 0.85) return []
      const distance = camera.position.distanceTo(position)
      return [{ node, distance, x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height, priority: node.id === selectedNode ? -1e6 : distance + (projected.x * projected.x + projected.y * projected.y) * 28 }]
    }).sort((a, b) => a.priority - b.priority)
    const placed: { x: number; y: number; height: number }[] = []
    let slotIndex = 0
    for (const item of candidates) {
      if (slotIndex >= slots.length) break
      const near = item.distance < 53 || item.node.id === selectedNode
      const labelHeight = near && (item.node.properties?.length || item.node.description) ? 72 : 39
      if (item.node.id !== selectedNode && placed.some(p => Math.abs(p.x - item.x) < 155 && Math.abs(p.y - item.y) < Math.max(labelHeight, p.height))) continue
      placed.push({ x: item.x, y: item.y, height: labelHeight })
      const slot = slots[slotIndex++]
      slot.button.hidden = false; slot.button.dataset.id = item.node.id
      slot.button.style.transform = `translate(${item.x}px,${item.y}px) translate(-50%,-100%)`
      slot.button.style.setProperty('--node-color', `color-mix(in oklab, ${getTypeColor(item.node.typeKey).cssVar} 70%, white 30%)`)
      slot.button.classList.toggle('is-selected', item.node.id === selectedNode)
      slot.name.textContent = item.node.label
      slot.meta.textContent = item.node.subtitle || item.node.typeKey
      slot.detail.hidden = !near
      slot.detail.textContent = near ? item.node.properties?.slice(0, 2).map(p => `${p.label}: ${p.value}`).join(' · ') || item.node.description || '' : ''
    }
    for (let i = slotIndex; i < slots.length; i++) slots[i].button.hidden = true
  }

  const raycaster = new THREE.Raycaster()
  raycaster.params.Line.threshold = 1.1
  const pointer = new THREE.Vector2()
  let pointerDown: { x: number; y: number } | null = null
  let dragged = false
  let hovered: string | null = null
  const keys = new Set<string>()
  const onDown = (event: PointerEvent) => {
    canvas.focus({ preventScroll: true })
    pointerDown = { x: event.clientX, y: event.clientY }; dragged = false
    if (fly) canvas.setPointerCapture(event.pointerId)
    cameraFlight = null
    if (touring) { touring = false; options.onNavigation() }
  }
  const hitAt = (x: number, y: number) => {
    const bounds = canvas.getBoundingClientRect()
    pointer.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObjects(pickObjects, false).find(hit => {
      const data = hit.object.userData
      return !(focused && selectedNode && (data.kind === 'node' ? !neighbours.has(data.id) : !edges.some(e => e.id === data.id && (e.source === selectedNode || e.target === selectedNode))))
    })
  }
  const onMove = (event: PointerEvent) => {
    wake()
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) dragged = true
    if (fly && pointerDown && event.buttons === 1) {
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      euler.y -= event.movementX * 0.003
      euler.x = THREE.MathUtils.clamp(euler.x - event.movementY * 0.003, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03)
      euler.z = 0; camera.quaternion.setFromEuler(euler)
      controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(25))
    }
    if (pointerDown) return
    const hit = hitAt(event.clientX, event.clientY)
    const next = hit?.object.userData.kind === 'node' ? String(hit.object.userData.id) : null
    hoveredEdge = hit?.object.userData.kind === 'edge' ? String(hit.object.userData.id) : null
    canvas.style.cursor = hit ? 'pointer' : fly ? 'crosshair' : 'grab'
    if (hovered !== next) { hovered = next; options.onHoverNode(next) }
  }
  const onUp = (event: PointerEvent) => {
    const canSelect = pointerDown && !dragged && event.button === 0
    pointerDown = null
    if (!canSelect) return
    const hit = hitAt(event.clientX, event.clientY)
    if (hit?.object.userData.kind === 'node') options.onSelectNode(String(hit.object.userData.id))
    else if (hit?.object.userData.kind === 'edge') options.onSelectEdge(String(hit.object.userData.id), { x: event.clientX, y: event.clientY })
    else options.onSelectNode(null)
  }
  const onDouble = (event: MouseEvent) => {
    const hit = hitAt(event.clientX, event.clientY)
    if (hit?.object.userData.kind === 'node') focus(String(hit.object.userData.id))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && fly) { event.preventDefault(); event.stopPropagation(); keys.clear(); fly = false; controls.enabled = true; options.onNavigation(); return }
    if (!fly || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return
    event.preventDefault(); event.stopPropagation(); keys.add(event.code); cameraFlight = null; wake()
  }
  const onKeyUp = (event: KeyboardEvent) => { keys.delete(event.code) }
  const onBlur = () => { keys.clear(); pointerDown = null }
  const onLeave = () => { wake(); if (hovered) options.onHoverNode(null); hovered = null; hoveredEdge = null }
  const onContextLost = (event: Event) => { event.preventDefault(); options.onError() }
  const onControlStart = () => { cameraFlight = null; if (touring) { touring = false; options.onNavigation() } }
  controls.addEventListener('start', onControlStart)
  controls.addEventListener('change', wake)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointercancel', onBlur)
  canvas.addEventListener('dblclick', onDouble)
  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('blur', onBlur)
  canvas.addEventListener('webglcontextlost', onContextLost)
  let visible = true
  const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true })
  visibilityObserver.observe(mount)
  const clock = new THREE.Clock()
  let elapsed = 0
  let frameId = 0
  let tourIndex = 0, lastTour = -1e6
  const localMove = new THREE.Vector3()
  const sample = new THREE.Vector3()
  const frame = (now: number) => {
    if (disposed) return
    frameId = requestAnimationFrame(frame)
    const delta = Math.min(clock.getDelta(), 0.05)
    if (document.hidden || !visible) return
    if (!fly) controls.update()
    if (!animated && !cameraFlight && !stylesDirty && !(fly && keys.size) && now > renderUntil) return
    if (animated) elapsed += delta
    if (stylesDirty) updateStyles()
    if (cameraFlight) {
      const t = Math.min(1, (now - cameraFlight.start) / 1250)
      const ease = t * t * (3 - 2 * t)
      camera.position.lerpVectors(cameraFlight.from, cameraFlight.to, ease)
      controls.target.lerpVectors(cameraFlight.targetFrom, cameraFlight.targetTo, ease)
      camera.lookAt(controls.target)
      if (t >= 1) cameraFlight = null
    } else if (fly) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 65 : 22) * delta
      localMove.set(Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')), Number(keys.has('KeyE')) - Number(keys.has('KeyQ')), Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')))
      if (localMove.lengthSq()) {
        localMove.normalize().applyQuaternion(camera.quaternion).multiplyScalar(speed)
        camera.position.add(localMove); controls.target.add(localMove)
      }
    }
    if (touring && animated && nodes.length) {
      if (now - lastTour > 6000) {
        const node = nodes[tourIndex++ % nodes.length]
        focus(node.id); lastTour = now
      } else if (!cameraFlight) {
        const offset = camera.position.clone().sub(controls.target)
        offset.applyAxisAngle(up, delta * 0.06)
        camera.position.copy(controls.target).add(offset)
      }
    }
    if (animated) {
      selectionRing.rotation.set(elapsed * 0.25, elapsed * 0.17, elapsed * 0.1)
      selectionRing2.rotation.set(Math.PI / 2 + elapsed * 0.1, -elapsed * 0.22, 0)
    }
    particles.visible = animated
    if (animated) {
      particleEdges.forEach((edge, i) => {
        const object = edgeObjects.get(edge.id)!
        object.curve.getPoint((elapsed * 0.13 + (hashKey(edge.id) % 1000) / 1000) % 1, sample)
        particlePositions[i * 3] = sample.x; particlePositions[i * 3 + 1] = sample.y; particlePositions[i * 3 + 2] = sample.z
      })
      particleGeometry.attributes.position.needsUpdate = true
    }
    updateLabels(now)
    // Re-evaluate label membership sparingly, but keep anchors locked to the scene at display rate.
    for (const slot of slots) {
      const id = slot.button.dataset.id
      if (slot.button.hidden || !id) continue
      projected.copy(vectorPositions.get(id)!).add(new THREE.Vector3(0, 5, 0)).project(camera)
      slot.button.style.transform = `translate(${(projected.x + 1) / 2 * mount.clientWidth}px,${(1 - projected.y) / 2 * mount.clientHeight}px) translate(-50%,-100%)`
    }
    const labelledEdge = hoveredEdge || selectedEdge
    if (!relationLabel.hidden && labelledEdge && edgeObjects.has(labelledEdge)) {
      projected.copy(edgeObjects.get(labelledEdge)!.curve.getPoint(0.5)).project(camera)
      relationLabel.style.transform = `translate(${(projected.x + 1) / 2 * mount.clientWidth}px,${(1 - projected.y) / 2 * mount.clientHeight - 10}px) translate(-50%,-100%)`
    }
    composer.render()
  }
  frameId = requestAnimationFrame(frame)
  return {
    fit, focus, focusEdge,
    getView() { return { position: camera.position.toArray(), target: controls.target.toArray(), nodePositions: Object.fromEntries([...vectorPositions].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z }])) } },
    restoreView(view) { cameraFlight = null; camera.position.fromArray(view.position); controls.target.fromArray(view.target); camera.lookAt(controls.target); controls.update(); wake() },
    setGraph(nextNodes, nextEdges) { buildGraph(nextNodes, nextEdges, Object.fromEntries([...vectorPositions].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z }]))) },
    updateData(nextNodes, nextEdges) { nodes = nextNodes; edges = nextEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)); stylesDirty = true; lastLabels = 0; wake() },
    select(nodeId, edgeId) { selectedNode = nodeId; selectedEdge = edgeId; stylesDirty = true; lastLabels = 0; wake() },
    setFly(value) { fly = value; controls.enabled = !value; keys.clear(); if (value) { touring = false; canvas.focus({ preventScroll: true }) } },
    setFocus(value) { focused = value; stylesDirty = true; lastLabels = 0; wake() },
    setAnimated(value) { animated = value; wake(); if (!value) { touring = false; if (cameraFlight) { camera.position.copy(cameraFlight.to); controls.target.copy(cameraFlight.targetTo); camera.lookAt(controls.target); cameraFlight = null } } },
    setTour(value) { touring = value; if (value) { fly = false; controls.enabled = true; animated = true; lastTour = -1e6 } },
    dispose() {
      disposed = true
      cancelAnimationFrame(frameId)
      observer.disconnect(); visibilityObserver.disconnect(); paletteObserver.disconnect(); controls.dispose()
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('pointercancel', onBlur); canvas.removeEventListener('dblclick', onDouble)
      canvas.removeEventListener('keydown', onKeyDown); canvas.removeEventListener('keyup', onKeyUp); canvas.removeEventListener('blur', onBlur); canvas.removeEventListener('webglcontextlost', onContextLost)
      controls.removeEventListener('start', onControlStart); controls.removeEventListener('change', wake)
      disposeContent()
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose())
      bloom.dispose(); output.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss()
      canvas.remove(); relationLabel.remove(); slots.forEach(slot => slot.button.remove())
    },
  }
}
