<!--
  SceneEditorHierarchy — left panel (E9).

  Scene block (switcher + tool rows) above three identical collapsible sections:
  NPCs · Objects · Zones. Each has a "+" in its header and its rows directly
  beneath it, so adding and seeing the result happen in the same place.
  Sections start collapsed and open when something of their kind is selected
  (hierarchy/sectionForSelection.ts). Clicking a row emits 'update:modelValue'
  to sync viewport selection.
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
        <optgroup v-if="loadableSavedScenes.length > 0" label="Saved">
          <option v-for="ss in loadableSavedScenes" :key="ss.id" :value="ss.id">{{ ss.name }}</option>
        </optgroup>
      </select>
      <!-- Single-scene label badge (backward compat) -->
      <span v-else-if="sceneLabel" class="scene-badge">{{ sceneLabel }}</span>
    </header>

    <!-- Scene tools: view / settings controls, styled as buttons so neither reads as
         a heading for the sections below. -->
    <div class="tools">
      <button
        class="tool"
        type="button"
        :class="{ active: modelValue?.kind === 'scene' || !modelValue }"
        title="Scene-level settings (spawn, play character, ambient audio)"
        @click="emit('update:modelValue', { kind: 'scene' })"
      >
        <span class="tool-icon">⬡</span>
        <span class="tool-label">Scene Settings</span>
      </button>
      <button
        class="tool"
        type="button"
        :class="{ active: modelValue?.kind === 'player' }"
        title="Walk the scene as the player (visual validation)"
        @click="emit('update:modelValue', { kind: 'player' })"
      >
        <span class="tool-icon player-icon">▶</span>
        <span class="tool-label">Player View</span>
        <span v-if="editorCamMode && editorCamMode !== 'orbit'" class="badge-cam">{{ editorCamMode }}</span>
      </button>
    </div>

    <!-- NPCs -->
    <HierarchySection v-model:open="open.npcs" title="NPCs" :count="npcs.length" add-title="Add NPC" @add="emit('add-npc')">
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
        <button class="btn-remove" type="button" title="Remove NPC" @click.stop="emit('remove-npc', npc.entityId)">×</button>
      </div>
    </HierarchySection>

    <!-- Objects: placed instances. "+" opens the asset library (upload, browse, use);
         choosing an asset starts place mode, and the placed object lands here. -->
    <HierarchySection
      v-model:open="open.objects"
      title="Objects"
      :count="placedObjects.length"
      add-title="Add object — opens the asset library"
      @add="libraryOpen = true"
    >
      <div
        v-for="obj in placedObjects"
        :key="obj.id"
        class="row"
        :class="{ active: modelValue?.kind === 'placed' && modelValue.objectId === obj.id }"
        @click="emit('update:modelValue', { kind: 'placed', objectId: obj.id })"
      >
        <span class="row-icon placed-dot">◈</span>
        <span class="row-label">{{ obj.label }}</span>
        <button class="btn-remove" type="button" title="Remove" @click.stop="emit('remove-placed', obj.id)">×</button>
      </div>
    </HierarchySection>

    <!-- Trigger Zones -->
    <HierarchySection v-model:open="open.zones" title="Zones" :count="zones.length" add-title="Add zone" @add="emit('add-zone')">
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
        <button class="btn-remove" type="button" title="Remove zone" @click.stop="emit('remove-zone', zone.id)">×</button>
      </div>
    </HierarchySection>

    <AssetLibraryDialog
      :open="libraryOpen"
      @close="libraryOpen = false"
      @asset-picked="emit('asset-picked', $event)"
    />
  </aside>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import AssetLibraryDialog from './AssetLibraryDialog.vue'
import HierarchySection from './hierarchy/HierarchySection.vue'
import { sectionForSelection, selectionKey, type HierarchySectionId } from './hierarchy/sectionForSelection'
import { useSavedScenes } from './scenes/useSavedScenes'
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
  /** Current editor camera mode — shown as a badge on the Player View row. */
  editorCamMode?: EditorCamMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EditorSelection]
  'switch-scene': [sceneId: string]
  'asset-picked': [assetId: string]
  'load-scene': [sceneId: string]
  'add-npc': []
  'add-zone': []
  'remove-npc': [entityId: string]
  'remove-zone': [id: string]
  'remove-placed': [objectId: string]
}>()

/**
 * Collapsed on a fresh load. A section opens when the selection changes to one of
 * its kind (row click, viewport click, or after an add, which auto-selects), and is
 * not forced open again while the user holds that same selection and has collapsed
 * it: the watch fires on a changed selection key, never on a re-announce.
 * Not persisted — it is derived from the selection on mount.
 */
const open = reactive<Record<HierarchySectionId, boolean>>({ npcs: false, objects: false, zones: false })
watch(
  () => selectionKey(props.modelValue),
  () => {
    const id = sectionForSelection(props.modelValue)
    if (id) open[id] = true
  },
  { immediate: true },
)

const libraryOpen = ref(false)

/**
 * Only scenes that would actually open are offered in the switcher — a row
 * whose every asset blob is gone renders nothing but an empty grid, so listing
 * it is an invitation to a dead end. `loadable` is unfiltered until the asset
 * library has actually loaded, so a slow Dexie read never hides healthy scenes.
 *
 * Filtered for *display* only: `onDropdownChange` still tests against the full
 * `savedScenes` list, so a selection that was valid a moment ago still routes to
 * the loader rather than being mistaken for a static scene id.
 *
 * Unloadable rows are NOT deleted here. A missing blob is often temporary — the
 * asset is re-uploadable, and Dexie is per-browser-profile, so a scene saved in
 * one browser legitimately looks assetless in another. Removal lives on the
 * Scenes screen (`/scenes`), behind an explicit confirm.
 */
const { rows: savedScenes, loadable: loadableSavedScenes } = useSavedScenes()

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
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #182a40 transparent;
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
  font-size: 10px;
  padding: 4px 4px;
  outline: none;
  cursor: pointer;
}
.scene-select:hover { border-color: #2a5070; }
.scene-select option { background: #0d1320; color: #a0b4c8; }

/* ── Scene tools ──────────────────────────────────────────────────────────── */
.tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  flex-shrink: 0;
}
.tool {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 0 10px;
  background: #101a2a;
  border: 1px solid #1a2d44;
  border-radius: 5px;
  color: #8aa4bc;
  font-family: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.tool:hover { background: #142238; border-color: #2a4a6a; color: #b8d0e4; }
.tool.active {
  background: rgba(0, 140, 255, 0.14);
  border-color: rgba(0, 140, 255, 0.45);
  color: #d0e4f8;
}
.tool-icon { font-size: 10px; flex-shrink: 0; color: #4a6a80; }
.tool-icon.player-icon { color: #00d4aa; }
.tool-label { flex: 1; min-width: 0; }

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

/* ── Rows (slotted into HierarchySection) ─────────────────────────────────── */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px 0 26px;
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
}
.row:hover { background: rgba(255, 255, 255, 0.04); }
.row.active { background: rgba(0, 140, 255, 0.12); }

.row-icon {
  font-size: 9px;
  flex-shrink: 0;
  color: #3a5060;
}
.row-icon.npc-dot { color: #00aaff; }
.row-icon.exit-dot { color: #ffdd44; }
.row-icon.prox-dot { color: #44ff88; }
.row-icon.placed-dot { color: #c099ff; }

.row-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #a0b4c8;
}
.row.active .row-label { color: #d0e4f8; }

/* Visible at rest (dimmed) so it is findable, a real target (22 px) rather than a
   14 px glyph that only appears on hover. */
.btn-remove {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #3a5060;
  font-size: 15px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.55;
  transition: opacity 0.1s, color 0.1s, background 0.1s;
}
.row:hover .btn-remove { opacity: 1; }
.btn-remove:hover { color: #ff6060; background: rgba(255, 96, 96, 0.1); }

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
</style>
