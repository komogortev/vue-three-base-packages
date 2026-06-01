<!--
  SceneEditorView — unified scene editor shell.

  Layout: [Hierarchy | 3D Viewport | Inspector]

  Packageable in @base/ui — no game imports. The host page maps its project scenes
  to SceneEditorEntry[] and passes them via the `scenes` prop. The editor opens
  with the first entry (typically sandbox) selected by default.

  When only `config` is provided (no `scenes`), single-scene mode is used for
  backward compat.

  Responsibilities:
  - Owns the Three.js canvas via useSceneEditorViewport
  - Orchestrates selection state between hierarchy, viewport, and inspector
  - Manages per-NPC waypoint maps (localStorage-persisted, keyed per scene)
  - Routes floor-click events from viewport to inspector path-edit mode
  - Exposes status bar copy-confirmation feedback
-->
<template>
  <div class="scene-editor">

    <!-- Left: Hierarchy -->
    <SceneEditorHierarchy
      v-model="selection"
      :scene-label="activeSceneLabel"
      :npcs="localNpcs"
      :zones="localZones"
      :placed-objects="placedObjects"
      :npc-path-ids="npcPathIds"
      :scenes="scenes"
      :active-scene-id="activeSceneId"
      :editor-cam-mode="editorCamMode"
      :active-saved-scene-id="activeSavedSceneId"
      @switch-scene="onSwitchScene"
      @asset-picked="onAssetPicked"
      @load-scene="onLoadScene"
      @add-npc="onAddNpc"
      @add-zone="onAddZone"
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
        <span v-if="!isInPlaceMode && !isPlayerMode"><kbd>Click</kbd> select</span>
        <span v-if="!isInPlaceMode && !isPlayerMode"><kbd>Drag</kbd> orbit</span>
        <span v-if="!isInPlaceMode && !isPlayerMode"><kbd>Scroll</kbd> zoom</span>
        <span v-if="hasObjectSelected && !isPathEditing && !isInPlaceMode"><kbd>T</kbd> translate · <kbd>R</kbd> rotate · <kbd>S</kbd> scale</span>
        <span v-if="hasObjectSelected && !isInPlaceMode"><kbd>Esc</kbd> deselect</span>
        <span v-if="isPathEditing"><kbd>Click floor</kbd> add waypoint &nbsp;<kbd>Ctrl+Z</kbd> undo</span>
        <span v-if="isPathEditing"><kbd>Esc</kbd> stop editing</span>
        <span v-if="isInPlaceMode"><kbd>Click floor</kbd> place object</span>
        <span v-if="isInPlaceMode"><kbd>Esc</kbd> cancel</span>
        <span v-if="editorCamMode === 'follow-3p'"><kbd>WASD</kbd> move player</span>
        <span v-if="editorCamMode === 'follow-3p'"><kbd>Drag</kbd> orbit camera</span>
        <span v-if="editorCamMode === 'first-person'"><kbd>WASD</kbd> move · <kbd>Mouse</kbd> look</span>
        <span v-if="editorCamMode === 'free-float'"><kbd>WASD</kbd> fly · <kbd>E/Q</kbd> up/down</span>
        <span v-if="editorCamMode === 'free-float'"><kbd>Mouse</kbd> look</span>
        <span v-if="!isInPlaceMode"><kbd>Tab</kbd> cycle camera</span>
        <span v-if="isPlayerMode"><kbd>Esc</kbd> back to orbit</span>
      </div>

      <!-- Camera mode buttons (top-right corner) -->
      <div class="cam-buttons">
        <button
          v-for="cam in CAM_OPTIONS"
          :key="cam.mode"
          :class="['cam-btn', { active: editorCamMode === cam.mode }]"
          :title="cam.title"
          @click="setCamMode(cam.mode)"
        >{{ cam.label }}</button>
      </div>

      <!-- Save / Export toolbar (bottom-right) -->
      <div class="save-toolbar">
        <input
          v-model="sceneName"
          class="scene-name-input"
          placeholder="Scene name…"
          maxlength="60"
          spellcheck="false"
        />
        <button
          class="save-btn"
          :disabled="placedObjects.length === 0 || isSaving"
          title="Save scene to browser IndexedDB — accessible from Sandbox"
          @click="saveScene"
        >{{ isSaving ? 'Saving…' : 'Save Scene' }}</button>
        <button
          class="save-btn export-btn"
          :disabled="placedObjects.length === 0 || isExporting"
          title="Download a ZIP containing the scene manifest and all asset blobs"
          @click="onExportZip"
        >{{ isExporting ? 'Exporting…' : 'Export ZIP' }}</button>
        <button
          class="save-btn ts-btn"
          title="Copy scene config as TypeScript literal"
          @click="onCopyConfigTs"
        >{{ isCopyingTs ? 'Copied!' : 'Copy TS' }}</button>
      </div>

      <!-- Transform toolbar (top-right, visible when object selected) -->
      <div v-if="hasObjectSelected" class="transform-toolbar">
        <button
          :class="['tb-btn', { active: transformMode === 'translate' }]"
          title="Translate (T)"
          @click="setTransformMode('translate')"
        >T</button>
        <button
          :class="['tb-btn', { active: transformMode === 'rotate' }]"
          title="Rotate (R)"
          @click="setTransformMode('rotate')"
        >R</button>
        <button
          :class="['tb-btn', { active: transformMode === 'scale' }]"
          title="Scale (S)"
          @click="setTransformMode('scale')"
        >S</button>
      </div>
    </div>

    <!-- Right: Inspector -->
    <SceneEditorInspector
      :selection="selection"
      :config="effectiveConfig"
      :npcs="localNpcs"
      :zones="localZones"
      :waypoint-map="waypointMap"
      :player-char-asset-id="playerCharAssetId"
      :player-anim-pack-asset-id="playerAnimPackAssetId"
      @path-edit-start="onPathEditStart"
      @path-edit-stop="onPathEditStop"
      @waypoints-changed="onWaypointsChanged"
      @move-waypoint="onMoveWaypoint"
      @npc-changed="(id, patch) => onNpcChanged(id, patch)"
      @zone-changed="(id, patch) => onZoneChanged(id, patch)"
      @remove-npc="onRemoveNpc"
      @remove-zone="onRemoveZone"
      @pick-npc-asset="onPickNpcAsset"
      @pick-player-asset="onPickPlayerAsset"
      @clear-player-char="onClearPlayerChar"
      @clear-player-anim-pack="onClearPlayerAnimPack"
      @pick-ambient-audio="onPickAmbientAudio"
      @set-ambient-audio-volume="onSetAmbientAudioVolume"
      @clear-ambient-audio="onClearAmbientAudio"
    />

    <!-- Asset picker modal (F-9 / D-5b) -->
    <AssetPicker
      :open="pickerOpen"
      :kind-filter="pickerKind"
      @close="pickerOpen = false"
      @select="onPickerSelect"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { nanoid } from 'nanoid'
import { useSceneEditorViewport } from './useSceneEditorViewport'
import { useAssetStore } from './useAssetStore'
import { exportSandboxZip } from './exportSandboxZip'
import { serializeEditorConfigTS } from './SceneEditorExporter'
import type { SandboxSceneSave } from './sandboxSceneSchema'
import { assetDb, type AssetKind } from './assetDb'
import SceneEditorHierarchy from './SceneEditorHierarchy.vue'
import SceneEditorInspector from './SceneEditorInspector.vue'
import AssetPicker from './AssetPicker.vue'
import type { SceneEditorConfig, SceneEditorEntry, EditorSelection, EditorCamMode, EditorNpcEntry, EditorZoneEntry } from './sceneEditorTypes'

const CAM_OPTIONS: { mode: EditorCamMode; label: string; title: string }[] = [
  { mode: 'orbit',        label: 'Orbit', title: 'Orbit — free camera (Tab)' },
  { mode: 'first-person', label: 'FPV',   title: 'First-person view (Tab)' },
  { mode: 'follow-3p',   label: '3P',    title: 'Third-person follow (Tab)' },
  { mode: 'free-float',  label: 'Float', title: 'Free-fly camera (Tab)' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  /**
   * Multi-scene mode: list of named scenes to show in the switcher dropdown.
   * First entry is selected by default (should be sandbox).
   */
  scenes?: SceneEditorEntry[]
  /**
   * Single-scene mode (backward compat). Ignored when `scenes` is provided.
   */
  config?: SceneEditorConfig
  /** Override label shown in hierarchy header (single-scene mode only). */
  sceneLabel?: string
}>()

// ─── Active scene ─────────────────────────────────────────────────────────────

const activeSceneId = ref<string>(
  props.scenes && props.scenes.length > 0
    ? props.scenes[0].id
    : '__single__'
)

const activeConfig = computed<SceneEditorConfig>(() => {
  if (props.scenes && props.scenes.length > 0) {
    return props.scenes.find(s => s.id === activeSceneId.value)?.config
      ?? props.scenes[0].config
  }
  return props.config ?? { npcs: [], zones: [] }
})

const activeSceneLabel = computed<string | undefined>(() => {
  if (props.scenes && props.scenes.length > 0) {
    return props.scenes.find(s => s.id === activeSceneId.value)?.label
  }
  return props.sceneLabel
})

// ─── Local NPC / zone state (mutable editor layer over read-only prop config) ──

const localNpcs = ref<EditorNpcEntry[]>([])
const localZones = ref<EditorZoneEntry[]>([])

function initLocalEntries(): void {
  localNpcs.value = (activeConfig.value.npcs ?? []).map(n => ({ ...n }))
  localZones.value = (activeConfig.value.zones ?? []).map(z => ({ ...z }))
}

// ─── Ambient audio state (Phase 5 S1) ────────────────────────────────────────

const ambientAudioAssetId = ref<string | undefined>(undefined)
const ambientAudioVolume = ref<number | undefined>(undefined)

/** Config passed to composable — prop config with local NPC/zone edits overlaid. */
const effectiveConfig = computed<SceneEditorConfig>(() => ({
  ...activeConfig.value,
  npcs: localNpcs.value,
  zones: localZones.value,
  ambientAudioAssetId: ambientAudioAssetId.value,
  ambientAudioVolume: ambientAudioVolume.value,
}))

// ─── Canvas ref ───────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)

// ─── Viewport ─────────────────────────────────────────────────────────────────

const {
  isReady,
  statusMessage,
  selection: viewportSelection,
  transformMode,
  editorCamMode,
  placedObjects,
  isInPlaceMode,
  npcLivePositions,
  zoneLivePositions,
  setSelection,
  setTransformMode,
  setPathEditMode,
  updateNpcPath,
  clearNpcPath,
  reinitScene,
  enterPlaceMode,
  snapshotPlacedTransforms,
  restorePlacedObjects,
  setCamMode,
  setNpcPosition,
  setZonePosition,
  addNpcMarker,
  removeNpcMarker,
  addZoneMarker,
  removeZoneMarker,
  setPlayCharacterAsset,
} = useSceneEditorViewport({
  canvas: canvasRef,
  config: effectiveConfig.value,
  onPathEditCancel: () => {
    isPathEditing.value = false
  },
})

// ─── Asset store (for place mode) ────────────────────────────────────────────

const assetStore = useAssetStore()

function onAssetPicked(assetId: string): void {
  const asset = assetStore.getById(assetId)
  if (!asset) return
  const blobUrl = assetStore.resolveBlobUrl(assetId)
  if (!blobUrl) return
  const objectId = `placed-${nanoid(6)}`
  enterPlaceMode(objectId, assetId, blobUrl, asset.name)
}

// ─── Scene switching ──────────────────────────────────────────────────────────

async function onSwitchScene(sceneId: string): Promise<void> {
  if (sceneId === activeSceneId.value) return
  activeSceneId.value = sceneId
  // Reset local NPC/zone state to new scene's prop config
  initLocalEntries()
  // Reset saved-scene tracking so the next save creates a new Dexie row for this scene.
  currentSceneId.value = null
  activeSavedSceneId.value = null
  sceneName.value = 'Untitled Scene'
  ambientAudioAssetId.value = undefined
  ambientAudioVolume.value = undefined
  // Clear waypoint display — new scene has its own localStorage keys
  waypointMap.value = new Map()
  // Reset path-edit mode
  isPathEditing.value = false
  setPathEditMode(false)
  // Reload viewport with effective config (local NPC/zone edits merged in)
  await reinitScene(effectiveConfig.value)
  // Restore waypoints for new scene
  restoreWaypoints()
}

// ─── Load saved scene ────────────────────────────────────────────────────────

const isLoading = ref(false)

async function onLoadScene(sceneId: string): Promise<void> {
  if (isLoading.value) return
  isLoading.value = true
  try {
    const row = await assetDb.scenes.get(sceneId)
    if (!row) { flashStatus('Scene not found'); return }

    // Reset ambient audio before restoring from saved config
    ambientAudioAssetId.value = undefined
    ambientAudioVolume.value = undefined
    if (row.config) {
      ambientAudioAssetId.value = row.config.ambientAudioAssetId
      ambientAudioVolume.value = row.config.ambientAudioVolume
    }

    // Reload scene geometry (clears all placed objects)
    await reinitScene(activeConfig.value)

    // Resolve blob URLs — skip objects whose asset was deleted
    const resolvable = row.placedObjects.flatMap(obj => {
      const blobUrl = assetStore.resolveBlobUrl(obj.assetId)
      return blobUrl ? [{ ...obj, blobUrl }] : []
    })

    await restorePlacedObjects(resolvable)

    // Wire save tracking so subsequent "Save Scene" overwrites this row
    currentSceneId.value = row.id
    activeSavedSceneId.value = row.id
    sceneName.value = row.name

    const skipped = row.placedObjects.length - resolvable.length
    const skipNote = skipped > 0 ? ` (${skipped} missing asset${skipped !== 1 ? 's' : ''} skipped)` : ''
    flashStatus(`Loaded "${row.name}" — ${resolvable.length} object${resolvable.length !== 1 ? 's' : ''}${skipNote}`)
  } catch {
    flashStatus('Load failed')
  } finally {
    isLoading.value = false
  }
}

// ─── Selection sync (hierarchy ↔ viewport) ───────────────────────────────────

const selection = ref<EditorSelection>(null)

// Guard prevents the two watchers below from bouncing off each other.
let _selSyncing = false

watch(viewportSelection, (s) => {
  if (_selSyncing) return
  _selSyncing = true
  selection.value = s
  _selSyncing = false
})

watch(selection, (s) => {
  if (_selSyncing) return
  _selSyncing = true
  setSelection(s)
  _selSyncing = false
})

// ─── TC drag → local NPC / zone position sync ────────────────────────────────

watch(npcLivePositions, (positions) => {
  for (const [id, pos] of positions) {
    const npc = localNpcs.value.find(n => n.entityId === id)
    if (npc) { npc.x = pos.x; npc.z = pos.z }
  }
}, { deep: false })

watch(zoneLivePositions, (positions) => {
  for (const [id, pos] of positions) {
    const zone = localZones.value.find(z => z.id === id)
    if (zone) { zone.x = pos.x; zone.z = pos.z }
  }
}, { deep: false })

// ─── Waypoint state ───────────────────────────────────────────────────────────

const waypointMap = ref(new Map<string, THREE.Vector3[]>())

const STORAGE_PREFIX = computed(() =>
  activeConfig.value.storageKeyPrefix ?? 'scene-editor-waypoints'
)

function storageKey(entityId: string): string {
  return `${STORAGE_PREFIX.value}:${entityId}`
}

function restoreWaypoints(): void {
  for (const npc of activeConfig.value.npcs ?? []) {
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

const npcPathIds = computed(() => {
  const ids = new Set<string>()
  for (const [id, wps] of waypointMap.value) {
    if (wps.length > 0) ids.add(id)
  }
  return ids
})

// ─── Derived selection state ──────────────────────────────────────────────────

/** True when an NPC, zone, or placed object is selected (gizmo is visible; excludes player). */
const hasObjectSelected = computed(() =>
  selection.value?.kind === 'npc' ||
  selection.value?.kind === 'zone' ||
  selection.value?.kind === 'placed'
)

const isPlayerMode = computed(() => editorCamMode.value !== 'orbit')

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

// ─── Save / Export ───────────────────────────────────────────────────────────

/** Scene name shown in the save toolbar input. */
const sceneName = ref('Untitled Scene')
/** Non-null after first save — used to overwrite rather than create a new row. */
const currentSceneId = ref<string | null>(null)
/** ID of the Dexie saved scene currently loaded in the editor — drives dropdown selection. */
const activeSavedSceneId = ref<string | null>(null)
const isSaving = ref(false)

function buildSave(): SandboxSceneSave {
  return {
    version: 1,
    name: sceneName.value.trim() || 'Untitled Scene',
    savedAt: new Date().toISOString(),
    placedObjects: snapshotPlacedTransforms(),
  }
}

async function saveScene(): Promise<void> {
  if (isSaving.value) return
  isSaving.value = true
  try {
    const save = buildSave()
    // If we have a tracked scene ID but the user renamed it, unlink and fall through
    // to upsert-by-name so we don't silently overwrite the original row under a new name.
    if (currentSceneId.value) {
      const tracked = await assetDb.scenes.get(currentSceneId.value)
      if (tracked && tracked.name !== save.name) currentSceneId.value = null
    }
    if (!currentSceneId.value) {
      // Upsert by name — reuse the existing row if one with this name already exists.
      const existing = await assetDb.scenes.where('name').equals(save.name!).first()
      currentSceneId.value = existing?.id ?? `saved-${nanoid(8)}`
    }
    await assetDb.scenes.put({
      id: currentSceneId.value,
      name: save.name!,
      savedAt: save.savedAt,
      placedObjects: save.placedObjects,
      config: effectiveConfig.value,
    })
    const n = save.placedObjects.length
    flashStatus(`Saved "${save.name}" — ${n} object${n !== 1 ? 's' : ''}`)
  } catch {
    flashStatus('Save failed')
  } finally {
    isSaving.value = false
  }
}

const isExporting = ref(false)

async function onExportZip(): Promise<void> {
  if (isExporting.value) return
  isExporting.value = true
  try {
    await exportSandboxZip(buildSave())
    const n = placedObjects.value.length
    flashStatus(`ZIP exported — ${n} object${n !== 1 ? 's' : ''}`)
  } catch {
    flashStatus('ZIP export failed')
  } finally {
    isExporting.value = false
  }
}

// ─── NPC / zone mutations (F-11) ─────────────────────────────────────────────

function onAddNpc(): void {
  const entityId = `npc-${nanoid(6)}`
  const npc: EditorNpcEntry = { entityId, label: entityId, x: 0, z: 0 }
  localNpcs.value = [...localNpcs.value, npc]
  addNpcMarker(npc)
  setSelection({ kind: 'npc', entityId })
}

function onRemoveNpc(entityId: string): void {
  localNpcs.value = localNpcs.value.filter(n => n.entityId !== entityId)
  removeNpcMarker(entityId)
}

function onAddZone(): void {
  const id = `zone-${nanoid(6)}`
  const zone: EditorZoneEntry = { id, type: 'proximity', label: id, x: 0, z: 0, radius: 3 }
  localZones.value = [...localZones.value, zone]
  addZoneMarker(zone)
  setSelection({ kind: 'zone', id })
}

function onRemoveZone(id: string): void {
  localZones.value = localZones.value.filter(z => z.id !== id)
  removeZoneMarker(id)
}

function onNpcChanged(entityId: string, patch: Partial<EditorNpcEntry>): void {
  const npc = localNpcs.value.find(n => n.entityId === entityId)
  if (!npc) return
  Object.assign(npc, patch)
  if ('x' in patch || 'z' in patch) {
    setNpcPosition(entityId, npc.x, npc.z)
  }
}

function onZoneChanged(id: string, patch: Partial<EditorZoneEntry>): void {
  const zone = localZones.value.find(z => z.id === id)
  if (!zone) return
  Object.assign(zone, patch)
  if ('x' in patch || 'z' in patch) {
    setZonePosition(id, zone.x, zone.z)
  }
}

// ─── TS config export (F-13) ─────────────────────────────────────────────────

const isCopyingTs = ref(false)

async function onCopyConfigTs(): Promise<void> {
  const ts = serializeEditorConfigTS(localNpcs.value, localZones.value, effectiveConfig.value)
  try {
    await navigator.clipboard.writeText(ts)
    isCopyingTs.value = true
    flashStatus('Scene config TS copied to clipboard')
    setTimeout(() => { isCopyingTs.value = false }, 1500)
  } catch {
    flashStatus('Clipboard write failed')
  }
}

// ─── NPC + player asset picker (F-9 / D-5b) ─────────────────────────────────

const pickerOpen = ref(false)
const pickerEntityId = ref('')
const pickerKind = ref<AssetKind>('character')
const pickerIsForPlayer = ref(false)
const pickerIsForAmbientAudio = ref(false)

function onPickNpcAsset(entityId: string, kind: 'character' | 'animation-pack'): void {
  pickerEntityId.value = entityId
  pickerKind.value = kind
  pickerIsForPlayer.value = false
  pickerIsForAmbientAudio.value = false
  pickerOpen.value = true
}

// ─── D-5b: play-sim player character ─────────────────────────────────────────

const playerCharAssetId = ref<string | undefined>(undefined)
const playerAnimPackAssetId = ref<string | undefined>(undefined)

function onPickPlayerAsset(kind: 'character' | 'animation-pack'): void {
  pickerKind.value = kind
  pickerIsForPlayer.value = true
  pickerIsForAmbientAudio.value = false
  pickerOpen.value = true
}

// ─── Phase 5 S1: ambient audio handlers ──────────────────────────────────────

function onPickAmbientAudio(): void {
  pickerKind.value = 'audio'
  pickerIsForPlayer.value = false
  pickerIsForAmbientAudio.value = true
  pickerOpen.value = true
}

function onSetAmbientAudioVolume(volume: number): void {
  ambientAudioVolume.value = volume
}

function onClearAmbientAudio(): void {
  ambientAudioAssetId.value = undefined
  ambientAudioVolume.value = undefined
}

function onClearPlayerChar(): void {
  playerCharAssetId.value = undefined
  void applyPlayerCharAsset()
}

function onClearPlayerAnimPack(): void {
  playerAnimPackAssetId.value = undefined
  void applyPlayerCharAsset()
}

async function applyPlayerCharAsset(): Promise<void> {
  const charId = playerCharAssetId.value
  const animId = playerAnimPackAssetId.value
  const charUrl = charId ? assetStore.resolveBlobUrl(charId) ?? null : null
  const animUrl = animId ? assetStore.resolveBlobUrl(animId) ?? null : null
  await setPlayCharacterAsset(charUrl, animUrl)
}

function onPickerSelect(assetId: string): void {
  pickerOpen.value = false
  if (pickerIsForAmbientAudio.value) {
    ambientAudioAssetId.value = assetId
    pickerIsForAmbientAudio.value = false
  } else if (pickerIsForPlayer.value) {
    if (pickerKind.value === 'character') {
      playerCharAssetId.value = assetId
    } else {
      playerAnimPackAssetId.value = assetId
    }
    pickerIsForPlayer.value = false
    void applyPlayerCharAsset()
  } else {
    const patch: Partial<EditorNpcEntry> =
      pickerKind.value === 'character'
        ? { assetId }
        : { animationPackAssetId: assetId }
    onNpcChanged(pickerEntityId.value, patch)
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  initLocalEntries()
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

/* ── Camera mode buttons ─────────────────────────────────────────────────── */
.cam-buttons {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 3px;
}
.cam-btn {
  background: rgba(0, 0, 0, 0.70);
  color: #3a6080;
  border: 1px solid #1a3050;
  border-radius: 4px;
  font-family: monospace;
  font-size: 9px;
  font-weight: bold;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.cam-btn:hover {
  color: #7ab0d8;
  border-color: rgba(90, 176, 245, 0.3);
}
.cam-btn.active {
  background: rgba(0, 170, 255, 0.15);
  color: #00aaff;
  border-color: rgba(0, 170, 255, 0.5);
}

/* ── Transform toolbar ────────────────────────────────────────────────────── */
.transform-toolbar {
  position: absolute;
  top: 38px;  /* shifted down to clear the camera buttons row */
  right: 10px;
  display: flex;
  gap: 4px;
}

.tb-btn {
  background: rgba(0, 0, 0, 0.70);
  color: #3a6080;
  border: 1px solid #1a3050;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  font-weight: bold;
  width: 24px;
  height: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tb-btn:hover {
  color: #7ab0d8;
  border-color: rgba(90, 176, 245, 0.3);
}
.tb-btn.active {
  background: rgba(0, 170, 255, 0.15);
  color: #00aaff;
  border-color: rgba(0, 170, 255, 0.5);
}

/* ── Save / Export toolbar ────────────────────────────────────────────────── */
.save-toolbar {
  position: absolute;
  bottom: 44px; /* above the status bar */
  right: 10px;
  display: flex;
  gap: 6px;
}

.save-btn {
  background: rgba(0, 0, 0, 0.70);
  color: #3a6080;
  border: 1px solid #1a3050;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  font-weight: bold;
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.save-btn:hover:not(:disabled) {
  color: #7ab0d8;
  border-color: rgba(90, 176, 245, 0.3);
}
.save-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.save-btn.export-btn:hover:not(:disabled) {
  color: #c099ff;
  border-color: rgba(192, 153, 255, 0.3);
}
.save-btn.ts-btn:hover:not(:disabled) {
  color: #80ffcc;
  border-color: rgba(128, 255, 204, 0.3);
}
.scene-name-input {
  background: rgba(0, 0, 0, 0.70);
  color: #a0c4e0;
  border: 1px solid #1a3050;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  padding: 4px 8px;
  width: 140px;
  outline: none;
  transition: border-color 0.15s, color 0.15s;
}
.scene-name-input:focus {
  border-color: rgba(90, 176, 245, 0.4);
  color: #c8e0f0;
}
.scene-name-input::placeholder {
  color: #2a4060;
}
</style>
