<!--
  SceneEditorInspector — right panel, contextual tabs based on current selection.

  nothing / scene → Scene tab (spawn, NPC/zone counts)
  NPC selected    → Transform | Path | Asset tabs
  Zone selected   → Zone tab
  placed selected → Placed tab (read-only summary)
-->
<template>
  <aside class="inspector">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="inspector-header">
      <span class="title">Inspector</span>
      <span class="context-label">{{ contextLabel }}</span>
      <!-- Trash button for NPC / Zone -->
      <button
        v-if="selection?.kind === 'npc' || selection?.kind === 'zone'"
        class="btn-trash"
        title="Remove this entry"
        @click="onRemove"
      >🗑</button>
    </header>

    <!-- ── Tab bar ────────────────────────────────────────────────────────── -->
    <div v-if="selection?.kind === 'npc'" class="tab-bar">
      <button
        v-for="tab in npcTabs"
        :key="tab"
        class="tab"
        :class="{ active: activeTab === tab }"
        @click="activeTab = tab"
      >{{ tab }}</button>
      <button
        v-if="selectedNpc?.assetId"
        class="tab"
        :class="{ active: activeTab === 'Pose' }"
        @click="onPoseTabClick"
      >Pose</button>
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
        <p class="field-value">{{ npcs.length }}</p>
      </div>
      <div class="field-group">
        <label class="field-label">Zones</label>
        <p class="field-value">{{ zones.length }}</p>
      </div>
      <!-- D-5b: Play-sim player character -->
      <div class="section-divider">Play Simulation</div>
      <div class="field-group">
        <label class="field-label">Player character</label>
        <div class="asset-row">
          <span class="asset-id" :class="{ unset: !playerCharAssetId }">
            {{ playerCharAssetId ? assetName(playerCharAssetId) : 'capsule (fallback)' }}
          </span>
          <button class="btn-asset-pick" @click="emit('pick-player-asset', 'character')">Set…</button>
          <button
            v-if="playerCharAssetId"
            class="btn-asset-clear"
            @click="emit('clear-player-char')"
          >✕</button>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Anim pack</label>
        <div class="asset-row">
          <span class="asset-id" :class="{ unset: !playerAnimPackAssetId }">
            {{ playerAnimPackAssetId ? assetName(playerAnimPackAssetId) : 'none' }}
          </span>
          <button class="btn-asset-pick" @click="emit('pick-player-asset', 'animation-pack')">Set…</button>
          <button
            v-if="playerAnimPackAssetId"
            class="btn-asset-clear"
            @click="emit('clear-player-anim-pack')"
          >✕</button>
        </div>
      </div>

      <!-- Phase 5 S1: Ambient audio -->
      <div class="section-divider">Ambient Audio</div>
      <div class="field-group">
        <label class="field-label">Audio track</label>
        <div class="asset-row">
          <span class="asset-id" :class="{ unset: !config.ambientAudioAssetId }">
            {{ config.ambientAudioAssetId ? assetName(config.ambientAudioAssetId) : 'none' }}
          </span>
          <button class="btn-asset-pick" @click="emit('pick-ambient-audio')">Set…</button>
          <button
            v-if="config.ambientAudioAssetId"
            class="btn-asset-clear"
            @click="emit('clear-ambient-audio')"
          >✕</button>
        </div>
      </div>
      <div v-if="config.ambientAudioAssetId" class="field-group">
        <label class="field-label">Volume</label>
        <div class="volume-row">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="volume-slider"
            :value="config.ambientAudioVolume ?? 1"
            @input="emit('set-ambient-audio-volume', parseFloat(($event.target as HTMLInputElement).value))"
          />
          <span class="volume-label">{{ Math.round((config.ambientAudioVolume ?? 1) * 100) }}%</span>
        </div>
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
        <label class="field-label">Label</label>
        <input
          class="field-input"
          :value="selectedNpc.label ?? selectedNpc.entityId"
          @change="emit('npc-changed', selectedNpc!.entityId, { label: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Position</label>
        <div class="coords-row editable">
          <label class="coord-edit">
            X
            <input
              type="number"
              step="0.1"
              class="coord-input"
              :value="fmt(selectedNpc.x)"
              @change="emit('npc-changed', selectedNpc!.entityId, { x: parseFloat(($event.target as HTMLInputElement).value) || 0 })"
            />
          </label>
          <label class="coord-edit">
            Z
            <input
              type="number"
              step="0.1"
              class="coord-input"
              :value="fmt(selectedNpc.z)"
              @change="emit('npc-changed', selectedNpc!.entityId, { z: parseFloat(($event.target as HTMLInputElement).value) || 0 })"
            />
          </label>
        </div>
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Rotation Y (deg)</label>
        <input
          type="number"
          step="5"
          class="field-input-num"
          :value="selectedNpc.rotationY ?? 0"
          @change="emit('npc-changed', selectedNpc!.entityId, { rotationY: parseFloat(($event.target as HTMLInputElement).value) || 0 })"
        />
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Scale</label>
        <input
          type="number"
          step="0.05"
          min="0.01"
          class="field-input-num"
          :value="selectedNpc.scale ?? 1"
          @change="emit('npc-changed', selectedNpc!.entityId, { scale: parseFloat(($event.target as HTMLInputElement).value) || 1 })"
        />
      </div>
      <div v-if="selectedNpc?.proximityRadius" class="field-group">
        <label class="field-label">Proximity radius</label>
        <p class="field-value">{{ selectedNpc.proximityRadius }}m</p>
      </div>
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

      <p v-if="pathEditMode" class="edit-hint">
        Click the floor in the viewport to place waypoints.
      </p>

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

      <div class="path-footer" v-if="currentWaypoints.length > 0">
        <p class="wp-count">{{ currentWaypoints.length }} waypoint{{ currentWaypoints.length !== 1 ? 's' : '' }}</p>
        <button class="btn-copy" @click="copyTypeScript">Copy TypeScript</button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         NPC — Asset tab (F-9 / F-10)
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'npc' && activeTab === 'Asset'" class="panel-body">
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Character mesh</label>
        <div class="asset-row">
          <span class="asset-id" :class="{ unset: !selectedNpc.assetId }">
            {{ selectedNpc.assetId ? assetName(selectedNpc.assetId) : 'none' }}
          </span>
          <button class="btn-asset-pick" @click="emit('pick-npc-asset', selectedNpc!.entityId, 'character')">
            Set…
          </button>
          <button
            v-if="selectedNpc.assetId"
            class="btn-asset-clear"
            @click="emit('npc-changed', selectedNpc!.entityId, { assetId: undefined })"
          >✕</button>
        </div>
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Animation pack</label>
        <div class="asset-row">
          <span class="asset-id" :class="{ unset: !selectedNpc.animationPackAssetId }">
            {{ selectedNpc.animationPackAssetId ? assetName(selectedNpc.animationPackAssetId) : 'none' }}
          </span>
          <button class="btn-asset-pick" @click="emit('pick-npc-asset', selectedNpc!.entityId, 'animation-pack')">
            Set…
          </button>
          <button
            v-if="selectedNpc.animationPackAssetId"
            class="btn-asset-clear"
            @click="emit('npc-changed', selectedNpc!.entityId, { animationPackAssetId: undefined })"
          >✕</button>
        </div>
      </div>
      <div v-if="selectedNpc" class="field-group">
        <label class="field-label">Default clip</label>
        <select
          v-if="availableClips.length > 0"
          class="field-select"
          :value="selectedNpc.defaultClip ?? ''"
          @change="emit('npc-changed', selectedNpc!.entityId, { defaultClip: ($event.target as HTMLSelectElement).value || undefined })"
        >
          <option value="">(none)</option>
          <option v-for="clip in availableClips" :key="clip" :value="clip">{{ clip }}</option>
        </select>
        <p v-else class="field-hint">
          {{ selectedNpc.animationPackAssetId ? 'No clips found in pack.' : 'Set an animation pack first.' }}
        </p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         NPC — Pose tab (S4)
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'npc' && activeTab === 'Pose'" class="panel-body pose-panel">
      <p v-if="!hasPoseCharacter" class="field-hint">Activating pose editor…</p>
      <template v-else>
        <div class="field-group">
          <label class="field-label">Skeleton bones</label>
          <div class="bone-list">
            <button
              v-for="bone in poseBoneList"
              :key="bone"
              :class="['bone-row', { active: selectedPoseBoneName === bone }]"
              @click="emit('pose-bone-select', bone)"
            >{{ bone }}</button>
            <p v-if="poseBoneList.length === 0" class="field-hint">No bones found.</p>
          </div>
        </div>
        <div class="pose-actions">
          <button class="btn-pose-capture" @click="emit('pose-capture')" title="Capture current bone rotations as poseOverride">
            Capture Pose
          </button>
          <button class="btn-pose-reset" @click="emit('pose-clear')" title="Reset all bones to bind pose">
            Reset Bones
          </button>
        </div>
        <p class="field-hint" style="margin-top:8px">
          Select a bone, then use <kbd style="font-size:9px;background:#0e1c2e;padding:1px 4px;border-radius:2px;border:1px solid #1a3050">R</kbd> + drag to rotate (FK).
        </p>
      </template>
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
        <label class="field-label">Label</label>
        <input
          class="field-input"
          :value="selectedZone.label ?? selectedZone.id"
          @change="emit('zone-changed', selectedZone!.id, { label: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Type</label>
        <select
          class="field-select"
          :value="selectedZone.type"
          @change="emit('zone-changed', selectedZone!.id, { type: ($event.target as HTMLSelectElement).value as 'exit' | 'proximity' })"
        >
          <option value="proximity">proximity</option>
          <option value="exit">exit</option>
        </select>
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Centre</label>
        <div class="coords-row editable">
          <label class="coord-edit">
            X
            <input
              type="number"
              step="0.1"
              class="coord-input"
              :value="fmt(selectedZone.x)"
              @change="emit('zone-changed', selectedZone!.id, { x: parseFloat(($event.target as HTMLInputElement).value) || 0 })"
            />
          </label>
          <label class="coord-edit">
            Z
            <input
              type="number"
              step="0.1"
              class="coord-input"
              :value="fmt(selectedZone.z)"
              @change="emit('zone-changed', selectedZone!.id, { z: parseFloat(($event.target as HTMLInputElement).value) || 0 })"
            />
          </label>
        </div>
      </div>
      <div v-if="selectedZone" class="field-group">
        <label class="field-label">Radius (m)</label>
        <input
          type="number"
          step="0.5"
          min="0.1"
          class="field-input-num"
          :value="selectedZone.radius"
          @change="emit('zone-changed', selectedZone!.id, { radius: parseFloat(($event.target as HTMLInputElement).value) || 1 })"
        />
      </div>
      <div v-if="selectedZone?.targetSceneId || selectedZone?.type === 'exit'" class="field-group">
        <label class="field-label">→ Scene ID</label>
        <input
          class="field-input"
          :value="selectedZone.targetSceneId ?? ''"
          placeholder="scene-id…"
          @change="emit('zone-changed', selectedZone!.id, { targetSceneId: ($event.target as HTMLInputElement).value || undefined })"
        />
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════
         PLACED OBJECT panel
    ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="selection.kind === 'placed'" class="panel-body">
      <p class="field-hint">Placed object selected. Use the gizmo (T/R/S) to transform it.</p>
    </div>

  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import * as THREE from 'three'
import { useAssetStore } from './useAssetStore'
import type { SceneEditorConfig, EditorSelection, EditorNpcEntry, EditorZoneEntry } from './sceneEditorTypes'

const props = defineProps<{
  selection: EditorSelection
  config: SceneEditorConfig
  /** Local mutable NPC list — drives writable transform inputs. */
  npcs: EditorNpcEntry[]
  /** Local mutable zone list — drives writable transform inputs. */
  zones: EditorZoneEntry[]
  waypointMap: Map<string, THREE.Vector3[]>
  /** D-5b: asset ID of the player character GLB (undefined = capsule fallback). */
  playerCharAssetId?: string
  /** D-5b: asset ID of the player animation pack GLB. */
  playerAnimPackAssetId?: string
  // ─── S4: Pose Editor ────────────────────────────────────────────────────
  /** Bone names from the loaded pose mesh skeleton. Empty until mesh is loaded. */
  poseBoneList: string[]
  /** Name of the bone currently attached to TransformControls, or null. */
  selectedPoseBoneName: string | null
  /** True when the pose character mesh is loaded and bones are available. */
  hasPoseCharacter: boolean
}>()

const emit = defineEmits<{
  'path-edit-start': [entityId: string, cb: (pos: THREE.Vector3) => void]
  'path-edit-stop': []
  'waypoints-changed': [entityId: string, waypoints: THREE.Vector3[]]
  'move-waypoint': [payload: { entityId: string; from: number; to: number }]
  'npc-changed': [entityId: string, patch: Partial<EditorNpcEntry>]
  'zone-changed': [id: string, patch: Partial<EditorZoneEntry>]
  'remove-npc': [entityId: string]
  'remove-zone': [id: string]
  'pick-npc-asset': [entityId: string, kind: 'character' | 'animation-pack']
  /** D-5b: open asset picker for the play-sim player character. */
  'pick-player-asset': [kind: 'character' | 'animation-pack']
  'clear-player-char': []
  'clear-player-anim-pack': []
  /** Phase 5 S1: ambient audio. */
  'pick-ambient-audio': []
  'set-ambient-audio-volume': [volume: number]
  'clear-ambient-audio': []
  // ─── S4: Pose Editor ──────────────────────────────────────────────────────
  'pose-tab-activate': []
  'pose-bone-select': [boneName: string]
  'pose-capture': []
  'pose-clear': []
}>()

const assetStore = useAssetStore()

// ─── Tab state ────────────────────────────────────────────────────────────────

const npcTabs = ['Transform', 'Path', 'Asset'] as const
type NpcTab = (typeof npcTabs)[number] | 'Pose'
const activeTab = ref<NpcTab>('Transform')

function onPoseTabClick(): void {
  activeTab.value = 'Pose'
  emit('pose-tab-activate')
}

watch(() => props.selection, () => {
  activeTab.value = 'Transform'
  if (pathEditMode.value) stopPathEditMode()
})

// ─── Derived selection ────────────────────────────────────────────────────────

const selectedNpc = computed(() => {
  const sel = props.selection
  if (sel?.kind !== 'npc') return undefined
  return props.npcs.find(n => n.entityId === sel.entityId)
})

const selectedZone = computed(() => {
  const sel = props.selection
  if (sel?.kind !== 'zone') return undefined
  return props.zones.find(z => z.id === sel.id)
})

const selectedEntityId = computed<string | null>(() =>
  props.selection?.kind === 'npc' ? props.selection.entityId : null
)

const contextLabel = computed(() => {
  if (!props.selection || props.selection.kind === 'scene') return 'Scene'
  if (props.selection.kind === 'npc') return selectedNpc.value?.label ?? props.selection.entityId
  if (props.selection.kind === 'zone') return selectedZone.value?.label ?? props.selection.id
  if (props.selection.kind === 'placed') return 'Placed object'
  if (props.selection.kind === 'player') return 'Player'
  return ''
})

// ─── Asset helpers (F-9 / F-10) ──────────────────────────────────────────────

function assetName(id: string): string {
  return assetStore.getById(id)?.name ?? id
}

const availableClips = computed<string[]>(() => {
  if (props.selection?.kind !== 'npc') return []
  const npc = selectedNpc.value
  if (!npc?.animationPackAssetId) return []
  return assetStore.getById(npc.animationPackAssetId)?.clipNames ?? []
})

// ─── Remove action ────────────────────────────────────────────────────────────

function onRemove(): void {
  if (props.selection?.kind === 'npc') emit('remove-npc', props.selection.entityId)
  else if (props.selection?.kind === 'zone') emit('remove-zone', props.selection.id)
}

// ─── Path tab ─────────────────────────────────────────────────────────────────

const pathEditMode = ref(false)

const currentWaypoints = computed<THREE.Vector3[]>(() => {
  if (props.selection?.kind !== 'npc') return []
  return props.waypointMap.get(props.selection.entityId) ?? []
})

function togglePathEditMode(): void {
  if (pathEditMode.value) stopPathEditMode()
  else startPathEditMode()
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
  navigator.clipboard.writeText(ts).catch(() => {})
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
  gap: 6px;
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
  flex: 1;
  font-family: monospace;
  font-size: 10px;
  color: #5ab0f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn-trash {
  background: transparent;
  border: none;
  font-size: 12px;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.5;
  transition: opacity 0.1s;
}
.btn-trash:hover { opacity: 1; }

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
.field-input {
  width: 100%;
  background: #0e1c2e;
  border: 1px solid #182a40;
  border-radius: 3px;
  color: #9dd4ff;
  font-size: 11px;
  padding: 4px 6px;
  box-sizing: border-box;
}
.field-input:focus {
  outline: none;
  border-color: #3a6080;
}
.field-input-num {
  width: 80px;
  background: #0e1c2e;
  border: 1px solid #182a40;
  border-radius: 3px;
  color: #9dd4ff;
  font-size: 11px;
  padding: 4px 6px;
  text-align: right;
}
.field-input-num:focus {
  outline: none;
  border-color: #3a6080;
}
.field-select {
  width: 100%;
  background: #0e1c2e;
  border: 1px solid #182a40;
  border-radius: 3px;
  color: #9dd4ff;
  font-size: 11px;
  padding: 4px 6px;
  box-sizing: border-box;
}
.field-select:focus { outline: none; border-color: #3a6080; }

/* ── Coords row ──────────────────────────────────────────────────────────── */
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
.coords-row.editable {
  gap: 8px;
}
.coord-edit {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #4a7090;
}
.coord-input {
  width: 64px;
  background: #0e1c2e;
  border: 1px solid #182a40;
  border-radius: 3px;
  color: #9dd4ff;
  font-size: 11px;
  padding: 3px 5px;
  text-align: right;
}
.coord-input:focus { outline: none; border-color: #3a6080; }

/* ── Section divider ────────────────────────────────────────────────────── */
.section-divider {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #2a4a5a;
  border-top: 1px solid #182a40;
  padding: 8px 0 6px;
  margin-bottom: 10px;
}

/* ── Asset row (F-9) ─────────────────────────────────────────────────────── */
.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.asset-id {
  flex: 1;
  font-family: monospace;
  font-size: 10px;
  color: #7ab0d8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-id.unset { color: #2a4a5a; }
.btn-asset-pick {
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  background: transparent;
  border: 1px solid #1a3050;
  color: #5ab0f5;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-asset-pick:hover { background: rgba(90,176,245,0.1); }
.btn-asset-clear {
  padding: 3px 6px;
  font-size: 10px;
  background: transparent;
  border: 1px solid #1a2a3a;
  color: #3a5060;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-asset-clear:hover { color: #ff6060; border-color: #4a1e1e; }

/* ── Volume slider (Phase 5 S1) ─────────────────────────────────────────── */
.volume-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.volume-slider {
  flex: 1;
  height: 3px;
  accent-color: #5ab0f5;
  cursor: pointer;
}
.volume-label {
  font-size: 10px;
  font-family: monospace;
  color: #5ab0f5;
  min-width: 30px;
  text-align: right;
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
  border: 1px solid #1a2a3a;
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
.wp-row-btns button:hover:not(:disabled) { color: #7ab0d0; border-color: #2a4050; }
.wp-row-btns button.del:hover:not(:disabled) { color: #ff6060; border-color: #4a1e1e; }
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

/* ── Pose panel (S4) ─────────────────────────────────────────────────────── */
.pose-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.bone-list {
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #182a40 transparent;
  border: 1px solid #182a40;
  border-radius: 3px;
}
.bone-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-bottom: 1px solid #0e1622;
  color: #5a8090;
  font-family: monospace;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.bone-row:last-child { border-bottom: none; }
.bone-row:hover { background: rgba(90,176,245,0.07); color: #7ab0d8; }
.bone-row.active { background: rgba(90,176,245,0.14); color: #9dd4ff; }
.pose-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.btn-pose-capture {
  flex: 1;
  padding: 5px 8px;
  font-size: 10px;
  font-weight: 600;
  background: #1a5a2a;
  color: #44ff88;
  border: 1px solid #2a7040;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-pose-capture:hover { background: #226030; }
.btn-pose-reset {
  flex: 1;
  padding: 5px 8px;
  font-size: 10px;
  font-weight: 600;
  background: transparent;
  color: #4a6880;
  border: 1px solid #1a2a3a;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.1s;
}
.btn-pose-reset:hover { color: #ff8060; border-color: #4a2010; }
</style>
