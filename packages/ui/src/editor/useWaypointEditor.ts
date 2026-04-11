import { ref, onMounted, onUnmounted, shallowReadonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ─── Public API ────────────────────────────────────────────────────────────────

export interface WaypointEditorConfig {
  /** Ref to the canvas element the editor renders into */
  canvas: Ref<HTMLCanvasElement | null>
  /** GLB to raycast against — the navigation surface (road, floor, etc.) */
  floorGlbUrl: string
  /** Additional GLBs to load for visual context only (walls, props, etc.) */
  contextGlbUrls?: string[]
  /** localStorage key for persistence across page refreshes */
  storageKey?: string
  /** Variable name in the generated TypeScript export */
  exportName?: string
}

export interface WaypointEditorReturn {
  waypoints: Readonly<Ref<THREE.Vector3[]>>
  selectedIndex: Readonly<Ref<number | null>>
  isReady: Readonly<Ref<boolean>>
  statusMessage: Readonly<Ref<string>>
  removeWaypoint: (index: number) => void
  moveWaypoint: (from: number, to: number) => void
  clearAll: () => void
  copyToClipboard: () => Promise<void>
  exportAsTypeScript: () => string
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useWaypointEditor(config: WaypointEditorConfig): WaypointEditorReturn {
  const {
    canvas: canvasRef,
    floorGlbUrl,
    contextGlbUrls = [],
    storageKey = 'waypoints:scene',
    exportName = 'WAYPOINTS',
  } = config

  // Reactive state
  const waypoints = ref<THREE.Vector3[]>([])
  const selectedIndex = ref<number | null>(null)
  const isReady = ref(false)
  const statusMessage = ref('Initializing...')

  // Three.js internals
  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let controls: OrbitControls
  let raycaster: THREE.Raycaster
  let floorMeshes: THREE.Object3D[] = []
  let markerGroup: THREE.Group
  let pathLine: THREE.Line
  let animId: number

  // Drag detection — distinguish orbit drag from placement click
  let mouseDownX = 0
  let mouseDownY = 0

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const canvas = canvasRef.value
    if (!canvas) return

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.shadowMap.enabled = true

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#12182b')
    scene.fog = new THREE.Fog('#12182b', 25, 70)

    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100)
    camera.position.set(0, 10, 14)

    controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.update()

    raycaster = new THREE.Raycaster()
    markerGroup = new THREE.Group()
    scene.add(markerGroup)

    // Ambient + directional light
    scene.add(new THREE.AmbientLight('#ffffff', 0.5))
    const sun = new THREE.DirectionalLight('#fff5e0', 1.2)
    sun.position.set(5, 10, 5)
    scene.add(sun)

    // Editor grid — subtle
    scene.add(new THREE.GridHelper(40, 40, '#1a2d4a', '#101e30'))

    // Path line — connects waypoints in order
    pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#ffcc00', linewidth: 2 })
    )
    scene.add(pathLine)

    // Load scene GLBs
    statusMessage.value = 'Loading scene...'
    await loadGLB(floorGlbUrl, true)
    for (const url of contextGlbUrls) {
      await loadGLB(url, false)
    }

    restoreFromStorage()

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)

    animate()
    isReady.value = true
    setCountStatus()
  }

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
      console.warn(`[WaypointEditor] Could not load "${url}":`, e)
    }
  }

  // ─── Render loop ───────────────────────────────────────────────────────────

  function animate() {
    animId = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  function onMouseDown(e: MouseEvent) {
    mouseDownX = e.clientX
    mouseDownY = e.clientY
  }

  function onMouseUp(e: MouseEvent) {
    if (e.button !== 0) return
    const dx = Math.abs(e.clientX - mouseDownX)
    const dy = Math.abs(e.clientY - mouseDownY)
    if (dx > 5 || dy > 5) return // was an orbit drag — skip

    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )

    raycaster.setFromCamera(mouse, camera)

    // Clicking an existing marker → select it
    const markerHits = raycaster.intersectObjects(markerGroup.children, false)
    if (markerHits.length > 0) {
      const idx = markerGroup.children.indexOf(markerHits[0].object as THREE.Mesh)
      selectedIndex.value = idx
      rebuildMarkers()
      statusMessage.value = `Waypoint ${idx} selected — Del to remove, Esc to deselect`
      return
    }

    // Clicking floor → place new waypoint
    const hits = raycaster.intersectObjects(floorMeshes, true)
    if (hits.length > 0) {
      addWaypoint(hits[0].point.clone())
    } else {
      // Miss → deselect
      selectedIndex.value = null
      rebuildMarkers()
      setCountStatus()
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault()
      if (waypoints.value.length > 0) removeWaypoint(waypoints.value.length - 1)
      return
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (selectedIndex.value !== null) removeWaypoint(selectedIndex.value)
      return
    }
    if (e.code === 'Escape') {
      selectedIndex.value = null
      rebuildMarkers()
      setCountStatus()
    }
  }

  function onResize() {
    const canvas = canvasRef.value
    if (!canvas) return
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  }

  // ─── Waypoint operations ───────────────────────────────────────────────────

  function addWaypoint(position: THREE.Vector3): void {
    waypoints.value = [...waypoints.value, position]
    selectedIndex.value = waypoints.value.length - 1
    rebuildMarkers()
    rebuildPathLine()
    persist()
    setCountStatus()
  }

  function removeWaypoint(index: number): void {
    const updated = [...waypoints.value]
    updated.splice(index, 1)
    waypoints.value = updated
    if (selectedIndex.value === index) {
      selectedIndex.value = null
    } else if (selectedIndex.value !== null && selectedIndex.value > index) {
      selectedIndex.value--
    }
    rebuildMarkers()
    rebuildPathLine()
    persist()
    statusMessage.value = `Removed waypoint ${index} — ${waypoints.value.length} remaining`
  }

  function moveWaypoint(from: number, to: number): void {
    if (to < 0 || to >= waypoints.value.length) return
    const updated = [...waypoints.value]
    const [item] = updated.splice(from, 1)
    updated.splice(to, 0, item)
    waypoints.value = updated
    selectedIndex.value = to
    rebuildMarkers()
    rebuildPathLine()
    persist()
  }

  function clearAll(): void {
    waypoints.value = []
    selectedIndex.value = null
    rebuildMarkers()
    rebuildPathLine()
    try { localStorage.removeItem(storageKey) } catch {}
    statusMessage.value = 'Cleared all waypoints'
  }

  // ─── 3D visualization ──────────────────────────────────────────────────────

  function rebuildMarkers(): void {
    markerGroup.clear()
    const geo = new THREE.SphereGeometry(0.18, 10, 8)
    waypoints.value.forEach((wp, i) => {
      const isSelected = i === selectedIndex.value
      const isStart = i === 0
      const isEnd = i === waypoints.value.length - 1 && i > 0
      const color = isSelected ? '#ff4444' : isStart ? '#44ff88' : isEnd ? '#4488ff' : '#ffcc00'
      const mat = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(wp)
      mesh.position.y += 0.18
      markerGroup.add(mesh)
    })
  }

  function rebuildPathLine(): void {
    if (waypoints.value.length < 2) {
      pathLine.geometry.setFromPoints([])
      return
    }
    const points = waypoints.value.map(wp => new THREE.Vector3(wp.x, wp.y + 0.22, wp.z))
    pathLine.geometry.setFromPoints(points)
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  function persist(): void {
    try {
      const data = waypoints.value.map(w => ({ x: w.x, y: w.y, z: w.z }))
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {}
  }

  function restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const data = JSON.parse(raw) as { x: number; y: number; z: number }[]
      waypoints.value = data.map(d => new THREE.Vector3(d.x, d.y, d.z))
      rebuildMarkers()
      rebuildPathLine()
    } catch {}
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  function exportAsTypeScript(): string {
    const date = new Date().toLocaleDateString()
    const lines = waypoints.value
      .map(w => `  new THREE.Vector3(${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)}),`)
      .join('\n')
    return [
      `// Generated by @base/ui WaypointEditor — ${date}`,
      `// storageKey: "${storageKey}"`,
      `import * as THREE from 'three'`,
      ``,
      `export const ${exportName}: THREE.Vector3[] = [`,
      lines || `  // no waypoints placed yet`,
      `]`,
    ].join('\n')
  }

  async function copyToClipboard(): Promise<void> {
    const ts = exportAsTypeScript()
    try {
      await navigator.clipboard.writeText(ts)
      const prev = statusMessage.value
      statusMessage.value = `✓ Copied — paste into your navPath.ts`
      setTimeout(() => { statusMessage.value = prev }, 3000)
    } catch {
      statusMessage.value = `✗ Clipboard blocked — check browser permissions`
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function setCountStatus(): void {
    const n = waypoints.value.length
    statusMessage.value = n === 0
      ? 'Click the floor to place waypoints'
      : `${n} waypoint${n !== 1 ? 's' : ''} — click to add, Del to remove selected`
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  function dispose(): void {
    cancelAnimationFrame(animId)
    const canvas = canvasRef.value
    if (canvas) {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
    }
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('resize', onResize)
    controls?.dispose()
    renderer?.dispose()
    scene?.clear()
    floorMeshes = []
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    waypoints: shallowReadonly(waypoints),
    selectedIndex: shallowReadonly(selectedIndex),
    isReady: shallowReadonly(isReady),
    statusMessage: shallowReadonly(statusMessage),
    removeWaypoint,
    moveWaypoint,
    clearAll,
    copyToClipboard,
    exportAsTypeScript,
  }
}
