<!--
  WaypointEditorPanel — compact panel variant for threejs-engine-dev's EngineHarness.

  Sits inside the canvas area of the harness. Has its own Three.js canvas (independent
  from the engine canvas), a compact chip-list of placed waypoints, and Copy / Clear actions.
  The config sidebar (GLB URLs, storage key, export name) lives in EngineHarness, not here —
  this component is intentionally display-only except for the action buttons.

  Re-mount with a new :key to reinitialize with changed config.
-->
<template>
  <div class="wp-panel">
    <!-- Header bar -->
    <div class="panel-header">
      <span class="title">Waypoint Editor</span>
      <span v-if="storageKey" class="badge">{{ storageKey }}</span>
      <span class="status">{{ statusMessage }}</span>
    </div>

    <!-- Three.js canvas -->
    <div class="viewport">
      <canvas ref="canvasRef" class="wp-canvas" />
      <div v-if="!isReady" class="loading">Loading scene…</div>
      <div class="mini-hint">
        <kbd>Click</kbd> place &ensp; <kbd>Del</kbd> remove &ensp;
        <kbd>Ctrl+Z</kbd> undo &ensp; <kbd>Drag</kbd> orbit
      </div>
    </div>

    <!-- Footer: waypoint chip list + actions -->
    <div class="panel-footer">
      <div class="chip-list">
        <span
          v-for="(wp, i) in waypoints"
          :key="i"
          class="chip"
          :class="{
            start: i === 0,
            end: i === waypoints.length - 1 && i > 0,
            selected: selectedIndex === i,
          }"
        >
          {{ i }}: {{ fmt(wp.x) }},{{ fmt(wp.y) }},{{ fmt(wp.z) }}
        </span>
        <span v-if="waypoints.length === 0" class="chip-empty">
          Click the scene floor to place waypoints
        </span>
      </div>

      <div class="footer-actions">
        <button
          class="btn-copy"
          :disabled="waypoints.length === 0"
          @click="copyToClipboard"
          title="Copy as TypeScript"
        >
          Copy TS
        </button>
        <button
          class="btn-clear"
          :disabled="waypoints.length === 0"
          @click="clearAll"
          title="Clear all waypoints"
        >
          Clear
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useWaypointEditor } from './useWaypointEditor'

const props = defineProps<{
  floorGlbUrl: string
  contextGlbUrls?: string[]
  storageKey?: string
  exportName?: string
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const {
  waypoints,
  selectedIndex,
  isReady,
  statusMessage,
  clearAll,
  copyToClipboard,
} = useWaypointEditor({
  canvas: canvasRef,
  floorGlbUrl: props.floorGlbUrl,
  contextGlbUrls: props.contextGlbUrls,
  storageKey: props.storageKey ?? 'waypoints:dev',
  exportName: props.exportName ?? 'WAYPOINTS',
})

const fmt = (n: number) => n.toFixed(1)
</script>

<style scoped>
.wp-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0e1626;
  color: #ccc;
  overflow: hidden;
}

/* ── Header ───────────────────────────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: #0a0f1a;
  border-bottom: 1px solid #1a3050;
  flex-shrink: 0;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e4;
}
.badge {
  font-family: monospace;
  font-size: 10px;
  background: #1a3050;
  color: #5ab0f5;
  padding: 1px 6px;
  border-radius: 3px;
}
.status {
  margin-left: auto;
  font-family: monospace;
  font-size: 10px;
  color: #ffcc00;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

/* ── Viewport ─────────────────────────────────────────────────────────────── */
.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}
.wp-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #12182b;
  color: #444;
  font-family: monospace;
  font-size: 12px;
}
.mini-hint {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 9px;
  color: #3a5060;
  pointer-events: none;
}
kbd {
  font-family: monospace;
  color: #4a7090;
  font-size: 9px;
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.panel-footer {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid #1a3050;
  max-height: 72px;
  overflow: hidden;
}

.chip-list {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  overflow: hidden;
  align-content: flex-start;
}
.chip {
  font-family: monospace;
  font-size: 9px;
  background: #12223a;
  color: #ffcc00;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  cursor: default;
}
.chip.start   { color: #44ff88; }
.chip.end     { color: #4488ff; }
.chip.selected { background: rgba(255,68,68,0.18); color: #ff8888; }
.chip-empty {
  font-size: 9px;
  color: #444;
  font-style: italic;
}

.footer-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.btn-copy,
.btn-clear {
  font-size: 10px;
  padding: 3px 9px;
  border-radius: 3px;
  cursor: pointer;
  border: none;
  white-space: nowrap;
  transition: background 0.12s;
}
.btn-copy {
  background: #1a6aaa;
  color: #fff;
}
.btn-copy:hover:not(:disabled) { background: #2280cc; }
.btn-clear {
  background: transparent;
  color: #f55;
  border: 1px solid #4a1e1e;
}
.btn-clear:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.1);
  border-color: #ff4444;
}
.btn-copy:disabled,
.btn-clear:disabled {
  opacity: 0.28;
  cursor: default;
}
</style>
