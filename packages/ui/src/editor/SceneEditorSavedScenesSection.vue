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
      <span class="section-count">{{ classified.length }}</span>
    </div>

    <div v-for="entry in classified" :key="entry.scene.id" class="row scene-row">
      <div class="scene-info">
        <div class="scene-name" :title="entry.scene.name">
          {{ entry.scene.name }}
          <span
            v-if="entry.availability.status !== 'ok'"
            class="avail-badge"
            :class="entry.availability.status"
            :title="missingTitle(entry.availability)"
          >{{ entry.availability.status === 'partial' ? 'partial' : 'assets missing' }}</span>
        </div>
        <div class="scene-meta">
          <span class="obj-count">{{ entry.scene.placedObjects?.length ?? 0 }} obj</span>
          <span class="save-date">{{ formatDate(entry.scene.savedAt) }}</span>
        </div>
      </div>
      <button
        v-if="!loaded || entry.availability.status !== 'unloadable'"
        class="load-btn"
        type="button"
        title="Load this scene into the editor"
        @click="emit('load-scene', entry.scene.id)"
      >
        Load
      </button>
      <!-- Unloadable rows are hidden from the switcher, so removal has to be
           reachable here or they become invisible clutter. Deletion is explicit
           and confirmed — never automatic — because a missing blob is often
           recoverable by re-uploading the asset. -->
      <button
        v-else
        class="remove-btn"
        type="button"
        :title="`Delete this scene permanently — ${missingTitle(entry.availability)}`"
        @click="onRemove(entry.scene)"
      >
        Remove
      </button>
    </div>

    <p v-if="removeError" class="remove-error">{{ removeError }}</p>
    <p v-if="classified.length === 0" class="empty">No saved scenes yet.</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { assetDb, type SceneRow } from './assetDb'
import { useSavedScenes } from './scenes/useSavedScenes'
import type { SceneAvailability } from './scenes/sceneAvailability'

const emit = defineEmits<{
  'load-scene': [sceneId: string]
}>()

/**
 * Shared with the switcher above so both surfaces agree on what "openable"
 * means. `loaded` gates the destructive branch: until the asset library has
 * actually emitted, every row classifies `ok` and shows Load, because an
 * unloaded library is indistinguishable from an empty one and the pessimistic
 * reading would offer Remove on perfectly intact scenes.
 */
const { classified, loaded } = useSavedScenes()

function missingTitle(a: SceneAvailability): string {
  return `${a.missing.length} of ${a.referenced.length} asset${a.referenced.length === 1 ? '' : 's'} missing`
}

const removeError = ref<string | null>(null)

async function onRemove(scene: SceneRow): Promise<void> {
  const ok = window.confirm(
    `Delete saved scene "${scene.name}" permanently?

` +
    `Its asset blobs are missing from this browser, so it cannot be opened here. ` +
    `If the assets were saved in a different browser or profile, the scene is still ` +
    `intact there — deleting here does not affect it.

This cannot be undone.`,
  )
  if (!ok) return
  try {
    await assetDb.scenes.delete(scene.id)
    removeError.value = null
  } catch (e) {
    // A blocked DB or closed connection would otherwise become an unhandled
    // rejection inside the click handler, leaving the row in place with no
    // indication the click did anything.
    console.error('[SavedScenes] delete failed:', e)
    removeError.value = `Could not delete "${scene.name}" — see console.`
  }
}

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

.remove-btn {
  flex-shrink: 0;
  background: #3a1a1a;
  border: 1px solid #5a2424;
  color: #b06a6a;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.remove-btn:hover {
  color: #f0b0b0;
  border-color: #d05a5a;
}

.avail-badge {
  margin-left: 6px;
  font-size: 8px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 2px;
  vertical-align: middle;
}
.avail-badge.partial {
  background: #3a3018;
  border: 1px solid #5a4a20;
  color: #c8a860;
}
.avail-badge.unloadable {
  background: #3a1a1a;
  border: 1px solid #5a2424;
  color: #c07070;
}

.remove-error {
  margin: 4px 12px;
  font-size: 9px;
  color: #e08a8a;
  line-height: 1.4;
}

.empty {
  margin: 6px 12px 0;
  font-size: 10px;
  color: #2a3a4a;
  line-height: 1.5;
}
</style>
