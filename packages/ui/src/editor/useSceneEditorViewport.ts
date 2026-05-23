import { ref, onMounted, onUnmounted, shallowReadonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneEditorConfig, EditorSelection, EditorPlacedObject, EditorCamMode } from './sceneEditorTypes'
export type { EditorCamMode } from './sceneEditorTypes'

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
  /** Set selection from the hierarchy panel (bypasses click raycasting). */
  setSelection: (s: EditorSelection) => void
  /** Set the active TransformControls mode (translate / rotate / scale). */
  setTransformMode: (mode: TransformMode) => void
  /**
   * Toggle path-edit mode for the current NPC selection.
   * When active, floor clicks call onFloorHit instead of selecting scene root.
   */
  setPathEditMode: (active: boolean, onFloorHit?: (pos: THREE.Vector3) => void) => void
  /** Update the path line + dot markers for an NPC. Pass [] to clear. */
  updateNpcPath: (entityId: string, waypoints: THREE.Vector3[]) => void
  /** Remove path visualization for an NPC without needing an empty array call. */
  clearNpcPath: (entityId: string) => void
  /**
   * Reload the scene with a new config (scene switcher).
   * Keeps renderer / camera / controls / lights alive — only reloads GLBs + markers.
   */
  reinitScene: (newConfig: SceneEditorConfig) => Promise<void>
  /**
   * Enter place mode — next floor click drops the asset at that position.
   * Auto-exits after one placement and auto-selects the placed object.
   * Press Esc to cancel without placing.
   */
  enterPlaceMode: (objectId: string, assetId: string, blobUrl: string, label: string) => void
  /** Cancel place mode without placing anything. */
  exitPlaceMode: () => void
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useSceneEditorViewport(opts: {
  canvas: Ref<HTMLCanvasElement | null>
  config: SceneEditorConfig
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

    // Enforce uniform scale in scale mode (mirrors legacy editor behavior).
    transformControls.addEventListener('objectChange', () => {
      if (transformMode.value === 'scale') {
        const obj = transformControls.object
        if (obj) { const s = obj.scale.x; obj.scale.set(s, s, s) }
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

    for (const npc of cfg.npcs ?? []) {
      const yBase = npc.y ?? 0

      // Each NPC's parts are grouped so TransformControls moves the whole marker.
      const markerRoot = new THREE.Group()
      markerRoot.position.set(npc.x, yBase, npc.z)

      // Sphere body (positioned relative to group root)
      const mat = new THREE.MeshBasicMaterial({ color: '#00aaff' })
      const sphere = new THREE.Mesh(npcSphereGeo, mat)
      sphere.position.set(0, 0.9, 0)
      markerRoot.add(sphere)
      npcSpheres.set(npc.entityId, sphere)

      // Vertical stem so sphere is clearly above ground
      const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6)
      const stemMat = new THREE.MeshBasicMaterial({ color: '#0077bb' })
      const stem = new THREE.Mesh(stemGeo, stemMat)
      stem.position.set(0, 0.45, 0)
      markerRoot.add(stem)

      // Proximity ring (flat disc outline)
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
  }

  function buildZoneMarkers(cfg: SceneEditorConfig): void {
    zoneMarkerGroup.clear()
    zoneRingPips.clear()

    for (const zone of cfg.zones ?? []) {
      const defaultColor = zone.type === 'exit' ? '#ffdd44' : '#44ff88'
      const colorHex = zone.color
        ? `#${zone.color.toString(16).padStart(6, '0')}`
        : defaultColor

      // Outer ring
      const r = zone.radius
      const ringGeo = new THREE.RingGeometry(r - 0.07, r + 0.07, 56)
      ringGeo.rotateX(-Math.PI / 2)
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.65, side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(zone.x, 0.04, zone.z)
      zoneMarkerGroup.add(ring)

      // Centre pip (clickable selection target)
      const pipGeo = new THREE.SphereGeometry(0.15, 8, 6)
      const pip = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({ color: colorHex }))
      pip.position.set(zone.x, 0.18, zone.z)
      zoneMarkerGroup.add(pip)
      zoneRingPips.set(zone.id, pip)
    }
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
      // Player selected: enter follow-3p mode, TC inactive (player moves via WASD)
      if (editorCamMode.value !== 'follow-3p') setEditorCamMode('follow-3p')
      transformControls.detach()
      transformControls.enabled = false
      return
    }

    // Non-player selection: exit follow-3p (return camera to free orbit)
    if (editorCamMode.value === 'follow-3p') setEditorCamMode('orbit')

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
      const pip = zoneRingPips.get(s.id)
      if (pip) {
        transformControls.attach(pip)
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
      { id: objectId, assetId, label, x: pos.x, y: pos.y, z: pos.z },
    ]

    // Auto-select the freshly placed object
    setSelection({ kind: 'placed', objectId })
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

  const CAM_MODE_ORDER: EditorCamMode[] = ['orbit', 'follow-3p', 'free-float']

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

  /** Tab cycles orbit → follow-3p → free-float → orbit, syncing selection. */
  function cycleEditorCamMode(): void {
    const next = CAM_MODE_ORDER[(CAM_MODE_ORDER.indexOf(editorCamMode.value) + 1) % CAM_MODE_ORDER.length]
    setEditorCamMode(next)
    if (next === 'follow-3p') {
      // Auto-select player when entering follow mode
      setSelection({ kind: 'player' })
    } else if (selection.value?.kind === 'player') {
      setSelection({ kind: 'scene' })
    }
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
    // Free-float uses pointer lock — ignore canvas clicks while locked
    if (editorCamMode.value === 'free-float') return
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
      if (editorCamMode.value === 'free-float') {
        // Browser releases pointer lock on Esc; pointerlockchange will handle mode switch
        return
      }
      if (placeMode.active) { exitPlaceMode(); return }
      if (editorCamMode.value === 'follow-3p') {
        setEditorCamMode('orbit')
        setSelection({ kind: 'scene' })
        return
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
    if (editorCamMode.value !== 'free-float' || !ffPointerLocked) return
    const sensitivity = 0.002
    ffYaw -= e.movementX * sensitivity
    ffPitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, ffPitch - e.movementY * sensitivity))
  }

  function onPointerLockChange(): void {
    ffPointerLocked = document.pointerLockElement === canvasRef.value
    // If the user pressed Esc to exit pointer lock while in free-float, return to orbit
    if (!ffPointerLocked && editorCamMode.value === 'free-float') {
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
    setSelection,
    setTransformMode,
    setPathEditMode,
    updateNpcPath,
    clearNpcPath,
    reinitScene,
    enterPlaceMode,
    exitPlaceMode,
  }
}
