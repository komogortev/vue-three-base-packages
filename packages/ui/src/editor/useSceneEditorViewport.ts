import { ref, onMounted, onUnmounted, shallowReadonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneEditorConfig, EditorSelection, EditorPlacedObject, EditorCamMode } from './sceneEditorTypes'
import type { SavedPlacedObject } from './sandboxSceneSchema'
export type { EditorCamMode } from './sceneEditorTypes'

/** A saved placed object with its blob URL resolved — input to restorePlacedObjects. */
export type RestorableObject = SavedPlacedObject & { blobUrl: string }

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransformMode = 'translate' | 'rotate' | 'scale'

interface PlaceMode {
  active: boolean
  objectId: string
  assetId: string
  blobUrl: string
  label: string
}

const PLACE_MODE_IDLE: PlaceMode = { active: false, objectId: '', assetId: '', blobUrl: '', label: '' }

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SceneEditorViewportReturn {
  isReady: Readonly<Ref<boolean>>
  statusMessage: Readonly<Ref<string>>
  selection: Readonly<Ref<EditorSelection>>
  transformMode: Readonly<Ref<TransformMode>>
  /** Current camera / player mode — orbit | follow-3p | free-float. */
  editorCamMode: Readonly<Ref<EditorCamMode>>
  /** Live list of placed objects — reactive, readable by hierarchy. */
  placedObjects: Readonly<Ref<EditorPlacedObject[]>>
  /** True while waiting for a floor click to place an asset. */
  isInPlaceMode: Readonly<Ref<boolean>>
  /** Live NPC world positions — updated every TC objectChange tick. */
  npcLivePositions: Readonly<Ref<Map<string, { x: number; y: number; z: number }>>>
  /** Live zone world positions — updated every TC objectChange tick. */
  zoneLivePositions: Readonly<Ref<Map<string, { x: number; z: number }>>>
  /** Set selection from the hierarchy panel (bypasses click raycasting). */
  setSelection: (s: EditorSelection) => void
  /** Set the active TransformControls mode (translate / rotate / scale). */
  setTransformMode: (mode: TransformMode) => void
  setPathEditMode: (active: boolean, onFloorHit?: (pos: THREE.Vector3) => void) => void
  updateNpcPath: (entityId: string, waypoints: THREE.Vector3[]) => void
  clearNpcPath: (entityId: string) => void
  reinitScene: (newConfig: SceneEditorConfig) => Promise<void>
  enterPlaceMode: (objectId: string, assetId: string, blobUrl: string, label: string) => void
  exitPlaceMode: () => void
  snapshotPlacedTransforms: () => EditorPlacedObject[]
  restorePlacedObjects: (objects: RestorableObject[]) => Promise<void>
  setCamMode: (mode: EditorCamMode) => void
  /** Move an NPC marker programmatically (from inspector inputs). */
  setNpcPosition: (entityId: string, x: number, z: number) => void
  /** Move a zone marker programmatically (from inspector inputs). */
  setZonePosition: (id: string, x: number, z: number) => void
  /** Add a new NPC marker at runtime (F-11). */
  addNpcMarker: (npc: import('./sceneEditorTypes').EditorNpcEntry) => void
  /** Remove an NPC marker at runtime (F-11). */
  removeNpcMarker: (entityId: string) => void
  /** Add a new zone marker at runtime (F-11). */
  addZoneMarker: (zone: import('./sceneEditorTypes').EditorZoneEntry) => void
  /** Remove a zone marker at runtime (F-11). */
  removeZoneMarker: (id: string) => void
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useSceneEditorViewport(opts: {
  canvas: Ref<HTMLCanvasElement | null>
  config: SceneEditorConfig
  /** Called when Esc cancels path-edit mode from inside the viewport. */
  onPathEditCancel?: () => void
}): SceneEditorViewportReturn {
  const { canvas: canvasRef } = opts

  // Mutable config — updated by reinitScene
  let config: SceneEditorConfig = opts.config

  const isReady = ref(false)
  const statusMessage = ref('Initializing…')
  const selection = ref<EditorSelection>(null)
  const transformMode = ref<TransformMode>('translate')
  const placedObjects = ref<EditorPlacedObject[]>([])
  const isInPlaceMode = ref(false)

  // Three.js core — created once, kept alive across scene switches
  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let controls: OrbitControls
  let transformControls: TransformControls
  let raycaster: THREE.Raycaster
  let animId: number

  // Scene-specific objects — cleared on each scene switch
  let floorMeshes: THREE.Object3D[] = []
  let sceneObjects: THREE.Object3D[] = []  // all scene-level objects added per config

  // Marker groups — cleared and rebuilt on scene switch
  const npcMarkerGroup = new THREE.Group()
  const zoneMarkerGroup = new THREE.Group()
  const pathGroup = new THREE.Group()

  // Placed objects group — persistent container, children cleared on scene switch
  const placedGroup = new THREE.Group()
  // objectId → Three.js root group (for TC attachment)
  const placedMeshRoots = new Map<string, THREE.Group>()
  // objectId → invisible hit box mesh (for raycasting)
  const placedHitBoxes = new Map<string, THREE.Mesh>()

  // Place mode state — plain object (not reactive; status + isInPlaceMode carry the UI signal)
  let placeMode: PlaceMode = { ...PLACE_MODE_IDLE }

  // Selection maps: entityId/zoneId → clickable mesh (for raycasting + highlight)
  const npcSpheres = new Map<string, THREE.Mesh>()
  const zoneRingPips = new Map<string, THREE.Mesh>()

  // Per-NPC root groups — used for TransformControls attachment so all parts move together
  const npcMarkerRoots = new Map<string, THREE.Group>()

  // Per-zone root groups — ring + pip grouped so TC moves both together
  const zoneMarkerRoots = new Map<string, THREE.Group>()

  // Live positions — updated by TC objectChange; drives inspector two-way binding
  const npcLivePositions = ref<Map<string, { x: number; y: number; z: number }>>(new Map())
  const zoneLivePositions = ref<Map<string, { x: number; z: number }>>(new Map())

  // Per-NPC path visualization
  const npcPathViz = new Map<string, { line: THREE.Line; dots: THREE.Group }>()

  // Shared geometries (disposed on component unmount, not on scene switch)
  const npcSphereGeo = new THREE.SphereGeometry(0.35, 12, 8)
  const dotGeo = new THREE.SphereGeometry(0.12, 8, 6)

  // Drag detection
  let mouseDownX = 0
  let mouseDownY = 0

  // Gizmo interaction flag — prevents onMouseUp from deselecting after gizmo click
  let gizmoMouseDown = false

  // Path-edit mode
  let pathEditActive = false
  let onFloorHitCb: ((pos: THREE.Vector3) => void) | undefined

  // ─── Player & camera mode ─────────────────────────────────────────────────
  const editorCamMode = ref<EditorCamMode>('orbit')

  // Camera at player eye level — capsule center y=0.9, eye y≈1.65 from ground
  const FPV_EYE_OFFSET = 0.75

  // Player capsule proxy (no character GLB dependency for D-5)
  let playerMesh: THREE.Mesh | null = null

  // Delta time
  const clock = new THREE.Clock()

  // Keys currently held (WASD + modifiers); polled each frame for smooth movement
  const keyState = new Set<string>()

  // Free-float camera state (mirrors D-1 PlayerCameraCoordinator pattern)
  let ffYaw = 0
  let ffPitch = 0
  const ffPos = new THREE.Vector3()
  let ffPointerLocked = false

  // ─── Init ───────────────────────────────────────────────────────────────────
  // Creates renderer/camera/controls/lights once. Then calls loadScene().

  async function init(): Promise<void> {
    const canvas = canvasRef.value
    if (!canvas) return

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#12182b')
    scene.fog = new THREE.Fog('#12182b', 60, 110)

    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 160)
    camera.position.set(0, 22, 34)

    controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 3, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.update()

    raycaster = new THREE.Raycaster()

    // ── TransformControls ────────────────────────────────────────────────────
    // r170+: TransformControls extends Controls, not Object3D — add getHelper() to the scene.
    transformControls = new TransformControls(camera, canvas)
    transformControls.setMode('translate')
    // Disabled until an object is selected — prevents TC stealing pointer from OrbitControls.
    transformControls.enabled = false
    scene.add(transformControls.getHelper())

    // Set gizmo flag so onMouseUp skips selection logic when user clicks a gizmo handle.
    // Reset on TC's own mouseUp so the flag doesn't stick if the drag ends off-canvas.
    transformControls.addEventListener('mouseDown', () => { gizmoMouseDown = true })
    transformControls.addEventListener('mouseUp', () => { gizmoMouseDown = false })

    // Disable OrbitControls while gizmo dragged.
    transformControls.addEventListener('dragging-changed', (e) => {
      controls.enabled = !(e as unknown as { value: boolean }).value
    })

    // Enforce uniform scale in scale mode + sync live positions for inspector reactivity.
    transformControls.addEventListener('objectChange', () => {
      if (transformMode.value === 'scale') {
        const obj = transformControls.object
        if (obj) { const s = obj.scale.x; obj.scale.set(s, s, s) }
      }
      const sel = selection.value
      if (sel?.kind === 'npc') {
        const root = npcMarkerRoots.get(sel.entityId)
        if (root) {
          const next = new Map(npcLivePositions.value)
          next.set(sel.entityId, { x: root.position.x, y: root.position.y, z: root.position.z })
          npcLivePositions.value = next
        }
      } else if (sel?.kind === 'zone') {
        const root = zoneMarkerRoots.get(sel.id)
        if (root) {
          const next = new Map(zoneLivePositions.value)
          next.set(sel.id, { x: root.position.x, z: root.position.z })
          zoneLivePositions.value = next
        }
      }
    })

    // Lighting — editor-neutral, persistent across scene switches
    scene.add(new THREE.AmbientLight('#c8d8f0', 0.65))
    const sun = new THREE.DirectionalLight('#fff5e0', 1.3)
    sun.position.set(10, 20, 10)
    scene.add(sun)

    // Grid — persistent reference plane
    scene.add(new THREE.GridHelper(100, 100, '#1a2d4a', '#0e1622'))

    // Marker groups are persistent containers — their children are rebuilt per scene
    scene.add(npcMarkerGroup)
    scene.add(zoneMarkerGroup)
    scene.add(pathGroup)
    scene.add(placedGroup)

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    window.addEventListener('resize', onResize)

    initPlayer()
    animate()

    await loadScene(config)
  }

  // ─── Scene loading ───────────────────────────────────────────────────────────
  // Loads GLBs, builds markers, adds invisible floor plane when no GLB is given.

  async function loadScene(cfg: SceneEditorConfig): Promise<void> {
    isReady.value = false
    statusMessage.value = 'Loading scene…'
    selection.value = null
    pathEditActive = false
    onFloorHitCb = undefined

    if (cfg.floorGlbUrl) {
      await loadGLB(cfg.floorGlbUrl, /* isFloor */ true)
    } else {
      // Sandbox / procedural scene — use a large invisible plane as the raycast surface
      const planeGeo = new THREE.PlaneGeometry(200, 200)
      planeGeo.rotateX(-Math.PI / 2)
      const planeMesh = new THREE.Mesh(
        planeGeo,
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
      )
      planeMesh.position.set(0, 0, 0)
      scene.add(planeMesh)
      floorMeshes.push(planeMesh)
      sceneObjects.push(planeMesh)
    }

    for (const url of cfg.contextGlbUrls ?? []) {
      await loadGLB(url, false)
    }

    buildNpcMarkers(cfg)
    buildZoneMarkers(cfg)
    buildSpawnMarker(cfg)

    isReady.value = true
    statusMessage.value = sceneStatus(cfg)
  }

  // ─── Scene clearing (before scene switch) ────────────────────────────────────

  function clearScene(): void {
    // Detach gizmo before clearing objects it may reference
    transformControls.detach()
    transformControls.enabled = false

    // Cancel place mode
    placeMode = { ...PLACE_MODE_IDLE }
    isInPlaceMode.value = false

    // Remove all objects added during loadScene
    for (const obj of sceneObjects) {
      scene.remove(obj)
    }
    sceneObjects = []
    floorMeshes = []

    // Clear marker groups
    npcMarkerGroup.clear()
    zoneMarkerGroup.clear()

    npcSpheres.clear()
    zoneRingPips.clear()
    npcMarkerRoots.clear()
    zoneMarkerRoots.clear()
    npcLivePositions.value = new Map()
    zoneLivePositions.value = new Map()

    // Clear placed objects
    placedGroup.clear()
    placedMeshRoots.clear()
    placedHitBoxes.clear()
    placedObjects.value = []

    // Clear all path visualizations
    for (const [, viz] of npcPathViz) {
      pathGroup.remove(viz.line)
      pathGroup.remove(viz.dots)
      viz.line.geometry.dispose()
    }
    npcPathViz.clear()
  }

  // ─── Live transform setters (inspector → viewport) ───────────────────────────

  function setNpcPosition(entityId: string, x: number, z: number): void {
    const root = npcMarkerRoots.get(entityId)
    if (!root) return
    root.position.x = x
    root.position.z = z
    const next = new Map(npcLivePositions.value)
    next.set(entityId, { x, y: root.position.y, z })
    npcLivePositions.value = next
  }

  function setZonePosition(id: string, x: number, z: number): void {
    const root = zoneMarkerRoots.get(id)
    if (!root) return
    root.position.x = x
    root.position.z = z
    const next = new Map(zoneLivePositions.value)
    next.set(id, { x, z })
    zoneLivePositions.value = next
  }

  // ─── Dynamic marker add/remove (F-11) ─────────────────────────────────────────

  function addNpcMarker(npc: import('./sceneEditorTypes').EditorNpcEntry): void {
    _addNpcMarkerMesh(npc)
    const next = new Map(npcLivePositions.value)
    next.set(npc.entityId, { x: npc.x, y: npc.y ?? 0, z: npc.z })
    npcLivePositions.value = next
  }

  function removeNpcMarker(entityId: string): void {
    const root = npcMarkerRoots.get(entityId)
    if (root) npcMarkerGroup.remove(root)
    npcMarkerRoots.delete(entityId)
    npcSpheres.delete(entityId)
    const next = new Map(npcLivePositions.value)
    next.delete(entityId)
    npcLivePositions.value = next
    if (selection.value?.kind === 'npc' && selection.value.entityId === entityId) {
      setSelection({ kind: 'scene' })
    }
  }

  function addZoneMarker(zone: import('./sceneEditorTypes').EditorZoneEntry): void {
    _addZoneMarkerMesh(zone)
    const next = new Map(zoneLivePositions.value)
    next.set(zone.id, { x: zone.x, z: zone.z })
    zoneLivePositions.value = next
  }

  function removeZoneMarker(id: string): void {
    const root = zoneMarkerRoots.get(id)
    if (root) zoneMarkerGroup.remove(root)
    zoneMarkerRoots.delete(id)
    zoneRingPips.delete(id)
    const next = new Map(zoneLivePositions.value)
    next.delete(id)
    zoneLivePositions.value = next
    if (selection.value?.kind === 'zone' && selection.value.id === id) {
      setSelection({ kind: 'scene' })
    }
  }

  // ─── reinitScene — public API for scene switcher ──────────────────────────────

  async function reinitScene(newConfig: SceneEditorConfig): Promise<void> {
    config = newConfig
    clearScene()
    await loadScene(newConfig)
  }

  // ─── GLB loading ────────────────────────────────────────────────────────────

  async function loadGLB(url: string, isFloor: boolean): Promise<void> {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(url)
      scene.add(gltf.scene)
      sceneObjects.push(gltf.scene)
      if (isFloor) {
        gltf.scene.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh) floorMeshes.push(obj)
        })
      }
    } catch (e) {
      console.warn(`[SceneEditor] Could not load "${url}":`, e)
    }
  }

  // ─── Marker construction ─────────────────────────────────────────────────────

  function buildNpcMarkers(cfg: SceneEditorConfig): void {
    npcMarkerGroup.clear()
    npcSpheres.clear()
    npcMarkerRoots.clear()

    const liveNpcs = new Map<string, { x: number; y: number; z: number }>()

    for (const npc of cfg.npcs ?? []) {
      _addNpcMarkerMesh(npc)
      liveNpcs.set(npc.entityId, { x: npc.x, y: npc.y ?? 0, z: npc.z })
    }

    npcLivePositions.value = liveNpcs
  }

  /** Shared mesh-building logic used by buildNpcMarkers and addNpcMarker. */
  function _addNpcMarkerMesh(npc: import('./sceneEditorTypes').EditorNpcEntry): void {
    const yBase = npc.y ?? 0
    const markerRoot = new THREE.Group()
    markerRoot.position.set(npc.x, yBase, npc.z)

    const mat = new THREE.MeshBasicMaterial({ color: '#00aaff' })
    const sphere = new THREE.Mesh(npcSphereGeo, mat)
    sphere.position.set(0, 0.9, 0)
    markerRoot.add(sphere)
    npcSpheres.set(npc.entityId, sphere)

    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6)
    const stemMat = new THREE.MeshBasicMaterial({ color: '#0077bb' })
    const stem = new THREE.Mesh(stemGeo, stemMat)
    stem.position.set(0, 0.45, 0)
    markerRoot.add(stem)

    if (npc.proximityRadius && npc.proximityRadius > 0) {
      const r = npc.proximityRadius
      const ringGeo = new THREE.RingGeometry(r - 0.06, r + 0.06, 56)
      ringGeo.rotateX(-Math.PI / 2)
      const ringMat = new THREE.MeshBasicMaterial({
        color: '#00aaff', transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(0, 0.03, 0)
      markerRoot.add(ring)
    }

    npcMarkerGroup.add(markerRoot)
    npcMarkerRoots.set(npc.entityId, markerRoot)
  }

  function buildZoneMarkers(cfg: SceneEditorConfig): void {
    zoneMarkerGroup.clear()
    zoneRingPips.clear()
    zoneMarkerRoots.clear()

    const liveZones = new Map<string, { x: number; z: number }>()

    for (const zone of cfg.zones ?? []) {
      _addZoneMarkerMesh(zone)
      liveZones.set(zone.id, { x: zone.x, z: zone.z })
    }

    zoneLivePositions.value = liveZones
  }

  /** Shared mesh-building logic used by buildZoneMarkers and addZoneMarker. */
  function _addZoneMarkerMesh(zone: import('./sceneEditorTypes').EditorZoneEntry): void {
    const defaultColor = zone.type === 'exit' ? '#ffdd44' : '#44ff88'
    const colorHex = zone.color
      ? `#${zone.color.toString(16).padStart(6, '0')}`
      : defaultColor

    // Group root — TC attaches here so ring + pip move together
    const zoneRoot = new THREE.Group()
    zoneRoot.position.set(zone.x, 0, zone.z)

    const r = zone.radius
    const ringGeo = new THREE.RingGeometry(r - 0.07, r + 0.07, 56)
    ringGeo.rotateX(-Math.PI / 2)
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.65, side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(0, 0.04, 0)
    zoneRoot.add(ring)

    const pipGeo = new THREE.SphereGeometry(0.15, 8, 6)
    const pip = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({ color: colorHex }))
    pip.position.set(0, 0.18, 0)
    zoneRoot.add(pip)
    zoneRingPips.set(zone.id, pip)

    zoneMarkerGroup.add(zoneRoot)
    zoneMarkerRoots.set(zone.id, zoneRoot)
  }

  function buildSpawnMarker(cfg: SceneEditorConfig): void {
    if (!cfg.spawnPoint) return
    const { x, z } = cfg.spawnPoint
    const geo = new THREE.OctahedronGeometry(0.3)
    const mat = new THREE.MeshBasicMaterial({ color: '#ff44ff' })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, 0.4, z)
    scene.add(mesh)
    sceneObjects.push(mesh)
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  function setSelection(s: EditorSelection): void {
    selection.value = s
    refreshNpcHighlights()
    statusMessage.value = describeSelection(s)

    if (s?.kind === 'player') {
      // Player selected: enter follow-3p unless already in a player-attached mode (first-person)
      if (editorCamMode.value !== 'follow-3p' && editorCamMode.value !== 'first-person') {
        setEditorCamMode('follow-3p')
      }
      transformControls.detach()
      transformControls.enabled = false
      return
    }

    // Non-player selection: exit any player-attached camera mode back to orbit
    if (editorCamMode.value === 'follow-3p' || editorCamMode.value === 'first-person') {
      setEditorCamMode('orbit')
    }

    // Attach TransformControls to the selected object's root group / pip.
    // Disabled when nothing is selected to avoid TC stealing pointer from OrbitControls.
    if (s?.kind === 'npc') {
      const root = npcMarkerRoots.get(s.entityId)
      if (root) {
        transformControls.attach(root)
        transformControls.enabled = true
      } else {
        transformControls.detach()
        transformControls.enabled = false
      }
    } else if (s?.kind === 'zone') {
      const root = zoneMarkerRoots.get(s.id)
      if (root) {
        transformControls.attach(root)
        transformControls.enabled = true
      } else {
        transformControls.detach()
        transformControls.enabled = false
      }
    } else if (s?.kind === 'placed') {
      const root = placedMeshRoots.get(s.objectId)
      if (root) {
        transformControls.attach(root)
        transformControls.enabled = true
      } else {
        transformControls.detach()
        transformControls.enabled = false
      }
    } else {
      transformControls.detach()
      transformControls.enabled = false
    }
  }

  function refreshNpcHighlights(): void {
    const sel = selection.value
    for (const [id, mesh] of npcSpheres) {
      const isSelected = sel?.kind === 'npc' && sel.entityId === id
      ;(mesh.material as THREE.MeshBasicMaterial).color.set(isSelected ? '#ff8800' : '#00aaff')
    }
  }

  function describeSelection(s: EditorSelection): string {
    if (!s || s.kind === 'scene') {
      return sceneStatus(config)
    }
    if (s.kind === 'player') {
      return 'Player — WASD to move · Tab to cycle camera'
    }
    if (s.kind === 'npc') {
      const npc = config.npcs?.find(n => n.entityId === s.entityId)
      const label = npc?.label ?? s.entityId
      const pathHint = pathEditActive ? ' — click floor to add waypoint' : ''
      return `NPC: ${label}${pathHint}`
    }
    if (s.kind === 'zone') {
      const zone = config.zones?.find(z => z.id === s.id)
      return `Zone: ${zone?.label ?? s.id} (${zone?.type ?? 'unknown'}, r=${zone?.radius ?? '?'}m)`
    }
    if (s.kind === 'placed') {
      const obj = placedObjects.value.find(p => p.id === s.objectId)
      return `Object: ${obj?.label ?? s.objectId}`
    }
    return ''
  }

  function sceneStatus(cfg: SceneEditorConfig): string {
    const n = cfg.npcs?.length ?? 0
    const z = cfg.zones?.length ?? 0
    return `Scene loaded — ${n} NPC${n !== 1 ? 's' : ''}, ${z} zone${z !== 1 ? 's' : ''}`
  }

  // ─── Transform mode ───────────────────────────────────────────────────────────

  function setTransformMode(mode: TransformMode): void {
    transformMode.value = mode
    transformControls.setMode(mode)
  }

  // ─── Path edit mode ──────────────────────────────────────────────────────────

  function setPathEditMode(active: boolean, cb?: (pos: THREE.Vector3) => void): void {
    pathEditActive = active
    onFloorHitCb = cb
    statusMessage.value = describeSelection(selection.value)
  }

  // ─── Place mode ──────────────────────────────────────────────────────────────

  function enterPlaceMode(objectId: string, assetId: string, blobUrl: string, label: string): void {
    placeMode = { active: true, objectId, assetId, blobUrl, label }
    isInPlaceMode.value = true
    // Deselect current object so TC doesn't block the viewport click
    setSelection({ kind: 'scene' })
    statusMessage.value = `Click floor to place "${label}" — Esc to cancel`
  }

  function exitPlaceMode(): void {
    placeMode = { ...PLACE_MODE_IDLE }
    isInPlaceMode.value = false
    statusMessage.value = describeSelection(selection.value)
  }

  async function placeObject(pos: THREE.Vector3): Promise<void> {
    // Snapshot and clear place mode immediately — prevents double-placement during async load
    const { objectId, assetId, blobUrl, label } = placeMode
    placeMode = { ...PLACE_MODE_IDLE }
    isInPlaceMode.value = false
    statusMessage.value = `Placing "${label}"…`

    const root = new THREE.Group()
    root.position.copy(pos)

    const loader = new GLTFLoader()
    let localBbox = new THREE.Box3()

    try {
      const gltf = await loader.loadAsync(blobUrl)
      // Compute bbox in GLB's own local space before parenting
      localBbox.setFromObject(gltf.scene)
      root.add(gltf.scene)
    } catch (e) {
      console.warn('[SceneEditor] Could not load placed GLB:', e)
      // Fallback proxy so placement is still visible
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: '#c099ff', wireframe: true }),
      )
      proxy.position.set(0, 0.5, 0)
      root.add(proxy)
      localBbox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
    }

    if (localBbox.isEmpty()) {
      localBbox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
    }

    // Invisible hit box sized to the GLB bbox — used for raycasting / selection
    const bboxSize = localBbox.getSize(new THREE.Vector3())
    const bboxCenter = localBbox.getCenter(new THREE.Vector3())
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(bboxSize.x + 0.2, bboxSize.y + 0.2, bboxSize.z + 0.2),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    hitBox.position.copy(bboxCenter)
    root.add(hitBox)

    placedGroup.add(root)
    // Also track in sceneObjects so clearScene removes it from the group
    // (clearScene calls placedGroup.clear() directly — no need to add to sceneObjects)
    placedMeshRoots.set(objectId, root)
    placedHitBoxes.set(objectId, hitBox)

    placedObjects.value = [
      ...placedObjects.value,
      {
        id: objectId, assetId, label,
        x: pos.x, y: pos.y, z: pos.z,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      },
    ]

    // Auto-select the freshly placed object
    setSelection({ kind: 'placed', objectId })
  }

  // ─── Restore placed objects (load saved scene) ───────────────────────────────

  async function restorePlacedObjects(objects: RestorableObject[]): Promise<void> {
    const loader = new GLTFLoader()
    const restored: EditorPlacedObject[] = []

    for (const obj of objects) {
      const root = new THREE.Group()
      root.position.set(obj.x, obj.y, obj.z)
      root.rotation.set(obj.rotationX, obj.rotationY, obj.rotationZ)
      root.scale.set(obj.scaleX, obj.scaleY, obj.scaleZ)

      let localBbox = new THREE.Box3()
      try {
        const gltf = await loader.loadAsync(obj.blobUrl)
        localBbox.setFromObject(gltf.scene)
        root.add(gltf.scene)
      } catch {
        const proxy = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: '#c099ff', wireframe: true }),
        )
        proxy.position.set(0, 0.5, 0)
        root.add(proxy)
        localBbox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
      }

      if (localBbox.isEmpty()) {
        localBbox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
      }

      const bboxSize = localBbox.getSize(new THREE.Vector3())
      const bboxCenter = localBbox.getCenter(new THREE.Vector3())
      const hitBox = new THREE.Mesh(
        new THREE.BoxGeometry(bboxSize.x + 0.2, bboxSize.y + 0.2, bboxSize.z + 0.2),
        new THREE.MeshBasicMaterial({ visible: false }),
      )
      hitBox.position.copy(bboxCenter)
      root.add(hitBox)

      placedGroup.add(root)
      placedMeshRoots.set(obj.id, root)
      placedHitBoxes.set(obj.id, hitBox)

      restored.push({
        id: obj.id, assetId: obj.assetId, label: obj.label,
        x: obj.x, y: obj.y, z: obj.z,
        rotationX: obj.rotationX, rotationY: obj.rotationY, rotationZ: obj.rotationZ,
        scaleX: obj.scaleX, scaleY: obj.scaleY, scaleZ: obj.scaleZ,
      })
    }

    placedObjects.value = restored
    setSelection({ kind: 'scene' })
  }

  // ─── Path visualization ──────────────────────────────────────────────────────

  function updateNpcPath(entityId: string, waypoints: THREE.Vector3[]): void {
    const existing = npcPathViz.get(entityId)
    if (existing) {
      pathGroup.remove(existing.line)
      pathGroup.remove(existing.dots)
      existing.line.geometry.dispose()
    }
    npcPathViz.delete(entityId)

    if (waypoints.length === 0) return

    const isSel = selection.value?.kind === 'npc' && selection.value.entityId === entityId
    const lineColor = isSel ? '#ffcc00' : '#3a6080'

    const pts = waypoints.map(w => new THREE.Vector3(w.x, w.y + 0.28, w.z))
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: lineColor }))

    const dots = new THREE.Group()
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i]
      const c = i === 0 ? '#44ff88' : i === waypoints.length - 1 ? '#4488ff' : (isSel ? '#ffcc00' : '#2a5070')
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: c }))
      dot.position.set(w.x, w.y + 0.28, w.z)
      dots.add(dot)
    }

    pathGroup.add(line)
    pathGroup.add(dots)
    npcPathViz.set(entityId, { line, dots })
  }

  function clearNpcPath(entityId: string): void {
    updateNpcPath(entityId, [])
  }

  // ─── Player proxy ─────────────────────────────────────────────────────────────

  function initPlayer(): void {
    // CapsuleGeometry(radius, length, capSegs, radialSegs): total height = length + 2*radius
    // radius=0.35, length=1.1 → height=1.8m; mesh center at local y=0, bottom at y=-0.9
    const geo = new THREE.CapsuleGeometry(0.35, 1.1, 4, 8)
    const mat = new THREE.MeshStandardMaterial({ color: 0x00d4aa, roughness: 0.6 })
    playerMesh = new THREE.Mesh(geo, mat)
    playerMesh.name = '__player__'
    playerMesh.position.set(0, 0.9, 0) // bottom of capsule at y=0
    playerMesh.visible = false
    scene.add(playerMesh)
  }

  // ─── Camera mode ─────────────────────────────────────────────────────────────

  const CAM_MODE_ORDER: EditorCamMode[] = ['orbit', 'follow-3p', 'first-person', 'free-float']

  /** Switch camera mode — handles Three.js state only, no selection changes. */
  function setEditorCamMode(mode: EditorCamMode): void {
    editorCamMode.value = mode
    const mesh = playerMesh
    if (mode === 'orbit') {
      controls.enabled = true
      if (mesh) mesh.visible = false
      if (ffPointerLocked) document.exitPointerLock()
    } else if (mode === 'follow-3p') {
      controls.enabled = true
      if (mesh) mesh.visible = true
      if (ffPointerLocked) document.exitPointerLock()
      // Snap OrbitControls target to player so camera doesn't jump
      if (mesh) controls.target.copy(mesh.position)
      controls.update()
    } else if (mode === 'first-person') {
      controls.enabled = false
      if (mesh) mesh.visible = false  // hidden — camera is the player's eyes
      // Seed look direction from current camera orientation
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      ffYaw = euler.y
      ffPitch = 0  // look level on entry
      canvasRef.value?.requestPointerLock()
    } else {
      // free-float
      controls.enabled = false
      if (mesh) mesh.visible = false
      // Seed free-float state from current camera orientation
      ffPos.copy(camera.position)
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      ffYaw = euler.y
      ffPitch = euler.x
      canvasRef.value?.requestPointerLock()
    }
  }

  /** Public camera-mode setter — syncs selection alongside Three.js state. */
  function setCamMode(mode: EditorCamMode): void {
    setEditorCamMode(mode)
    if (mode === 'follow-3p' || mode === 'first-person') {
      setSelection({ kind: 'player' })
    } else if (selection.value?.kind === 'player') {
      setSelection({ kind: 'scene' })
    }
  }

  /** Tab cycles orbit → follow-3p → first-person → free-float → orbit, syncing selection. */
  function cycleEditorCamMode(): void {
    const next = CAM_MODE_ORDER[(CAM_MODE_ORDER.indexOf(editorCamMode.value) + 1) % CAM_MODE_ORDER.length]
    setCamMode(next)
  }

  // ─── Render loop ─────────────────────────────────────────────────────────────

  function animate(): void {
    animId = requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.05)

    if (editorCamMode.value === 'follow-3p' && playerMesh) {
      const moveX = (keyState.has('KeyD') ? 1 : 0) - (keyState.has('KeyA') ? 1 : 0)
      const moveZ = (keyState.has('KeyS') ? 1 : 0) - (keyState.has('KeyW') ? 1 : 0)
      if (moveX !== 0 || moveZ !== 0) {
        const spd = 6 * delta
        // Camera-relative WASD: forward = camera's XZ look direction
        const camFwd = new THREE.Vector3()
        camera.getWorldDirection(camFwd)
        camFwd.y = 0
        camFwd.normalize()
        const camRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize()
        const move = new THREE.Vector3()
          .addScaledVector(camFwd, -moveZ)   // W = forward, S = back
          .addScaledVector(camRight, moveX)  // D = right, A = left
        move.normalize()
        playerMesh.position.addScaledVector(move, spd)
        playerMesh.position.y = 0.9 // stay grounded on flat editor floor
      }
      // OrbitControls target lerps to player so camera smoothly follows
      controls.target.lerp(playerMesh.position, 0.1)
    } else if (editorCamMode.value === 'first-person' && playerMesh) {
      {
        const spd = 6 * delta
        // Move player in look-yaw direction (XZ only — no flying).
        // WASD works regardless of pointer-lock state so the mode is never stuck.
        const sinY = Math.sin(ffYaw)
        const cosY = Math.cos(ffYaw)
        const fwd = new THREE.Vector3(-sinY, 0, -cosY)
        const right = new THREE.Vector3(cosY, 0, -sinY)
        if (keyState.has('KeyW')) playerMesh.position.addScaledVector(fwd, spd)
        if (keyState.has('KeyS')) playerMesh.position.addScaledVector(fwd, -spd)
        if (keyState.has('KeyA')) playerMesh.position.addScaledVector(right, -spd)
        if (keyState.has('KeyD')) playerMesh.position.addScaledVector(right, spd)
        playerMesh.position.y = 0.9
      }
      // Camera locked to player eye level, driven by mouse look
      camera.position.set(
        playerMesh.position.x,
        playerMesh.position.y + FPV_EYE_OFFSET,
        playerMesh.position.z,
      )
      camera.rotation.set(ffPitch, ffYaw, 0, 'YXZ')
    } else if (editorCamMode.value === 'free-float') {
      const spd = 10 * delta
      const sinY = Math.sin(ffYaw)
      const cosY = Math.cos(ffYaw)
      const cosP = Math.cos(ffPitch)
      const sinP = Math.sin(ffPitch)
      const fwd = new THREE.Vector3(-sinY * cosP, sinP, -cosY * cosP)
      const right = new THREE.Vector3(cosY, 0, -sinY)
      if (keyState.has('KeyW')) ffPos.addScaledVector(fwd, spd)
      if (keyState.has('KeyS')) ffPos.addScaledVector(fwd, -spd)
      if (keyState.has('KeyA')) ffPos.addScaledVector(right, -spd)
      if (keyState.has('KeyD')) ffPos.addScaledVector(right, spd)
      if (keyState.has('KeyE') || keyState.has('Space')) ffPos.y += spd
      if (keyState.has('KeyQ')) ffPos.y -= spd
      camera.position.copy(ffPos)
      camera.rotation.set(ffPitch, ffYaw, 0, 'YXZ')
    }

    controls.update()
    renderer.render(scene, camera)
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  function onMouseDown(e: MouseEvent): void {
    mouseDownX = e.clientX
    mouseDownY = e.clientY
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return
    // Pointer-lock modes: ignore canvas clicks while locked
    if (editorCamMode.value === 'free-float' || editorCamMode.value === 'first-person') return
    // If the gizmo was clicked, skip selection logic (let TransformControls handle it).
    if (gizmoMouseDown) { gizmoMouseDown = false; return }
    if (Math.abs(e.clientX - mouseDownX) > 5 || Math.abs(e.clientY - mouseDownY) > 5) return

    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(mouse, camera)

    // In place mode: only check the floor for the drop point; skip all selection logic.
    if (placeMode.active) {
      const floorHits = raycaster.intersectObjects(floorMeshes, true)
      if (floorHits.length > 0) {
        void placeObject(floorHits[0].point.clone())
      }
      return
    }

    // 0. Player mesh hit? (only when visible — invisible in orbit/free-float)
    if (playerMesh && playerMesh.visible) {
      const playerHits = raycaster.intersectObject(playerMesh, false)
      if (playerHits.length > 0) {
        setSelection({ kind: 'player' })
        return
      }
    }

    // 1. NPC sphere hit?
    const npcHits = raycaster.intersectObjects([...npcSpheres.values()])
    if (npcHits.length > 0) {
      const hit = npcHits[0].object as THREE.Mesh
      for (const [id, m] of npcSpheres) {
        if (m === hit) { setSelection({ kind: 'npc', entityId: id }); return }
      }
    }

    // 2. Zone pip hit?
    const zoneHits = raycaster.intersectObjects([...zoneRingPips.values()])
    if (zoneHits.length > 0) {
      const hit = zoneHits[0].object as THREE.Mesh
      for (const [id, m] of zoneRingPips) {
        if (m === hit) { setSelection({ kind: 'zone', id }); return }
      }
    }

    // 3. Placed object hit?
    const placedHits = raycaster.intersectObjects([...placedHitBoxes.values()])
    if (placedHits.length > 0) {
      const hit = placedHits[0].object as THREE.Mesh
      for (const [id, m] of placedHitBoxes) {
        if (m === hit) { setSelection({ kind: 'placed', objectId: id }); return }
      }
    }

    // 4. Floor hit (GLB mesh or invisible plane)
    const floorHits = raycaster.intersectObjects(floorMeshes, true)
    if (floorHits.length > 0) {
      if (pathEditActive && onFloorHitCb) {
        onFloorHitCb(floorHits[0].point.clone())
      } else {
        setSelection({ kind: 'scene' })
      }
    } else {
      setSelection({ kind: 'scene' })
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    keyState.add(e.code)

    if (e.code === 'Tab') {
      e.preventDefault()
      cycleEditorCamMode()
      return
    }

    if (e.code === 'Escape') {
      // Pointer-lock modes: browser releases lock → pointerlockchange handles mode switch
      if (editorCamMode.value === 'free-float' || editorCamMode.value === 'first-person') return
      if (placeMode.active) { exitPlaceMode(); return }
      if (editorCamMode.value === 'follow-3p') {
        setEditorCamMode('orbit')
        setSelection({ kind: 'scene' })
        return
      }
      // Orbit: cancel path editing if active, then deselect everything
      if (pathEditActive) {
        setPathEditMode(false)
        opts.onPathEditCancel?.()
      }
      setSelection({ kind: 'scene' })
      return
    }

    // T/R/S transform shortcuts — only in orbit mode (WASD drives player/camera otherwise)
    if (editorCamMode.value === 'orbit') {
      if (e.code === 'KeyT') setTransformMode('translate')
      if (e.code === 'KeyR') setTransformMode('rotate')
      if (e.code === 'KeyS') setTransformMode('scale')
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    keyState.delete(e.code)
  }

  function onMouseMove(e: MouseEvent): void {
    const isLockedMode = editorCamMode.value === 'free-float' || editorCamMode.value === 'first-person'
    if (!isLockedMode || !ffPointerLocked) return
    const sensitivity = 0.002
    ffYaw -= e.movementX * sensitivity
    ffPitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, ffPitch - e.movementY * sensitivity))
  }

  function onPointerLockChange(): void {
    ffPointerLocked = document.pointerLockElement === canvasRef.value
    // Pointer lock released (Esc or programmatic) — return to orbit from any locked mode
    if (!ffPointerLocked && (editorCamMode.value === 'free-float' || editorCamMode.value === 'first-person')) {
      setEditorCamMode('orbit')
      if (selection.value?.kind === 'player') setSelection({ kind: 'scene' })
    }
  }

  function onResize(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  }

  // ─── Snapshot ────────────────────────────────────────────────────────────────

  function snapshotPlacedTransforms(): EditorPlacedObject[] {
    return placedObjects.value.map(obj => {
      const root = placedMeshRoots.get(obj.id)
      if (!root) return { ...obj }
      return {
        ...obj,
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
        rotationX: root.rotation.x,
        rotationY: root.rotation.y,
        rotationZ: root.rotation.z,
        scaleX: root.scale.x,
        scaleY: root.scale.y,
        scaleZ: root.scale.z,
      }
    })
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  function dispose(): void {
    cancelAnimationFrame(animId)
    const canvas = canvasRef.value
    canvas?.removeEventListener('mousedown', onMouseDown)
    canvas?.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    window.removeEventListener('resize', onResize)
    if (ffPointerLocked) document.exitPointerLock()
    keyState.clear()
    if (playerMesh) {
      playerMesh.geometry.dispose()
      ;(playerMesh.material as THREE.Material).dispose()
      scene?.remove(playerMesh)
      playerMesh = null
    }
    if (transformControls) {
      scene?.remove(transformControls.getHelper())
      transformControls.dispose()
    }
    controls?.dispose()
    renderer?.dispose()
    npcSphereGeo.dispose()
    dotGeo.dispose()
    scene?.clear()
    floorMeshes = []
    sceneObjects = []
    npcSpheres.clear()
    zoneRingPips.clear()
    npcMarkerRoots.clear()
    zoneMarkerRoots.clear()
    npcPathViz.clear()
    placedMeshRoots.clear()
    placedHitBoxes.clear()
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    isReady: shallowReadonly(isReady),
    statusMessage: shallowReadonly(statusMessage),
    selection: shallowReadonly(selection),
    transformMode: shallowReadonly(transformMode),
    editorCamMode: shallowReadonly(editorCamMode),
    placedObjects: shallowReadonly(placedObjects),
    isInPlaceMode: shallowReadonly(isInPlaceMode),
    npcLivePositions: shallowReadonly(npcLivePositions),
    zoneLivePositions: shallowReadonly(zoneLivePositions),
    setSelection,
    setTransformMode,
    setPathEditMode,
    updateNpcPath,
    clearNpcPath,
    reinitScene,
    enterPlaceMode,
    exitPlaceMode,
    snapshotPlacedTransforms,
    restorePlacedObjects,
    setCamMode,
    setNpcPosition,
    setZonePosition,
    addNpcMarker,
    removeNpcMarker,
    addZoneMarker,
    removeZoneMarker,
  }
}
