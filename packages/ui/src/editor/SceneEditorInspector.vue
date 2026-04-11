<!--
  SceneEditorInspector — right panel, contextual tabs based on current selection.

  nothing / scene → Scene tab (spawn, atmosphere label)
  NPC selected    → Transform | Path tabs
  Zone selected   → Zone tab
-->
<template>
  <aside class="inspector">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="inspector-header">
      <span class="title">Inspector</span>
      <span class="context-label">{{ contextLabel }}</span>
    </header>

    <!-- ── Tab bar (only when NPC selected) ──────────────────────────────── -->
    <div v-if="selection?.kind === 'npc'" class="tab-bar">
      <button
        v-for="tab in npcTabs"
        :key="tab"
        class="tab"
        :class="{ active: activeTab === tab }"
        @click="activeTab = tab"
      >{{ tab }}</button>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         SCENE panel
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-if="!selection || selection.kind === 'scene'" class="panel-body">
      <div class="field-group">
        <label class="field-label">Spawn Point</label>
        <div v-if="config.spawnPoint" class="coords-row">
          <span class="coord-item">X <code>{{ fmt(config.spawnPoint.x) }}</code></span>
          <span class="coord-item">Z <code>{{ fmt(config.spawnPoint.z) }}</code></span>
        </div>
        <p v-else class="field-hint">No spawnPoint configured.</p>
      </div>
      <div class="field-group">
        <label class="field-label">NPCs</label>
        <p class="field-value">{{ config.npcs?.length ?? 0 }}</p>
      </div>
      <div class="field-group">
        <label class="field-label">Zones</label>
        <p class="field-value">{{ config.zones?.length ?? 0 }}</p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         NPC — Transform tab
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'npc' && activeTab === 'Transform'" class="panel-body">
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Entity ID</label>
        <code class="field-mono">{{ selectedNpc.entityId }}</code>
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Position</label>
        <div class="coords-row">
          <span class="coord-item">X <code>{{ fmt(selectedNpc.x) }}</code></span>
          <span class="coord-item">Y <code>{{ fmt(selectedNpc.y ?? 0) }}</code></span>
          <span class="coord-item">Z <code>{{ fmt(selectedNpc.z) }}</code></span>
        </div>
      </div>
      <div v-if="selectedNpc?.proximityRadius" class="field-group">
        <label class="field-label">Proximity radius</label>
        <p class="field-value">{{ selectedNpc.proximityRadius }}m</p>
      </div>
      <p class="field-hint">
        Position is read-only in this version. Edit in the scene descriptor to move the NPC.
      </p>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         NPC — Path tab
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'npc' && activeTab === 'Path'" class="panel-body path-panel">

      <!-- Edit mode toggle -->
      <div class="path-toolbar">
        <button
          class="btn-toggle"
          :class="{ active: pathEditMode }"
          @click="togglePathEditMode"
        >
          {{ pathEditMode ? '● Placing…' : '+ Add Waypoints' }}
        </button>
        <button
          v-if="currentWaypoints.length > 0"
          class="btn-undo"
          title="Undo last waypoint (Ctrl+Z)"
          @click="undoLastWaypoint"
        >↩</button>
        <button
          v-if="currentWaypoints.length > 0"
          class="btn-clear"
          title="Clear all waypoints"
          @click="clearWaypoints"
        >✕</button>
      </div>

      <!-- Hint when edit mode active -->
      <p v-if="pathEditMode" class="edit-hint">
        Click the floor in the viewport to place waypoints.
      </p>

      <!-- Waypoint list -->
      <div class="wp-list">
        <div
          v-for="(wp, i) in currentWaypoints"
          :key="i"
          class="wp-row"
          :class="{ start: i === 0, end: i === currentWaypoints.length - 1 && i > 0 }"
        >
          <span class="wp-idx" :class="{ start: i === 0, end: i === currentWaypoints.length - 1 && i > 0 }">
            {{ i }}
          </span>
          <span class="wp-coords">
            {{ fmt(wp.x) }}, {{ fmt(wp.y) }}, {{ fmt(wp.z) }}
          </span>
          <div class="wp-row-btns">
            <button :disabled="i === 0" @click="emit('move-waypoint', { entityId: selectedEntityId!, from: i, to: i - 1 })">↑</button>
            <button :disabled="i === currentWaypoints.length - 1" @click="emit('move-waypoint', { entityId: selectedEntityId!, from: i, to: i + 1 })">↓</button>
            <button class="del" @click="removeWaypoint(i)">×</button>
          </div>
        </div>
        <p v-if="currentWaypoints.length === 0" class="wp-empty">
          No waypoints yet.
        </p>
      </div>

      <!-- Footer actions -->
      <div class="path-footer" v-if="currentWaypoints.length > 0">
        <p class="wp-count">{{ currentWaypoints.length }} waypoint{{ currentWaypoints.length !== 1 ? 's' : '' }}</p>
        <button class="btn-copy" @click="copyTypeScript">Copy TypeScript</button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         ZONE panel
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'zone'" class="panel-body">
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">ID</label>
        <code class="field-mono">{{ selectedZone.id }}</code>
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Type</label>
        <p class="field-value">{{ selectedZone.type }}</p>
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Centre</label>
        <div class="coords-row">
          <span class="coord-item">X <code>{{ fmt(selectedZone.x) }}</code></span>
          <span class="coord-item">Z <code>{{ fmt(selectedZone.z) }}</code></span>
        </div>
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Radius</label>
        <p class="field-value">{{ selectedZone.radius }}m</p>
      </div>
      <div v-if="selectedZone?.targetSceneId" class="field-group">
        <label class="field-label">→ Scene</label>
        <p class="field-value">{{ selectedZone.targetSceneId }}</p>
      </div>
      <p class="field-hint">
        Zone geometry is read-only. Edit in the scene gameplay policy to resize.
      </p>
    </div>

  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import * as THREE from 'three'
import type { SceneEditorConfig, EditorSelection } from './sceneEditorTypes'

const props = defineProps<{
  selection: EditorSelection
  config: SceneEditorConfig
  /** Current waypoints per NPC entity. Updated externally by SceneEditorView. */
  waypointMap: Map<string, THREE.Vector3[]>
}>()

const emit = defineEmits<{
  'path-edit-start': [entityId: string, cb: (pos: THREE.Vector3) => void]
  'path-edit-stop': []
  'waypoints-changed': [entityId: string, waypoints: THREE.Vector3[]]
  'move-waypoint': [payload: { entityId: string; from: number; to: number }]
}>()

// ─── Tab state ────────────────────────────────────────────────────────────────

const npcTabs = ['Transform', 'Path'] as const
type NpcTab = (typeof npcTabs)[number]
const activeTab = ref<NpcTab>('Transform')

watch(() => props.selection, () => {
  // Reset to Transform tab whenever selection changes
  activeTab.value = 'Transform'
  if (pathEditMode.value) stopPathEditMode()
})

// ─── Derived selection ────────────────────────────────────────────────────────

const selectedNpc = computed(() => {
  const sel = props.selection
  if (sel?.kind !== 'npc') return undefined
  return props.config.npcs?.find(n => n.entityId === sel.entityId)
})

const selectedZone = computed(() => {
  const sel = props.selection
  if (sel?.kind !== 'zone') return undefined
  return props.config.zones?.find(z => z.id === sel.id)
})

/** Narrowed entityId — safe to use in template event handlers without union widening. */
const selectedEntityId = computed<string | null>(() =>
  props.selection?.kind === 'npc' ? props.selection.entityId : null
)

const contextLabel = computed(() => {
  if (!props.selection || props.selection.kind === 'scene') return 'Scene'
  if (props.selection.kind === 'npc') return selectedNpc.value?.label ?? props.selection.entityId
  if (props.selection.kind === 'zone') return selectedZone.value?.label ?? props.selection.id
  return ''
})

// ─── Path tab ─────────────────────────────────────────────────────────────────

const pathEditMode = ref(false)

const currentWaypoints = computed<THREE.Vector3[]>(() => {
  if (props.selection?.kind !== 'npc') return []
  return props.waypointMap.get(props.selection.entityId) ?? []
})

function togglePathEditMode(): void {
  if (pathEditMode.value) {
    stopPathEditMode()
  } else {
    startPathEditMode()
  }
}

function startPathEditMode(): void {
  if (props.selection?.kind !== 'npc') return
  const entityId = props.selection.entityId
  pathEditMode.value = true
  emit('path-edit-start', entityId, (pos: THREE.Vector3) => {
    const prev = props.waypointMap.get(entityId) ?? []
    emit('waypoints-changed', entityId, [...prev, pos])
  })
}

function stopPathEditMode(): void {
  pathEditMode.value = false
  emit('path-edit-stop')
}

function undoLastWaypoint(): void {
  if (props.selection?.kind !== 'npc') return
  const entityId = props.selection.entityId
  const prev = props.waypointMap.get(entityId) ?? []
  if (prev.length === 0) return
  emit('waypoints-changed', entityId, prev.slice(0, -1))
}

function removeWaypoint(index: number): void {
  if (props.selection?.kind !== 'npc') return
  const entityId = props.selection.entityId
  const prev = [...(props.waypointMap.get(entityId) ?? [])]
  prev.splice(index, 1)
  emit('waypoints-changed', entityId, prev)
}

function clearWaypoints(): void {
  if (props.selection?.kind !== 'npc') return
  emit('waypoints-changed', props.selection.entityId, [])
}

function copyTypeScript(): void {
  if (props.selection?.kind !== 'npc') return
  const entityId = props.selection.entityId
  const wps = props.waypointMap.get(entityId) ?? []
  const prefix = props.config.exportNamePrefix
    ? `${props.config.exportNamePrefix}_`
    : ''
  const varName = `${prefix}${entityId.toUpperCase().replace(/-/g, '_')}_PATH`
  const lines = wps.map(w =>
    `  new THREE.Vector3(${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)}),`
  ).join('\n')
  const ts = [
    `// Generated by @base/ui SceneEditor — ${new Date().toLocaleDateString()}`,
    `import * as THREE from 'three'`,
    ``,
    `export const ${varName}: THREE.Vector3[] = [`,
    lines || '  // no waypoints placed yet',
    `]`,
  ].join('\n')

  navigator.clipboard.writeText(ts).then(() => {
    // Temporary visual feedback handled by status bar in parent
  }).catch(() => {})
}

// ─── Keyboard Ctrl+Z undo ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (!pathEditMode.value) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault()
    undoLastWaypoint()
  }
}

import { onMounted, onUnmounted } from 'vue'
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (pathEditMode.value) stopPathEditMode()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toFixed(2)
</script>

<style scoped>
.inspector {
  width: 260px;
  flex-shrink: 0;
  background: #0d1320;
  border-left: 1px solid #182a40;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #b0bec5;
  overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.context-label {
  font-family: monospace;
  font-size: 10px;
  color: #5ab0f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

/* ── Tab bar ──────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid #182a40;
}
.tab {
  flex: 1;
  padding: 6px 4px;
  font-size: 11px;
  font-weight: 600;
  background: transparent;
  color: #4a6880;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.tab:hover { color: #8ab0d0; }
.tab.active {
  color: #5ab0f5;
  border-bottom-color: #5ab0f5;
}

/* ── Panel body ──────────────────────────────────────────────────────────── */
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 12px 16px;
  scrollbar-width: thin;
  scrollbar-color: #182a40 transparent;
}

.field-group {
  margin-bottom: 14px;
}
.field-label {
  display: block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3a5060;
  margin-bottom: 4px;
}
.field-value {
  margin: 0;
  font-size: 12px;
  color: #a0b4c8;
}
.field-mono {
  font-family: monospace;
  font-size: 10px;
  color: #7ab0d8;
  background: #0e1c2e;
  padding: 2px 6px;
  border-radius: 3px;
  display: block;
  word-break: break-all;
}
.field-hint {
  margin: 4px 0 0;
  font-size: 10px;
  color: #2a4a5a;
  line-height: 1.6;
}
.coords-row {
  display: flex;
  gap: 10px;
}
.coord-item {
  font-size: 10px;
  color: #4a7090;
}
.coord-item code {
  font-family: monospace;
  color: #7ab0d8;
  margin-left: 2px;
}

/* ── Path panel ──────────────────────────────────────────────────────────── */
.path-panel {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.path-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #182a40;
  flex-shrink: 0;
}
.btn-toggle {
  flex: 1;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid #1a3050;
  background: transparent;
  color: #5ab0f5;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-toggle:hover { background: rgba(90,176,245,0.1); }
.btn-toggle.active {
  background: rgba(90,176,245,0.15);
  border-color: #5ab0f5;
  color: #9dd4ff;
}
.btn-undo,
.btn-clear {
  padding: 4px 7px;
  font-size: 11px;
  background: transparent;
  border: 1px solid #1a3050;
  color: #4a6880;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.1s;
}
.btn-undo:hover { color: #8ab0d0; border-color: #2a4a60; }
.btn-clear:hover { color: #ff6060; border-color: #4a1e1e; }

.edit-hint {
  margin: 0;
  padding: 6px 10px;
  font-size: 10px;
  color: #5ab0f5;
  background: rgba(90,176,245,0.06);
  border-bottom: 1px solid #182a40;
}

.wp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: #182a40 transparent;
}
.wp-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
}
.wp-idx {
  width: 18px;
  text-align: center;
  font-family: monospace;
  font-size: 9px;
  font-weight: 700;
  color: #ffcc00;
  flex-shrink: 0;
}
.wp-idx.start { color: #44ff88; }
.wp-idx.end { color: #4488ff; }
.wp-coords {
  flex: 1;
  font-family: monospace;
  font-size: 9px;
  color: #5a7a90;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-row-btns {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.wp-row-btns button {
  background: transparent;
  border: 1px solid #1a2a3a;
  color: #3a5060;
  font-size: 9px;
  padding: 1px 3px;
  border-radius: 2px;
  cursor: pointer;
  line-height: 1.4;
}
.wp-row-btns button:hover:not(:disabled) {
  color: #7ab0d0;
  border-color: #2a4050;
}
.wp-row-btns button.del:hover:not(:disabled) {
  color: #ff6060;
  border-color: #4a1e1e;
}
.wp-row-btns button:disabled { opacity: 0.25; cursor: default; }
.wp-empty {
  margin: 0;
  padding: 16px 10px;
  font-size: 10px;
  color: #2a3a4a;
  text-align: center;
}

.path-footer {
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid #182a40;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-count {
  flex: 1;
  margin: 0;
  font-size: 10px;
  color: #3a5060;
}
.btn-copy {
  padding: 5px 10px;
  font-size: 10px;
  font-weight: 600;
  background: #1a6aaa;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-copy:hover { background: #2280cc; }
</style>
