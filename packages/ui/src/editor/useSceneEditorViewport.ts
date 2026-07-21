import { ref, onMounted, onUnmounted, shallowReadonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneEditorConfig, EditorSelection, EditorPlacedObject, EditorCamMode } from './sceneEditorTypes'
import type { SavedPlacedObject } from './sandboxSceneSchema'
import { validatePlacement, summarizeVerdicts, type GateSummary } from './gate/attachmentValidator'
import type { Aabb, Mat4, Vec3 } from './gate/verdict'
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

// ─── IK chains (Mixamo rig) ───────────────────────────────────────────────────

const MIXAMO_IK_CHAINS: Record<string, { effector: string; links: string[] }> = {
  rightArm: { effector: 'mixamorigRightHand',  links: ['mixamorigRightForeArm', 'mixamorigRightArm'] },
  leftArm:  { effector: 'mixamorigLeftHand',   links: ['mixamorigLeftForeArm',  'mixamorigLeftArm'] },
  rightLeg: { effector: 'mixamorigRightFoot',  links: ['mixamorigRightLeg',     'mixamorigRightUpLeg'] },
  leftLeg:  { effector: 'mixamorigLeftFoot',   links: ['mixamorigLeftLeg',      'mixamorigLeftUpLeg'] },
}

/** Simple iterative CCD IK — works on named bones, no skeleton modification needed. */
function runCcdIk(
  sm: THREE.SkinnedMesh,
  effectorName: string,
  linkNames: string[],
  targetWorldPos: THREE.Vector3,
  iterations = 10,
): void {
  const effector = sm.skeleton.getBoneByName(effectorName)
  if (!effector) return
  const links = linkNames
    .map(n => sm.skeleton.getBoneByName(n))
    .filter((b): b is THREE.Bone => b != null)
  if (links.length === 0) return

  const _effectorPos = new THREE.Vector3()
  const _linkPos = new THREE.Vector3()
  const _toEffector = new THREE.Vector3()
  const _toTarget = new THREE.Vector3()
  const _axis = new THREE.Vector3()
  const _rotQ = new THREE.Quaternion()
  const _worldQ = new THREE.Quaternion()
  const _parentWorldQ = new THREE.Quaternion()

  for (let i = 0; i < iterations; i++) {
    for (const link of links) {
      link.updateWorldMatrix(true, false)
      effector.updateWorldMatrix(true, false)

      _effectorPos.setFromMatrixPosition(effector.matrixWorld)
      _linkPos.setFromMatrixPosition(link.matrixWorld)

      _toEffector.subVectors(_effectorPos, _linkPos)
      _toTarget.subVectors(targetWorldPos, _linkPos)

      const lenE = _toEffector.length()
      const lenT = _toTarget.length()
      if (lenE < 1e-6 || lenT < 1e-6) continue
      _toEffector.divideScalar(lenE)
      _toTarget.divideScalar(lenT)

      const dot = Math.max(-1, Math.min(1, _toEffector.dot(_toTarget)))
      if (dot >= 1 - 1e-6) continue

      _axis.crossVectors(_toEffector, _toTarget)
      if (_axis.lengthSq() < 1e-12) continue
      _axis.normalize()

      _rotQ.setFromAxisAngle(_axis, Math.acos(dot))
      link.getWorldQuaternion(_worldQ)
      _rotQ.multiply(_worldQ)  // _rotQ = rotQ ⊗ worldQ = new worldQ

      if (link.parent) {
        link.parent.getWorldQuaternion(_parentWorldQ).invert()
        _parentWorldQ.multiply(_rotQ)  // localQ = invParent ⊗ newWorldQ
        link.quaternion.copy(_parentWorldQ)
      } else {
        link.quaternion.copy(_rotQ)
      }
      link.updateWorldMatrix(false, true)
    }
  }
}

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
  /** Run the L0 placement gate over live placements (F-G3). Consumed two-tier. */
  runPlacementGate: () => GateSummary
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
  /** Remove a placed object from the scene and placedObjects list. */
  removePlacedObject: (objectId: string) => void
  /**
   * D-5b: Set play-sim character GLB. Pass null blobUrl to revert to capsule proxy.
   * Call when user picks or clears the player character in the Scene inspector.
   */
  setPlayCharacterAsset: (charBlobUrl: string | null, animPackBlobUrl?: string | null) => Promise<void>
  // ─── Pose editor ─────────────────────────────────────────────────────────
  /** Load a character GLB for pose editing; returns the skeleton bone name list. */
  attachPoseNpc: (entityId: string, blobUrl: string) => Promise<string[]>
  /** Attach TransformControls in rotate mode to the named bone. */
  selectPoseBone: (boneName: string) => void
  /** Snapshot current skeleton quaternions — serializes to poseOverride format. */
  capturePoseSnapshot: () => Array<{ bone: string; q: [number, number, number, number] }>
  /** Reset all skeleton bones to bind pose and detach TC from any active bone/IK target. */
  resetPoseBones: () => void
  /** Remove the pose mesh + SkeletonHelper from the scene and release TC. */
  detachPoseNpc: () => void
  /** IK chain names available for the loaded pose mesh (e.g. 'rightArm', 'leftLeg'). */
  ikChainNames: Readonly<Ref<string[]>>
  /** Attach TransformControls in translate mode to the named IK target sphere. */
  selectIkTarget: (chainName: string) => void
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

  // Camera at player eye level — capsule center y=0.9, eye y≈1.70 from ground
  const FPV_EYE_OFFSET = 0.80

  // Player capsule proxy — fallback when no character GLB is loaded
  let playerMesh: THREE.Mesh | null = null

  // D-5b: real character GLB for play-sim
  let charRoot: THREE.Group | null = null
  let charMixer: THREE.AnimationMixer | null = null
  let charIdleAction: THREE.AnimationAction | null = null
  let charWalkAction: THREE.AnimationAction | null = null
  let pendingCharBlobUrl: string | null = null
  let pendingAnimBlobUrl: string | null = null

  // ─── Pose editor Three.js state ──────────────────────────────────────────────
  let poseMeshRoot: THREE.Object3D | null = null
  let poseSkinnedMesh: THREE.SkinnedMesh | null = null
  let poseHelper: THREE.SkeletonHelper | null = null
  let poseHasBoneAttached = false  // true when TC is attached to a bone via selectPoseBone

  // IK state — persistent group added to scene in init(); children managed by attachPoseNpc/detachPoseNpc
  const ikTargetGroup = new THREE.Group()
  const ikTargetMeshes = new Map<string, THREE.Mesh>()
  let ikActiveChainName: string | null = null
  const ikChainNames = ref<string[]>([])

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

      // IK: TC is on an IK target sphere — run solver to update bone chain
      if (ikActiveChainName !== null && poseSkinnedMesh) {
        const chain = MIXAMO_IK_CHAINS[ikActiveChainName]
        const sphere = ikTargetMeshes.get(ikActiveChainName)
        if (chain && sphere) {
          const worldPos = new THREE.Vector3()
          sphere.getWorldPosition(worldPos)
          runCcdIk(poseSkinnedMesh, chain.effector, chain.links, worldPos)
        }
        return  // skip NPC/zone live-position updates while dragging IK target
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
    scene.add(ikTargetGroup)

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

    // Clear marker groups — dispose per-marker materials/geometries first
    npcMarkerGroup.traverse(obj => {
      const m = obj as THREE.Mesh
      if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose() }
    })
    npcMarkerGroup.clear()
    zoneMarkerGroup.traverse(obj => {
      const m = obj as THREE.Mesh
      if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose() }
    })
    zoneMarkerGroup.clear()

    npcSpheres.clear()
    zoneRingPips.clear()
    npcMarkerRoots.clear()
    zoneMarkerRoots.clear()
    npcLivePositions.value = new Map()
    zoneLivePositions.value = new Map()

    // Clear placed objects — dispose geometries/materials before removing from scene
    for (const root of placedMeshRoots.values()) {
      root.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else (mat as THREE.Material)?.dispose()
        }
      })
    }
    placedGroup.clear()
    placedMeshRoots.clear()
    placedHitBoxes.clear()
    placedObjects.value = []

    // Clear all path visualizations — dispose line + dot materials
    for (const [, viz] of npcPathViz) {
      pathGroup.remove(viz.line)
      pathGroup.remove(viz.dots)
      viz.line.geometry.dispose()
      viz.dots.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.isMesh) (m.material as THREE.Material)?.dispose()
      })
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

  function removePlacedObject(objectId: string): void {
    const root = placedMeshRoots.get(objectId)
    if (root) {
      root.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else (mat as THREE.Material)?.dispose()
        }
      })
      placedGroup.remove(root)
    }
    placedMeshRoots.delete(objectId)
    placedHitBoxes.delete(objectId)
    placedObjects.value = placedObjects.value.filter(p => p.id !== objectId)
    if (selection.value?.kind === 'placed' && selection.value.objectId === objectId) {
      setSelection({ kind: 'scene' })
    } else if (root && transformControls.object === root) {
      transformControls.detach()
      transformControls.enabled = false
    }
  }

  // ─── reinitScene — public API for scene switcher ──────────────────────────────

  async function reinitScene(newConfig: SceneEditorConfig): Promise<void> {
    config = newConfig
    _disposePlayCharacter()
    detachPoseNpc()
    clearScene()
    await loadScene(newConfig)
  }

  // ─── D-5b: Play character load / dispose ─────────────────────────────────────

  function _disposePlayCharacter(): void {
    if (charMixer) {
      charMixer.stopAllAction()
      charIdleAction = null
      charWalkAction = null
      charMixer = null
    }
    if (charRoot) {
      charRoot.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else (mat as THREE.Material)?.dispose()
        }
      })
      scene.remove(charRoot)
      charRoot = null
    }
  }

  async function _loadPlayCharacter(): Promise<void> {
    _disposePlayCharacter()
    if (!pendingCharBlobUrl) return

    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(pendingCharBlobUrl)

      // Ground the character: shift mesh so bottom of bbox is at y=0
      const bbox = new THREE.Box3().setFromObject(gltf.scene)
      gltf.scene.position.y -= bbox.min.y

      const root = new THREE.Group()
      root.add(gltf.scene)

      // Spawn at current player capsule position
      const px = playerMesh?.position.x ?? 0
      const pz = playerMesh?.position.z ?? 0
      root.position.set(px, 0, pz)

      scene.add(root)
      charRoot = root
      charMixer = new THREE.AnimationMixer(root)

      // Gather clips: prefer animation pack if provided, fall back to embedded clips
      let clips = gltf.animations
      if (pendingAnimBlobUrl) {
        try {
          const animGltf = await loader.loadAsync(pendingAnimBlobUrl)
          if (animGltf.animations.length > 0) clips = animGltf.animations
        } catch (e) {
          console.warn('[SceneEditor] Anim pack load failed:', e)
        }
      }

      const idleClip = clips.find(a => /idle/i.test(a.name)) ?? clips[0] ?? null
      const walkClip =
        clips.find(a => /walk.*fwd|walking|walk_fwd/i.test(a.name)) ??
        clips.find(a => /^walk/i.test(a.name)) ??
        (clips[1] !== idleClip ? clips[1] : null) ??
        null

      if (idleClip) {
        charIdleAction = charMixer.clipAction(idleClip)
        charIdleAction.setEffectiveWeight(1)
        charIdleAction.play()
      }
      if (walkClip && walkClip !== idleClip) {
        charWalkAction = charMixer.clipAction(walkClip)
        charWalkAction.setEffectiveWeight(0)
        charWalkAction.play()
      }
    } catch (e) {
      console.warn('[SceneEditor] Play character load failed:', e)
    }
  }

  /** Called by SceneEditorView when user picks / clears the play-sim character. */
  async function setPlayCharacterAsset(
    charBlobUrl: string | null,
    animPackBlobUrl: string | null = null,
  ): Promise<void> {
    pendingCharBlobUrl = charBlobUrl
    pendingAnimBlobUrl = animPackBlobUrl
    await _loadPlayCharacter()

    // If already in play mode, update mesh visibility
    const mode = editorCamMode.value
    if (mode === 'follow-3p') {
      if (charRoot) {
        charRoot.visible = true
        if (playerMesh) playerMesh.visible = false
        controls.target.copy(charRoot.position)
      } else {
        if (playerMesh) playerMesh.visible = true
      }
    } else if (mode === 'first-person') {
      if (charRoot) charRoot.visible = false // FPV: camera is the eyes
      if (playerMesh) playerMesh.visible = false
    }
  }

  // ─── Pose editor ─────────────────────────────────────────────────────────────

  function detachPoseNpc(): void {
    if (poseHasBoneAttached || ikActiveChainName !== null) {
      transformControls.detach()
      poseHasBoneAttached = false
      ikActiveChainName = null
      transformControls.setMode(transformMode.value)
      // Re-attach TC to the NPC marker if that NPC is still selected
      const sel = selection.value
      if (sel?.kind === 'npc') {
        const root = npcMarkerRoots.get(sel.entityId)
        if (root) { transformControls.attach(root); transformControls.enabled = true }
        else transformControls.enabled = false
      } else {
        transformControls.enabled = false
      }
    }
    // Clean up IK target spheres
    for (const [, sphere] of ikTargetMeshes) {
      sphere.geometry.dispose()
      ;(sphere.material as THREE.Material).dispose()
    }
    ikTargetGroup.clear()
    ikTargetMeshes.clear()
    ikChainNames.value = []
    if (poseHelper) {
      scene?.remove(poseHelper)
      poseHelper.geometry.dispose()
      poseHelper = null
    }
    if (poseMeshRoot) {
      poseMeshRoot.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.isMesh) {
          m.geometry?.dispose()
          const mat = m.material
          if (Array.isArray(mat)) mat.forEach(ma => ma.dispose())
          else (mat as THREE.Material)?.dispose()
        }
      })
      scene?.remove(poseMeshRoot)
      poseMeshRoot = null
      poseSkinnedMesh = null
    }
  }

  async function attachPoseNpc(entityId: string, blobUrl: string): Promise<string[]> {
    detachPoseNpc()
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(blobUrl)
      const skinnedMeshes: THREE.SkinnedMesh[] = []
      gltf.scene.traverse(obj => { if (obj instanceof THREE.SkinnedMesh) skinnedMeshes.push(obj) })
      const sm = skinnedMeshes[0]
      if (!sm) return []

      // Position near NPC marker and ground the mesh
      const marker = npcMarkerRoots.get(entityId)
      const bbox = new THREE.Box3().setFromObject(gltf.scene)
      gltf.scene.position.set(marker?.position.x ?? 0, -bbox.min.y, marker?.position.z ?? 0)

      scene.add(gltf.scene)
      poseMeshRoot = gltf.scene
      poseSkinnedMesh = sm

      poseHelper = new THREE.SkeletonHelper(sm)
      scene.add(poseHelper)

      // Build IK target spheres at effector world positions for recognized chains
      const newChainNames: string[] = []
      for (const [chainName, chain] of Object.entries(MIXAMO_IK_CHAINS)) {
        const effector = sm.skeleton.getBoneByName(chain.effector)
        if (!effector) continue
        effector.updateWorldMatrix(true, false)
        const worldPos = new THREE.Vector3().setFromMatrixPosition(effector.matrixWorld)
        const color = chainName.startsWith('right') ? '#ff6644' : '#44ff99'
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 8, 6),
          new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
        )
        sphere.position.copy(worldPos)
        sphere.renderOrder = 999
        ikTargetGroup.add(sphere)
        ikTargetMeshes.set(chainName, sphere)
        newChainNames.push(chainName)
      }
      ikChainNames.value = newChainNames

      return sm.skeleton.bones.map(b => b.name)
    } catch (e) {
      console.warn('[PoseEditor] Failed to load character mesh:', e)
      return []
    }
  }

  function selectPoseBone(boneName: string): void {
    if (!poseSkinnedMesh) return
    const bone = poseSkinnedMesh.skeleton.bones.find(b => b.name === boneName) ?? null
    if (!bone) return
    transformControls.detach()
    transformControls.setMode('rotate')
    transformControls.attach(bone)
    transformControls.enabled = true
    poseHasBoneAttached = true
    ikActiveChainName = null
  }

  function selectIkTarget(chainName: string): void {
    const sphere = ikTargetMeshes.get(chainName)
    if (!sphere || !poseSkinnedMesh) return
    transformControls.detach()
    transformControls.setMode('translate')
    transformControls.attach(sphere)
    transformControls.enabled = true
    poseHasBoneAttached = false
    ikActiveChainName = chainName
  }

  function capturePoseSnapshot(): Array<{ bone: string; q: [number, number, number, number] }> {
    if (!poseSkinnedMesh) return []
    return poseSkinnedMesh.skeleton.bones.map(b => ({
      bone: b.name,
      q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] as [number, number, number, number],
    }))
  }

  function resetPoseBones(): void {
    if (!poseSkinnedMesh) return
    poseSkinnedMesh.skeleton.pose()
    // Reposition IK spheres back to bind-pose effector world positions
    for (const [chainName, sphere] of ikTargetMeshes) {
      const chain = MIXAMO_IK_CHAINS[chainName]
      if (!chain) continue
      const effector = poseSkinnedMesh.skeleton.getBoneByName(chain.effector)
      if (!effector) continue
      effector.updateWorldMatrix(true, false)
      sphere.position.setFromMatrixPosition(effector.matrixWorld)
    }
    if (poseHasBoneAttached || ikActiveChainName !== null) {
      transformControls.detach()
      poseHasBoneAttached = false
      ikActiveChainName = null
      transformControls.setMode(transformMode.value)
      const sel = selection.value
      if (sel?.kind === 'npc') {
        const root = npcMarkerRoots.get(sel.entityId)
        if (root) { transformControls.attach(root); transformControls.enabled = true }
        else transformControls.enabled = false
      } else {
        transformControls.enabled = false
      }
    }
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
      // Player selected: enter first-person unless already in a player-attached mode
      if (editorCamMode.value !== 'follow-3p' && editorCamMode.value !== 'first-person') {
        setEditorCamMode('first-person')
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
      } catch (e) {
        console.warn('[restorePlacedObjects] GLB load failed for', obj.id, e)
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
      existing.dots.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.isMesh) (m.material as THREE.Material)?.dispose()
      })
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

  const CAM_MODE_ORDER: EditorCamMode[] = ['orbit', 'first-person', 'follow-3p', 'free-float']

  /** Switch camera mode — handles Three.js state only, no selection changes. */
  function setEditorCamMode(mode: EditorCamMode): void {
    editorCamMode.value = mode
    const mesh = playerMesh
    if (mode === 'orbit') {
      controls.enabled = true
      if (mesh) mesh.visible = false
      if (charRoot) charRoot.visible = false
      if (ffPointerLocked) document.exitPointerLock()
    } else if (mode === 'follow-3p') {
      controls.enabled = true
      controls.minDistance = 2
      controls.maxDistance = 12
      controls.maxPolarAngle = Math.PI * 0.82   // ~148° — prevents going underground
      if (ffPointerLocked) document.exitPointerLock()
      if (charRoot) {
        // Real character: show it, hide capsule, orbit follows char
        charRoot.visible = true
        if (mesh) mesh.visible = false
        controls.target.copy(charRoot.position.clone().setY(charRoot.position.y + 1.0))
      } else {
        // Capsule fallback
        if (mesh) mesh.visible = true
        controls.target.copy(mesh!.position)
      }
      // Reset camera to a fixed behind-character position so orbit starts clean
      const anchor3p = charRoot ?? mesh
      if (anchor3p) {
        camera.position.set(
          anchor3p.position.x + Math.sin(ffYaw) * 5,
          anchor3p.position.y + 2.5,
          anchor3p.position.z + Math.cos(ffYaw) * 5,
        )
      }
      controls.update()
    } else if (mode === 'first-person') {
      controls.enabled = false
      if (mesh) mesh.visible = false
      if (charRoot) charRoot.visible = false  // camera is the eyes — hide body
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      ffYaw = euler.y
      ffPitch = 0
      // Snap camera to eye level immediately — no single-frame artifact from old orbit position
      const fpvAnchor = charRoot ?? playerMesh
      if (fpvAnchor) {
        camera.position.set(
          fpvAnchor.position.x,
          fpvAnchor.position.y + (charRoot ? 1.65 : FPV_EYE_OFFSET),
          fpvAnchor.position.z,
        )
      }
      canvasRef.value?.requestPointerLock()
    } else {
      // free-float
      controls.enabled = false
      if (mesh) mesh.visible = false
      if (charRoot) charRoot.visible = false
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

  /** Tab cycles orbit → first-person → follow-3p → free-float → orbit, syncing selection. */
  function cycleEditorCamMode(): void {
    const next = CAM_MODE_ORDER[(CAM_MODE_ORDER.indexOf(editorCamMode.value) + 1) % CAM_MODE_ORDER.length]
    setCamMode(next)
  }

  // ─── Render loop ─────────────────────────────────────────────────────────────

  function animate(): void {
    animId = requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.05)

    if (editorCamMode.value === 'follow-3p') {
      // Use real character when loaded, capsule otherwise
      const moveTarget: THREE.Object3D | null = charRoot ?? playerMesh
      if (moveTarget) {
        const moveX = (keyState.has('KeyD') ? 1 : 0) - (keyState.has('KeyA') ? 1 : 0)
        const moveZ = (keyState.has('KeyS') ? 1 : 0) - (keyState.has('KeyW') ? 1 : 0)
        const isMoving = moveX !== 0 || moveZ !== 0
        if (isMoving) {
          const spd = 5 * delta
          const camFwd = new THREE.Vector3()
          camera.getWorldDirection(camFwd)
          camFwd.y = 0
          camFwd.normalize()
          const camRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize()
          const move = new THREE.Vector3()
            .addScaledVector(camFwd, -moveZ)
            .addScaledVector(camRight, moveX)
          move.normalize()
          moveTarget.position.addScaledVector(move, spd)
          // Always face camera's forward direction — A/D strafes without spinning character
          if (charRoot) {
            charRoot.rotation.y = Math.atan2(-camFwd.x, -camFwd.z)
          }
        }
        // Keep grounded: capsule center at 0.9, character root at 0
        moveTarget.position.y = charRoot ? 0 : 0.9
        // Animate blend
        if (charMixer) {
          charMixer.update(delta)
          const w = isMoving ? 1 : 0
          charIdleAction?.setEffectiveWeight(1 - w)
          charWalkAction?.setEffectiveWeight(w)
        }
        // Camera follows — frame-rate-independent lerp (k=6 ≈ same feel as 0.1 at 60 fps)
        controls.target.lerp(
          charRoot ? charRoot.position.clone().setY(charRoot.position.y + 1.0) : moveTarget.position,
          1 - Math.exp(-6 * delta),
        )
      }
    } else if (editorCamMode.value === 'first-person') {
      // Position anchor: charRoot preferred (in FPV it's invisible), else capsule
      const anchor: THREE.Object3D | null = charRoot ?? playerMesh
      if (anchor) {
        const spd = 5 * delta
        const sinY = Math.sin(ffYaw)
        const cosY = Math.cos(ffYaw)
        const fwd = new THREE.Vector3(-sinY, 0, -cosY)
        const right = new THREE.Vector3(cosY, 0, -sinY)
        if (keyState.has('KeyW')) anchor.position.addScaledVector(fwd, spd)
        if (keyState.has('KeyS')) anchor.position.addScaledVector(fwd, -spd)
        if (keyState.has('KeyA')) anchor.position.addScaledVector(right, -spd)
        if (keyState.has('KeyD')) anchor.position.addScaledVector(right, spd)
        anchor.position.y = charRoot ? 0 : 0.9
        if (charMixer) charMixer.update(delta)
        // Camera locked to eye level
        camera.position.set(
          anchor.position.x,
          anchor.position.y + (charRoot ? 1.65 : FPV_EYE_OFFSET),
          anchor.position.z,
        )
        camera.rotation.set(ffPitch, ffYaw, 0, 'YXZ')
      }
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
      if (keyState.has('ShiftLeft') || keyState.has('ShiftRight')) ffPos.y += spd
      if (keyState.has('ControlLeft') || keyState.has('ControlRight')) ffPos.y -= spd
      camera.position.copy(ffPos)
      camera.rotation.set(ffPitch, ffYaw, 0, 'YXZ')
    }

    if (editorCamMode.value === 'orbit' || editorCamMode.value === 'follow-3p') {
      controls.update()
    }
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

    // 0.5. IK target sphere hit? (pose editor mode — takes priority over NPC marker)
    if (ikTargetMeshes.size > 0) {
      const ikHits = raycaster.intersectObjects([...ikTargetMeshes.values()])
      if (ikHits.length > 0) {
        for (const [name, mesh] of ikTargetMeshes) {
          if (mesh === ikHits[0].object) { selectIkTarget(name); return }
        }
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
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selection.value?.kind === 'placed') {
          removePlacedObject(selection.value.objectId)
          return
        }
      }
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

  // ─── L0 Asset Gate (F-G3) ────────────────────────────────────────────────────

  const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

  /**
   * Run the deterministic placement gate over every placed object that declares
   * an attachment (F-G3). This is the THREE adapter: it reads live world matrices
   * and world AABBs from the placed roots, then hands plain numbers to the pure
   * validator. Objects without an attachment are free placements and are skipped.
   *
   * Consumed two-tier: export hard-blocks on `blocked` (any veto), drop/save warn.
   */
  function runPlacementGate(): GateSummary {
    placedGroup.updateMatrixWorld(true)
    const _box = new THREE.Box3()
    const verdicts = snapshotPlacedTransforms()
      .filter((o) => o.attachment)
      .map((child) => {
        const att = child.attachment!
        let parentWorldMatrix: Mat4 = IDENTITY_MAT4
        let parentWorldBounds: Aabb | undefined
        // Sentinel parents (room-root / terrain) sit at world origin → identity;
        // their surface bounds are not tracked at L0, so contact-gap is advisory.
        if (att.parentId !== 'room-root' && att.parentId !== 'terrain') {
          const parentRoot = placedMeshRoots.get(att.parentId)
          if (parentRoot) {
            parentRoot.updateWorldMatrix(true, false)
            parentWorldMatrix = parentRoot.matrixWorld.elements
            // Bounds must reflect the visible mesh only. The placed root also holds
            // an invisible, oversized (bbox + 0.2 m) pick hit-box; Box3.setFromObject
            // would union it and inflate the AABB by 0.1 m/side, making the
            // contact-gap veto too lenient. Expand over non-hit-box children instead.
            const hitBox = placedHitBoxes.get(att.parentId)
            _box.makeEmpty()
            for (const child of parentRoot.children) {
              if (child === hitBox) continue
              _box.expandByObject(child)
            }
            if (!_box.isEmpty()) {
              const min: Vec3 = { x: _box.min.x, y: _box.min.y, z: _box.min.z }
              const max: Vec3 = { x: _box.max.x, y: _box.max.y, z: _box.max.z }
              parentWorldBounds = { min, max }
            }
          }
        }
        return validatePlacement({ child, parentWorldMatrix, parentWorldBounds })
      })
    return summarizeVerdicts(verdicts)
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
    _disposePlayCharacter()
    detachPoseNpc()
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
    runPlacementGate,
    restorePlacedObjects,
    setCamMode,
    setNpcPosition,
    setZonePosition,
    addNpcMarker,
    removeNpcMarker,
    addZoneMarker,
    removeZoneMarker,
    removePlacedObject,
    setPlayCharacterAsset,
    attachPoseNpc,
    selectPoseBone,
    capturePoseSnapshot,
    resetPoseBones,
    detachPoseNpc,
    ikChainNames: shallowReadonly(ikChainNames),
    selectIkTarget,
  }
}
