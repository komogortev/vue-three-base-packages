<template>
  <aside class="wp-hud">
    <header class="hud-header">
      <h2>Waypoints</h2>
      <span v-if="storageKey" class="scene-badge">{{ storageKey }}</span>
    </header>

    <!-- Colour legend -->
    <div class="legend">
      <span class="dot start">●</span> Start &nbsp;
      <span class="dot mid">●</span> Mid &nbsp;
      <span class="dot end">●</span> End &nbsp;
      <span class="dot sel">●</span> Selected
    </div>

    <!-- Waypoint list -->
    <div class="wp-list">
      <div
        v-for="(wp, i) in waypoints"
        :key="i"
        class="wp-row"
        :class="{ selected: selectedIndex === i }"
      >
        <span class="idx" :class="dotClass(i)">{{ i }}</span>
        <span class="coords">{{ fmt(wp.x) }}, {{ fmt(wp.y) }}, {{ fmt(wp.z) }}</span>
        <div class="row-btns">
          <button
            @click="$emit('move', i, i - 1)"
            :disabled="i === 0"
            title="Move up"
          >↑</button>
          <button
            @click="$emit('move', i, i + 1)"
            :disabled="i === waypoints.length - 1"
            title="Move down"
          >↓</button>
          <button
            @click="$emit('remove', i)"
            class="del"
            title="Delete"
          >×</button>
        </div>
      </div>

      <p v-if="waypoints.length === 0" class="empty">
        No waypoints yet.<br />
        Click the floor in the viewport.
      </p>
    </div>

    <!-- Footer -->
    <footer class="hud-footer">
      <p class="count">{{ waypoints.length }} waypoint{{ waypoints.length !== 1 ? 's' : '' }}</p>
      <button
        class="btn primary"
        :disabled="waypoints.length === 0"
        @click="$emit('copy')"
      >
        Copy TypeScript
      </button>
      <button
        class="btn danger"
        :disabled="waypoints.length === 0"
        @click="$emit('clear')"
      >
        Clear All
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import type * as THREE from 'three'

const props = defineProps<{
  waypoints: readonly THREE.Vector3[]
  selectedIndex: number | null
  storageKey?: string
}>()

defineEmits<{
  remove: [index: number]
  move: [from: number, to: number]
  clear: []
  copy: []
}>()

const fmt = (n: number) => n.toFixed(2)

function dotClass(i: number): string {
  if (i === props.selectedIndex) return 'sel'
  if (i === 0) return 'start'
  if (i === props.waypoints.length - 1) return 'end'
  return 'mid'
}
</script>

<style scoped>
.wp-hud {
  width: 248px;
  flex-shrink: 0;
  background: #0e1626;
  border-left: 1px solid #1a3050;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
}

/* ── Header ───────────────────────────────────────────────────────────────── */
.hud-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid #1a3050;
  flex-shrink: 0;
}
.hud-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e4;
}
.scene-badge {
  font-family: monospace;
  font-size: 10px;
  background: #1a3050;
  color: #5ab0f5;
  padding: 2px 6px;
  border-radius: 3px;
}

/* ── Legend ───────────────────────────────────────────────────────────────── */
.legend {
  padding: 5px 12px;
  font-size: 10px;
  color: #555;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #1a3050;
  flex-shrink: 0;
}
.dot { font-size: 13px; }
.dot.start { color: #44ff88; }
.dot.mid   { color: #ffcc00; }
.dot.end   { color: #4488ff; }
.dot.sel   { color: #ff4444; }

/* ── List ─────────────────────────────────────────────────────────────────── */
.wp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: #1a3050 transparent;
}

.wp-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 3px;
  transition: background 0.1s;
}
.wp-row:hover { background: rgba(255,255,255,0.04); }
.wp-row.selected { background: rgba(255, 68, 68, 0.1); }

.idx {
  width: 20px;
  text-align: center;
  font-family: monospace;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 3px;
  border-radius: 3px;
  flex-shrink: 0;
}
.idx.start { color: #44ff88; }
.idx.mid   { color: #ffcc00; }
.idx.end   { color: #4488ff; }
.idx.sel   { color: #ff4444; }

.coords {
  flex: 1;
  font-family: monospace;
  font-size: 10px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-btns {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.row-btns button {
  background: transparent;
  border: 1px solid #2a3a50;
  color: #666;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  cursor: pointer;
  line-height: 1.4;
  transition: all 0.1s;
}
.row-btns button:hover:not(:disabled) {
  background: rgba(255,255,255,0.07);
  color: #ccc;
  border-color: #445;
}
.row-btns button:disabled { opacity: 0.28; cursor: default; }
.row-btns button.del:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.14);
  color: #ff8080;
  border-color: #ff4444;
}

.empty {
  margin: 0;
  padding: 20px 14px;
  text-align: center;
  color: #444;
  font-size: 11px;
  line-height: 1.7;
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.hud-footer {
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid #1a3050;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.count {
  margin: 0;
  font-size: 10px;
  color: #444;
  text-align: center;
}
.btn {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn:disabled { opacity: 0.32; cursor: default; }
.btn.primary {
  background: #1a6aaa;
  color: #fff;
}
.btn.primary:hover:not(:disabled) { background: #2280cc; }
.btn.danger {
  background: transparent;
  color: #f55;
  border: 1px solid #4a1e1e;
}
.btn.danger:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.1);
  border-color: #ff4444;
}
</style>
