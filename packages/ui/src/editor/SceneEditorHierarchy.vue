<!--
  SceneEditorHierarchy — left panel, tree of scene objects.

  Groups: Scene Settings | NPCs | Trigger Zones
  Clicking a row emits 'select' to sync viewport selection.
-->
<template>
  <aside class="hierarchy">
    <header class="hierarchy-header">
      <span class="title">Scene</span>
      <!-- Scene switcher: static configs + saved Dexie scenes -->
      <select
        v-if="scenes && scenes.length > 0"
        class="scene-select"
        :value="activeSavedSceneId ?? activeSceneId"
        @change="onDropdownChange"
      >
        <option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.label }}</option>
        <optgroup v-if="savedScenes.length > 0" label="Saved">
          <option v-for="ss in savedScenes" :key="ss.id" :value="ss.id">{{ ss.name }}</option>
        </optgroup>
      </select>
      <!-- Single-scene label badge (backward compat) -->
      <span v-else-if="sceneLabel" class="scene-badge">{{ sceneLabel }}</span>
    </header>

    <!-- Assets section (uploaded GLB/FBX registry) -->
    <SceneEditorAssetsSection @asset-picked="emit('asset-picked', $event)" />

    <!-- Player row — always present; click to enter follow-3p mode -->
    <div
      class="row row-group"
      :class="{ active: modelValue?.kind === 'player' }"
      @click="emit('update:modelValue', { kind: 'player' })"
    >
      <span class="row-icon player-icon">▶</span>
      <span class="row-label">Player</span>
      <span v-if="editorCamMode && editorCamMode !== 'orbit'" class="badge-cam">{{ editorCamMode }}</span>
    </div>

    <!-- Scene settings row -->
    <div
      class="row row-group"
      :class="{ active: modelValue?.kind === 'scene' || !modelValue }"
      @click="emit('update:modelValue', { kind: 'scene' })"
    >
      <span class="row-icon">⬡</span>
      <span class="row-label">Scene Settings</span>
    </div>

    <!-- NPCs -->
    <div v-if="npcs.length > 0" class="section">
      <div class="section-header">
        <span>NPCs</span>
        <span class="section-count">{{ npcs.length }}</span>
      </div>
      <div
        v-for="npc in npcs"
        :key="npc.entityId"
        class="row"
        :class="{ active: modelValue?.kind === 'npc' && modelValue.entityId === npc.entityId }"
        @click="emit('update:modelValue', { kind: 'npc', entityId: npc.entityId })"
      >
        <span class="row-icon npc-dot">●</span>
        <span class="row-label">{{ npc.label ?? npc.entityId }}</span>
        <span v-if="npcHasPath(npc.entityId)" class="badge-path" title="Has waypoint path">path</span>
      </div>
    </div>

    <!-- Trigger Zones -->
    <div v-if="zones.length > 0" class="section">
      <div class="section-header">
        <span>Zones</span>
        <span class="section-count">{{ zones.length }}</span>
      </div>
      <div
        v-for="zone in zones"
        :key="zone.id"
        class="row"
        :class="{ active: modelValue?.kind === 'zone' && modelValue.id === zone.id }"
        @click="emit('update:modelValue', { kind: 'zone', id: zone.id })"
      >
        <span class="row-icon" :class="zone.type === 'exit' ? 'exit-dot' : 'prox-dot'">◆</span>
        <span class="row-label">{{ zone.label ?? zone.id }}</span>
        <span class="badge-type">{{ zone.type }}</span>
      </div>
    </div>

    <!-- Placed Objects -->
    <div v-if="placedObjects.length > 0" class="section">
      <div class="section-header">
        <span>Placed Objects</span>
        <span class="section-count">{{ placedObjects.length }}</span>
      </div>
      <div
        v-for="obj in placedObjects"
        :key="obj.id"
        class="row"
        :class="{ active: modelValue?.kind === 'placed' && modelValue.objectId === obj.id }"
        @click="emit('update:modelValue', { kind: 'placed', objectId: obj.id })"
      >
        <span class="row-icon placed-dot">◈</span>
        <span class="row-label">{{ obj.label }}</span>
      </div>
    </div>

    <!-- Empty state -->
    <p v-if="npcs.length === 0 && zones.length === 0 && placedObjects.length === 0" class="empty">
      No NPCs or zones configured.
    </p>
  </aside>
</template>

<script setup lang="ts">
import SceneEditorAssetsSection from './SceneEditorAssetsSection.vue'
import { useLiveQuery } from './useLiveQuery'
import { assetDb, type SceneRow } from './assetDb'
import type { EditorNpcEntry, EditorZoneEntry, EditorSelection, EditorPlacedObject, SceneEditorEntry, EditorCamMode } from './sceneEditorTypes'

const props = defineProps<{
  modelValue: EditorSelection
  sceneLabel?: string
  npcs: EditorNpcEntry[]
  zones: EditorZoneEntry[]
  /** Placed objects authored this session — shown in the hierarchy. */
  placedObjects: EditorPlacedObject[]
  /** Set of entityIds that currently have waypoint data. */
  npcPathIds?: Set<string>
  /** When provided, renders a scene switcher dropdown instead of the label badge. */
  scenes?: SceneEditorEntry[]
  /** Currently active static scene id — controls the dropdown selection when no saved scene is active. */
  activeSceneId?: string
  /** ID of the currently loaded Dexie saved scene, or null/undefined when none is active. */
  activeSavedSceneId?: string | null
  /** Current editor camera mode — shown as a badge on the Player row. */
  editorCamMode?: EditorCamMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EditorSelection]
  'switch-scene': [sceneId: string]
  'asset-picked': [assetId: string]
  'load-scene': [sceneId: string]
}>()

// Live-queried saved scenes — most-recently-saved first.
const savedScenes = useLiveQuery<SceneRow[]>(
  () => assetDb.scenes.orderBy('savedAt').reverse().toArray(),
  [],
)

function onDropdownChange(ev: Event): void {
  const value = (ev.target as HTMLSelectElement).value
  const isSaved = savedScenes.value.some(ss => ss.id === value)
  if (isSaved) {
    emit('load-scene', value)
  } else {
    emit('switch-scene', value)
  }
}

function npcHasPath(entityId: string): boolean {
  return props.npcPathIds?.has(entityId) ?? false
}
</script>

<style scoped>
.hierarchy {
  width: 210px;
  flex-shrink: 0;
  background: #0d1320;
  border-right: 1px solid #182a40;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #b0bec5;
  overflow: hidden;
}

.hierarchy-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px 8px;
  border-bottom: 1px solid #182a40;
  flex-shrink: 0;
}
.title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6a8aaa;
}
.scene-badge {
  font-family: monospace;
  font-size: 9px;
  background: #18304a;
  color: #5ab0f5;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}
.scene-select {
  flex: 1;
  min-width: 0;
  background: #18304a;
  color: #5ab0f5;
  border: 1px solid #1e3a58;
  border-radius: 3px;
  font-family: monospace;
  font-size: 9px;
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
}
.scene-select:hover { border-color: #2a5070; }
.scene-select option { background: #0d1320; color: #a0b4c8; }

/* ── Section ──────────────────────────────────────────────────────────────── */
.section {
  border-top: 1px solid #182a40;
  padding: 4px 0 2px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 12px 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3a5060;
}
.section-count {
  background: #18304a;
  color: #3a6080;
  font-family: monospace;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 9px;
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  cursor: pointer;
  border-radius: 0;
  transition: background 0.1s;
  user-select: none;
}
.row:hover { background: rgba(255,255,255,0.04); }
.row.active { background: rgba(0, 140, 255, 0.12); }
.row-group { border-top: 1px solid #182a40; margin-top: 2px; }

.row-icon {
  font-size: 9px;
  flex-shrink: 0;
  color: #3a5060;
}
.row-icon.npc-dot { color: #00aaff; }
.row-icon.exit-dot { color: #ffdd44; }
.row-icon.prox-dot { color: #44ff88; }
.row-icon.placed-dot { color: #c099ff; }
.row-icon.player-icon { color: #00d4aa; }

.badge-cam {
  font-family: monospace;
  font-size: 8px;
  background: rgba(0, 212, 170, 0.12);
  color: #00d4aa;
  border: 1px solid rgba(0, 212, 170, 0.25);
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}

.row-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #a0b4c8;
}
.row.active .row-label { color: #d0e4f8; }

.badge-path {
  font-family: monospace;
  font-size: 8px;
  background: #183040;
  color: #ffcc44;
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}
.badge-type {
  font-family: monospace;
  font-size: 8px;
  background: #18304a;
  color: #6a8aaa;
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}

.empty {
  margin: 24px 12px 0;
  font-size: 11px;
  color: #2a3a4a;
  line-height: 1.6;
}
</style>
