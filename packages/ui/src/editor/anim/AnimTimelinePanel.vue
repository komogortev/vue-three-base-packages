<!--
  AnimTimelinePanel — S5-a stepped-keyframe timeline for the scene editor's
  "Anim" NPC tab. Pure presentational: state in via props, intents out via
  emits. Never imports the viewport composable — SceneEditorView orchestrates.
-->
<template>
  <div class="anim-panel">
    <p v-if="!hasCharacter" class="anim-hint">Activating pose editor…</p>
    <template v-else>
      <!-- Timeline strip with diamond keyframe markers -->
      <div class="anim-field-group">
        <label class="anim-label">Timeline</label>
        <div class="timeline-strip">
          <div class="timeline-track" />
          <button
            v-for="t in keyframeTimes"
            :key="t"
            :class="['kf-marker', { selected: selectedKeyTime === t }]"
            :style="{ left: `${(t / timelineDuration) * 100}%` }"
            :title="`Keyframe @ ${t.toFixed(2)}s — click to select`"
            @click="onMarkerClick(t)"
          />
          <div class="scrub-head" :style="{ left: `${(scrubTime / timelineDuration) * 100}%` }" />
        </div>
        <input
          class="scrub-range"
          type="range"
          min="0"
          :max="timelineDuration"
          step="0.01"
          :value="scrubTime"
          @input="emit('scrub', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <!-- Transport / keyframe controls -->
      <div class="anim-controls">
        <span class="time-readout">{{ scrubTime.toFixed(2) }}s</span>
        <button
          class="anim-btn anim-btn-capture"
          title="Capture current pose as a keyframe at the scrub time (K)"
          @click="emit('key-capture', scrubTime)"
        >Capture Key <kbd class="anim-kbd">K</kbd></button>
        <button
          class="anim-btn"
          :title="previewPlaying ? 'Stop preview' : 'Preview the recorded clip once'"
          :disabled="keyframeTimes.length === 0"
          @click="emit('preview-toggle')"
        >{{ previewPlaying ? '■ Stop' : '▶ Preview' }}</button>
        <button
          class="anim-btn anim-btn-danger"
          title="Delete the selected keyframe"
          :disabled="selectedKeyTime === null"
          @click="onDeleteKey"
        >Delete Key</button>
      </div>

      <div class="anim-field-group anim-duration-row">
        <label class="anim-label" for="anim-duration">Timeline range (s)</label>
        <input
          id="anim-duration"
          class="duration-input"
          type="number"
          min="0.1"
          step="0.5"
          :value="timelineDuration"
          @change="emit('duration-set', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <!-- S5-b: export as animation-pack asset -->
      <div class="anim-field-group">
        <label class="anim-label" for="anim-clip-name">Save as animation pack</label>
        <div class="anim-export-row">
          <input
            id="anim-clip-name"
            v-model="clipName"
            class="clip-name-input"
            placeholder="clip name…"
            spellcheck="false"
            @keydown.enter="onExportClick"
          />
          <button
            class="anim-btn anim-btn-capture"
            :disabled="!canExport"
            :title="canExport ? 'Export the recorded clip as an animation-pack asset' : 'Needs at least one keyframe and a clip name'"
            @click="onExportClick"
          >{{ exportBusy ? 'Exporting…' : 'Export Pack' }}</button>
        </div>
      </div>

      <p class="anim-hint">
        Pose the character (Pose tab or bone gizmo), scrub to a time, then Capture.
        Clip duration = last keyframe. Preview plays once and holds the final pose.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  /** Sorted keyframe times (seconds) from the recorder. */
  keyframeTimes: number[]
  /** Current scrub position (seconds). */
  scrubTime: number
  /** Visible timeline range (seconds) — UI only, clip duration is recorder-derived. */
  timelineDuration: number
  /** True while a preview clip is playing. */
  previewPlaying: boolean
  /** True when the pose character mesh is loaded. */
  hasCharacter: boolean
  /** True while an export is in flight — disables the Export button. */
  exportBusy: boolean
}>()

const emit = defineEmits<{
  scrub: [time: number]
  'key-capture': [time: number]
  'key-remove': [time: number]
  'preview-toggle': []
  'duration-set': [seconds: number]
  'export-clip': [clipName: string]
}>()

const selectedKeyTime = ref<number | null>(null)
const clipName = ref('')

const canExport = computed(
  () => !props.exportBusy && clipName.value.trim().length > 0 && props.keyframeTimes.length > 0,
)

function onExportClick(): void {
  if (!canExport.value) return
  emit('export-clip', clipName.value.trim())
}

function onMarkerClick(t: number): void {
  selectedKeyTime.value = t
  emit('scrub', t)
}

function onDeleteKey(): void {
  if (selectedKeyTime.value === null) return
  emit('key-remove', selectedKeyTime.value)
  selectedKeyTime.value = null
}

// Drop a stale selection when its keyframe disappears (delete/retime/clear)
watch(() => props.keyframeTimes, (times) => {
  if (selectedKeyTime.value !== null && !times.includes(selectedKeyTime.value)) {
    selectedKeyTime.value = null
  }
})

// K hotkey — capture at scrub time, ignored while typing in a field
function onKeydown(e: KeyboardEvent): void {
  if (e.code !== 'KeyK') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (!props.hasCharacter) return
  emit('key-capture', props.scrubTime)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.anim-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.anim-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.anim-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6f8cab;
}
.anim-hint {
  font-size: 10px;
  color: #5a7391;
  margin: 0;
  line-height: 1.5;
}

/* Timeline strip */
.timeline-strip {
  position: relative;
  height: 26px;
  background: #0e1c2e;
  border: 1px solid #1a3050;
  border-radius: 3px;
  overflow: hidden;
}
.timeline-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #1a3050;
}
.kf-marker {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin: 0;
  padding: 0;
  border: 1px solid #7fb2e5;
  background: #2a4a6e;
  transform: translate(-50%, -50%) rotate(45deg);
  cursor: pointer;
}
.kf-marker.selected {
  background: #ffb347;
  border-color: #ffd18a;
}
.scrub-head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #ff5566;
  pointer-events: none;
}
.scrub-range {
  width: 100%;
  margin: 0;
  accent-color: #ff5566;
}

/* Controls */
.anim-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.time-readout {
  font-family: monospace;
  font-size: 11px;
  color: #9fc2e8;
  min-width: 44px;
}
.anim-btn {
  font-size: 10px;
  padding: 4px 8px;
  background: #12253c;
  color: #b8d4f0;
  border: 1px solid #1a3050;
  border-radius: 3px;
  cursor: pointer;
}
.anim-btn:hover:not(:disabled) {
  background: #1a3050;
}
.anim-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.anim-btn-capture {
  background: #14351f;
  border-color: #235c36;
  color: #9fe8b8;
}
.anim-btn-capture:hover:not(:disabled) {
  background: #1d4a2c;
}
.anim-btn-danger {
  border-color: #5c2323;
  color: #e89f9f;
}
.anim-kbd {
  font-size: 9px;
  background: #0e1c2e;
  padding: 0 3px;
  border-radius: 2px;
  border: 1px solid #1a3050;
}

/* Export */
.anim-export-row {
  display: flex;
  gap: 6px;
}
.clip-name-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  background: #0e1c2e;
  color: #b8d4f0;
  border: 1px solid #1a3050;
  border-radius: 3px;
  padding: 3px 6px;
}

/* Duration */
.anim-duration-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.duration-input {
  width: 64px;
  font-size: 11px;
  background: #0e1c2e;
  color: #b8d4f0;
  border: 1px solid #1a3050;
  border-radius: 3px;
  padding: 3px 6px;
}
</style>
