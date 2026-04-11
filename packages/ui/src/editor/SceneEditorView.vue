<!--
  SceneEditorView — unified scene editor shell.

  Layout: [Hierarchy | 3D Viewport | Inspector]

  Packageable in @base/ui — no game imports. The host page (e.g. SceneEditorPage.vue
  in threejs-engine-dev) maps its SceneDescriptor + SceneGameplayPolicy to
  SceneEditorConfig and passes it as a prop.

  Responsibilities:
  - Owns the Three.js canvas via useSceneEditorViewport
  - Orchestrates selection state between hierarchy, viewport, and inspector
  - Manages per-NPC waypoint maps (localStorage-persisted)
  - Routes floor-click events from viewport to inspector path-edit mode
  - Exposes status bar copy-confirmation feedback
-->
<template>
  <div class="scene-editor">

    <!-- Left: Hierarchy -->
    <SceneEditorHierarchy
      v-model="selection"
      :scene-label="sceneLabel"
      :npcs="config.npcs ?? []"
      :zones="config.zones ?? []"
      :npc-path-ids="npcPathIds"
    />

    <!-- Centre: Viewport -->
    <div class="viewport-wrap">
      <canvas ref="canvasRef" class="editor-canvas" />

      <div v-if="!isReady" class="loading-overlay">
        Loading scene…
      </div>

      <!-- Status bar -->
      <div class="status-bar" :class="{ flash: statusFlash }">
        {{ displayStatus }}
      </div>

      <!-- Hint strip (top-left) -->
      <div class="hint-strip">
        <span><kbd>Click</kbd> select</span>
        <span><kbd>Drag</kbd> orbit</span>
        <span><kbd>Scroll</kbd> zoom</span>
        <span v-if="isPathEditing"><kbd>Click floor</kbd> add waypoint &nbsp;<kbd>Ctrl+Z</kbd> undo</span>
        <span v-if="isPathEditing"><kbd>Esc</kbd> stop editing</span>
      </div>
    </div>

    <!-- Right: Inspector -->
    <SceneEditorInspector
      :selection="selection"
      :config="config"
      :waypoint-map="waypointMap"
      @path-edit-start="onPathEditStart"
      @path-edit-stop="onPathEditStop"
      @waypoints-changed="onWaypointsChanged"
      @move-waypoint="onMoveWaypoint"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import * as THREE from 'three'
import { useSceneEditorViewport } from './useSceneEditorViewport'
import SceneEditorHierarchy from './SceneEditorHierarchy.vue'
import SceneEditorInspector from './SceneEditorInspector.vue'
import type { SceneEditorConfig, EditorSelection } from './sceneEditorTypes'

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  config: SceneEditorConfig
  sceneLabel?: string
}>()

// ─── Canvas ref ───────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)

// ─── Viewport ─────────────────────────────────────────────────────────────────

const {
  isReady,
  statusMessage,
  selection: viewportSelection,
  setSelection,
  setPathEditMode,
  updateNpcPath,
  clearNpcPath,
} = useSceneEditorViewport({ canvas: canvasRef, config: props.config })

// ─── Selection sync (hierarchy ↔ viewport) ───────────────────────────────────

// Local selection drives both panels; viewport composable reflects it.
const selection = ref<EditorSelection>(null)

// Viewport-originated clicks update our local selection
watch(viewportSelection, (s) => {
  selection.value = s
})

// Hierarchy/inspector-originated changes push into viewport
watch(selection, (s) => {
  setSelection(s)
})

// ─── Waypoint state ───────────────────────────────────────────────────────────

// Per-entity waypoint arrays — persisted to localStorage
const waypointMap = ref(new Map<string, THREE.Vector3[]>())

const STORAGE_PREFIX = computed(() =>
  props.config.storageKeyPrefix ?? 'scene-editor-waypoints'
)

function storageKey(entityId: string): string {
  return `${STORAGE_PREFIX.value}:${entityId}`
}

// Restore from localStorage on mount
function restoreWaypoints(): void {
  for (const npc of props.config.npcs ?? []) {
    try {
      const raw = localStorage.getItem(storageKey(npc.entityId))
      if (!raw) continue
      const data = JSON.parse(raw) as { x: number; y: number; z: number }[]
      const vecs = data.map(d => new THREE.Vector3(d.x, d.y, d.z))
      waypointMap.value.set(npc.entityId, vecs)
      updateNpcPath(npc.entityId, vecs)
    } catch {}
  }
}

function persistWaypoints(entityId: string, waypoints: THREE.Vector3[]): void {
  try {
    const data = waypoints.map(w => ({ x: w.x, y: w.y, z: w.z }))
    localStorage.setItem(storageKey(entityId), JSON.stringify(data))
  } catch {}
}

function onWaypointsChanged(entityId: string, waypoints: THREE.Vector3[]): void {
  // Replace map entry (new Map to trigger Vue reactivity on ref)
  const next = new Map(waypointMap.value)
  if (waypoints.length > 0) {
    next.set(entityId, waypoints)
  } else {
    next.delete(entityId)
    try { localStorage.removeItem(storageKey(entityId)) } catch {}
  }
  waypointMap.value = next

  if (waypoints.length > 0) {
    persistWaypoints(entityId, waypoints)
    updateNpcPath(entityId, waypoints)
  } else {
    clearNpcPath(entityId)
  }
  flashStatus(`Waypoints updated — ${waypoints.length} point${waypoints.length !== 1 ? 's' : ''}`)
}

function onMoveWaypoint(payload: { entityId: string; from: number; to: number }): void {
  const { entityId, from, to } = payload
  const prev = [...(waypointMap.value.get(entityId) ?? [])]
  if (to < 0 || to >= prev.length) return
  const [item] = prev.splice(from, 1)
  prev.splice(to, 0, item)
  onWaypointsChanged(entityId, prev)
}

// Set of entityIds that have at least one waypoint (for hierarchy badge)
const npcPathIds = computed(() => {
  const ids = new Set<string>()
  for (const [id, wps] of waypointMap.value) {
    if (wps.length > 0) ids.add(id)
  }
  return ids
})

// ─── Path edit mode coordination ──────────────────────────────────────────────

const isPathEditing = ref(false)

function onPathEditStart(entityId: string, cb: (pos: THREE.Vector3) => void): void {
  isPathEditing.value = true
  setPathEditMode(true, cb)
}

function onPathEditStop(): void {
  isPathEditing.value = false
  setPathEditMode(false)
}

// ─── Status bar with flash ────────────────────────────────────────────────────

const displayStatus = ref('')
const statusFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | undefined

watch(statusMessage, (msg) => {
  // Only update display if we're not already showing a flash message
  if (!statusFlash.value) displayStatus.value = msg
})

function flashStatus(msg: string): void {
  clearTimeout(flashTimer)
  displayStatus.value = msg
  statusFlash.value = true
  flashTimer = setTimeout(() => {
    statusFlash.value = false
    displayStatus.value = statusMessage.value
  }, 2500)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

import { onMounted, onUnmounted } from 'vue'

onMounted(() => {
  // Wait one tick for canvas to be in DOM, then restore waypoints
  setTimeout(restoreWaypoints, 100)
})

onUnmounted(() => {
  clearTimeout(flashTimer)
})
</script>

<style scoped>
.scene-editor {
  display: flex;
  width: 100%;
  height: 100%;
  background: #0d0d1a;
  overflow: hidden;
}

/* ── Viewport ─────────────────────────────────────────────────────────────── */
.viewport-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.editor-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0d1a;
  color: #2a4a5a;
  font-family: monospace;
  font-size: 13px;
  pointer-events: none;
}

.status-bar {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.80);
  color: #7ab0d8;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 18px;
  border-radius: 20px;
  pointer-events: none;
  white-space: nowrap;
  border: 1px solid rgba(90,176,245,0.15);
  transition: color 0.2s;
}
.status-bar.flash {
  color: #ffcc00;
  border-color: rgba(255,204,0,0.25);
}

.hint-strip {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  pointer-events: none;
}
.hint-strip span {
  font-size: 10px;
  color: #2a4a5a;
}
kbd {
  display: inline-block;
  background: rgba(0,0,0,0.5);
  color: #3a6080;
  font-family: monospace;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #1a3050;
  margin-right: 2px;
}
</style>
