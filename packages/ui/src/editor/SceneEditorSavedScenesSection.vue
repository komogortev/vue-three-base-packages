<!--
  SceneEditorSavedScenesSection — Saved scenes panel in the editor hierarchy.

  Live-queries the Dexie `scenes` table (most-recently-saved first).
  Each row shows the scene name, object count, and save date.
  "Load" button emits `load-scene(sceneId)` — SceneEditorView handles
  the actual reinit + restore flow.

  Mounted by SceneEditorHierarchy below the Assets section.
-->
<template>
  <div class="section saved-scenes-section">
    <div class="section-header">
      <span>Saved Scenes</span>
      <span class="section-count">{{ scenes.length }}</span>
    </div>

    <div v-for="scene in scenes" :key="scene.id" class="row scene-row">
      <div class="scene-info">
        <div class="scene-name" :title="scene.name">{{ scene.name }}</div>
        <div class="scene-meta">
          <span class="obj-count">{{ scene.placedObjects.length }} obj</span>
          <span class="save-date">{{ formatDate(scene.savedAt) }}</span>
        </div>
      </div>
      <button
        class="load-btn"
        type="button"
        title="Load this scene into the editor"
        @click="emit('load-scene', scene.id)"
      >
        Load
      </button>
    </div>

    <p v-if="scenes.length === 0" class="empty">No saved scenes yet.</p>
  </div>
</template>

<script setup lang="ts">
import { assetDb, type SceneRow } from './assetDb'
import { useLiveQuery } from './useLiveQuery'

const emit = defineEmits<{
  'load-scene': [sceneId: string]
}>()

const scenes = useLiveQuery<SceneRow[]>(
  () => assetDb.scenes.orderBy('savedAt').reverse().toArray(),
  [],
)

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
</script>

<style scoped>
.saved-scenes-section {
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

.row.scene-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  user-select: none;
}

.scene-info {
  flex: 1;
  min-width: 0;
}
.scene-name {
  font-size: 10px;
  color: #a0b4c8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.scene-meta {
  display: flex;
  gap: 6px;
  font-size: 9px;
  font-family: monospace;
  color: #4a6080;
  margin-top: 1px;
}
.obj-count { color: #4a7090; }
.save-date { color: #3a5060; }

.load-btn {
  flex-shrink: 0;
  background: #18304a;
  border: 1px solid #1e3a58;
  color: #6a8aaa;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.load-btn:hover {
  color: #b0c8e0;
  border-color: #5ab0f5;
}

.empty {
  margin: 6px 12px 0;
  font-size: 10px;
  color: #2a3a4a;
  line-height: 1.5;
}
</style>
