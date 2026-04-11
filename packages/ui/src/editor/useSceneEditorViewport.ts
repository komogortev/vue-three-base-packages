import { ref, onMounted, onUnmounted, shallowReadonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SceneEditorConfig, EditorSelection } from './sceneEditorTypes'

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SceneEditorViewportReturn {
  isReady: Readonly<Ref<boolean>>
  statusMessage: Readonly<Ref<string>>
  selection: Readonly<Ref<EditorSelection>>
  /** Set selection from the hierarchy panel (bypasses click raycasting). */
  setSelection: (s: EditorSelection) => void
  /**
   * Toggle path-edit mode for the current NPC selection.
   * When active, floor clicks call onFloorHit instead of selecting scene root.
   */
  setPathEditMode: (active: boolean, onFloorHit?: (pos: THREE.Vector3) => void) => void
  /** Update the path line + dot markers for an NPC. Pass [] to clear. */
  updateNpcPath: (entityId: string, waypoints: THREE.Vector3[]) => void
  /** Remove path visualization for an NPC without needing an empty array call. */
  clearNpcPath: (entityId: string) => void
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useSceneEditorViewport(opts: {
  canvas: Ref<HTMLCanvasElement | null>
  config: SceneEditorConfig
}): SceneEditorViewportReturn {
  const { canvas: canvasRef, config } = opts

  const isReady = ref(false)
  const statusMessage = ref('Initializing…')
  const selection = ref<EditorSelection>(null)

  // Three.js core
  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let controls: OrbitControls
  let raycaster: THREE.Raycaster
  let animId: number

  // Raycast targets
  let floorMeshes: THREE.Object3D[] = []

  // Marker groups
  const npcMarkerGroup = new THREE.Group()
  const zoneMarkerGroup = new THREE.Group()
  const pathGroup = new THREE.Group()

  // Selection maps: entityId/zoneId → clickable mesh
  const npcSpheres = new Map<string, THREE.Mesh>()
  const zoneRingPips = new Map<string, THREE.Mesh>()

  // Per-NPC path visualization
  const npcPathViz = new Map<string, { line: THREE.Line; dots: THREE.Group }>()

  // Shared geometries (disposed on cleanup)
  const npcSphereGeo = new THREE.SphereGeometry(0.35, 12, 8)
  const dotGeo = new THREE.SphereGeometry(0.12, 8, 6)

  // Drag detection
  let mouseDownX = 0
  let mouseDownY = 0

  // Path-edit mode
  let pathEditActive = false
  let onFloorHitCb: ((pos: THREE.Vector3) => void) | undefined

  // ─── Init ───────────────────────────────────────────────────────────────────

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

    // Lighting — editor-neutral, not matching game atmosphere
    scene.add(new THREE.AmbientLight('#c8d8f0', 0.65))
    const sun = new THREE.DirectionalLight('#fff5e0', 1.3)
    sun.position.set(10, 20, 10)
    scene.add(sun)

    // Grid — subtle reference plane
    scene.add(new THREE.GridHelper(100, 100, '#1a2d4a', '#0e1622'))

    // Add marker groups to scene
    scene.add(npcMarkerGroup)
    scene.add(zoneMarkerGroup)
    scene.add(pathGroup)

    // Load scene GLBs
    statusMessage.value = 'Loading scene…'
    await loadGLB(config.floorGlbUrl, /* isFloor */ true)
    for (const url of config.contextGlbUrls ?? []) {
      await loadGLB(url, false)
    }

    buildNpcMarkers()
    buildZoneMarkers()
    buildSpawnMarker()

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)

    animate()
    isReady.value = true
    statusMessage.value = sceneStatus()
  }

  // ─── GLB loading ────────────────────────────────────────────────────────────

  async function loadGLB(url: string, isFloor: boolean): Promise<void> {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(url)
      scene.add(gltf.scene)
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

  function buildNpcMarkers(): void {
    npcMarkerGroup.clear()
    npcSpheres.clear()

    for (const npc of config.npcs ?? []) {
      const yBase = npc.y ?? 0

      // Sphere body
      const mat = new THREE.MeshBasicMaterial({ color: '#00aaff' })
      const sphere = new THREE.Mesh(npcSphereGeo, mat)
      sphere.position.set(npc.x, yBase + 0.9, npc.z)
      npcMarkerGroup.add(sphere)
      npcSpheres.set(npc.entityId, sphere)

      // Vertical stem so sphere is clearly above ground
      const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6)
      const stemMat = new THREE.MeshBasicMaterial({ color: '#0077bb' })
      const stem = new THREE.Mesh(stemGeo, stemMat)
      stem.position.set(npc.x, yBase + 0.45, npc.z)
      npcMarkerGroup.add(stem)

      // Proximity ring (flat disc outline)
      if (npc.proximityRadius && npc.proximityRadius > 0) {
        const r = npc.proximityRadius
        const ringGeo = new THREE.RingGeometry(r - 0.06, r + 0.06, 56)
        ringGeo.rotateX(-Math.PI / 2)
        const ringMat = new THREE.MeshBasicMaterial({
          color: '#00aaff', transparent: true, opacity: 0.22, side: THREE.DoubleSide,
        })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.position.set(npc.x, yBase + 0.03, npc.z)
        npcMarkerGroup.add(ring)
      }
    }
  }

  function buildZoneMarkers(): void {
    zoneMarkerGroup.clear()
    zoneRingPips.clear()

    for (const zone of config.zones ?? []) {
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

  function buildSpawnMarker(): void {
    if (!config.spawnPoint) return
    const { x, z } = config.spawnPoint
    // Small diamond (rotated box)
    const geo = new THREE.OctahedronGeometry(0.3)
    const mat = new THREE.MeshBasicMaterial({ color: '#ff44ff' })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, 0.4, z)
    scene.add(mesh)
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  function setSelection(s: EditorSelection): void {
    selection.value = s
    refreshNpcHighlights()
    statusMessage.value = describeSelection(s)
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
      return sceneStatus()
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
    return ''
  }

  function sceneStatus(): string {
    const n = config.npcs?.length ?? 0
    const z = config.zones?.length ?? 0
    return `Scene loaded — ${n} NPC${n !== 1 ? 's' : ''}, ${z} zone${z !== 1 ? 's' : ''}`
  }

  // ─── Path edit mode ──────────────────────────────────────────────────────────

  function setPathEditMode(active: boolean, cb?: (pos: THREE.Vector3) => void): void {
    pathEditActive = active
    onFloorHitCb = cb
    // Refresh status to show/hide floor-click hint
    statusMessage.value = describeSelection(selection.value)
  }

  // ─── Path visualization ──────────────────────────────────────────────────────

  function updateNpcPath(entityId: string, waypoints: THREE.Vector3[]): void {
    // Remove existing visualization
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

    // Path line
    const pts = waypoints.map(w => new THREE.Vector3(w.x, w.y + 0.28, w.z))
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: lineColor }))

    // Dot markers per waypoint
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

  // ─── Render loop ─────────────────────────────────────────────────────────────

  function animate(): void {
    animId = requestAnimationFrame(animate)
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
    // Ignore orbit drags
    if (Math.abs(e.clientX - mouseDownX) > 5 || Math.abs(e.clientY - mouseDownY) > 5) return

    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(mouse, camera)

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

    // 3. Floor hit
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
    if (e.code === 'Escape') setSelection({ kind: 'scene' })
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
    window.removeEventListener('resize', onResize)
    controls?.dispose()
    renderer?.dispose()
    npcSphereGeo.dispose()
    dotGeo.dispose()
    scene?.clear()
    floorMeshes = []
    npcSpheres.clear()
    zoneRingPips.clear()
    npcPathViz.clear()
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    isReady: shallowReadonly(isReady),
    statusMessage: shallowReadonly(statusMessage),
    selection: shallowReadonly(selection),
    setSelection,
    setPathEditMode,
    updateNpcPath,
    clearNpcPath,
  }
}
