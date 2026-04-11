<!--
  WaypointEditorView — fullscreen waypoint editor for use as a route page.

  Usage (three-dreams router):
    {
      path: '/editor',
      component: () => import('../views/WaypointEditorPage.vue')  // thin wrapper
    }

  Props are passed from the app-level wrapper so each game fork configures
  its own GLB URLs, storage key, and TypeScript export name.
-->
<template>
  <div class="wp-editor-layout">
    <!-- 3D Viewport -->
    <div class="viewport">
      <canvas ref="canvasRef" class="wp-canvas" />

      <div v-if="!isReady" class="loading-overlay">
        <span>Loading scene…</span>
      </div>

      <div class="status-bar">{{ statusMessage }}</div>

      <div class="hint-strip">
        <kbd>Click floor</kbd> place &ensp;
        <kbd>Click marker</kbd> select &ensp;
        <kbd>Del</kbd> remove &ensp;
        <kbd>Ctrl+Z</kbd> undo &ensp;
        <kbd>Scroll / drag</kbd> orbit
      </div>
    </div>

    <!-- Sidebar -->
    <WaypointEditorHUD
      :waypoints="waypoints"
      :selected-index="selectedIndex"
      :storage-key="storageKey"
      @remove="removeWaypoint"
      @move="moveWaypoint"
      @clear="clearAll"
      @copy="copyToClipboard"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useWaypointEditor } from './useWaypointEditor'
import WaypointEditorHUD from './WaypointEditorHUD.vue'

const props = defineProps<{
  floorGlbUrl: string
  contextGlbUrls?: string[]
  /** localStorage key — shows in sidebar badge */
  storageKey?: string
  /** Variable name in the TypeScript export */
  exportName?: string
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const {
  waypoints,
  selectedIndex,
  isReady,
  statusMessage,
  removeWaypoint,
  moveWaypoint,
  clearAll,
  copyToClipboard,
} = useWaypointEditor({
  canvas: canvasRef,
  floorGlbUrl: props.floorGlbUrl,
  contextGlbUrls: props.contextGlbUrls,
  storageKey: props.storageKey,
  exportName: props.exportName,
})
</script>

<style scoped>
.wp-editor-layout {
  display: flex;
  width: 100%;
  height: 100%;
  background: #0d0d1a;
  overflow: hidden;
}

/* ── Viewport ─────────────────────────────────────────────────────────────── */
.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.wp-canvas {
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
  background: #12182b;
  color: #555;
  font-family: monospace;
  font-size: 13px;
}

.status-bar {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.78);
  color: #ffcc00;
  font-family: monospace;
  font-size: 12px;
  padding: 4px 16px;
  border-radius: 20px;
  pointer-events: none;
  white-space: nowrap;
  border: 1px solid rgba(255, 204, 0, 0.2);
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

kbd {
  display: inline-block;
  background: rgba(0, 0, 0, 0.65);
  color: #64c8ff;
  font-family: monospace;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid #1a3050;
}
</style>
