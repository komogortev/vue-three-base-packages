<!--
  AssetPicker — modal asset selector for the @base/ui editor.

  <dialog>-based modal. Lists assets from useAssetStore, optionally filtered
  by kind. Emits `select(assetId)` on row click, `close` on Escape / backdrop
  / X button. Escape and backdrop never emit `select`.

  Contract: SHARED/packages/ui/docs/ASSET-PIPELINE.md §AssetPicker.

  Usage:
    <AssetPicker
      :open="pickerOpen"
      :kind-filter="'character'"
      @close="pickerOpen = false"
      @select="(id) => onSelect(id)"
    />
-->
<template>
  <dialog
    ref="dialogEl"
    class="asset-picker"
    @close="emit('close')"
    @click="onDialogClick"
  >
    <div class="picker-frame" @click.stop>
      <div class="picker-header">
        <span class="title">
          Pick an asset<span v-if="kindFilter"> — {{ kindFilter }}</span>
        </span>
        <button
          class="close-btn"
          type="button"
          title="Close (Esc)"
          @click="closeDialog"
        >
          ×
        </button>
      </div>

      <div class="picker-body">
        <p v-if="filteredAssets.length === 0" class="empty">
          <template v-if="kindFilter">
            No {{ kindFilter }} assets yet — upload one from the Assets section.
          </template>
          <template v-else>
            No assets yet — upload one from the Assets section.
          </template>
        </p>

        <div
          v-for="asset in filteredAssets"
          :key="asset.id"
          class="picker-row"
          tabindex="0"
          @click="onRowClick(asset.id)"
          @keydown.enter.prevent="onRowClick(asset.id)"
          @keydown.space.prevent="onRowClick(asset.id)"
        >
          <img
            v-if="thumbnailUrls.get(asset.id)"
            :src="thumbnailUrls.get(asset.id)!"
            class="asset-thumb"
            :alt="asset.name"
          />
          <span v-else class="asset-thumb placeholder">⬢</span>
          <div class="asset-info">
            <div class="asset-name" :title="asset.name">{{ asset.name }}</div>
            <div class="asset-meta">
              <span class="kind-badge" :data-kind="asset.kind">{{ asset.kind }}</span>
              <span class="size">{{ formatBytes(asset.size) }}</span>
              <span v-if="asset.clipNames?.length" class="clip-count">
                {{ asset.clipNames.length }} clip{{ asset.clipNames.length === 1 ? '' : 's' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAssetStore } from './useAssetStore'
import type { AssetKind, AssetRow } from './assetDb'

interface Props {
  open: boolean
  kindFilter?: AssetKind
}
const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  select: [assetId: string]
}>()

const store = useAssetStore()
const dialogEl = ref<HTMLDialogElement | null>(null)

const filteredAssets = computed<AssetRow[]>(() => {
  const list = store.assets
  if (!props.kindFilter) return list
  return list.filter((a) => a.kind === props.kindFilter)
})

// ── Dialog open / close ──────────────────────────────────────────────────
// `flush: 'post'` fires the effect after Vue's DOM update, ensuring
// `dialogEl.value` is in its final state for the tick. Without this,
// re-opens after a programmatic close could miss because the watcher ran
// while the native `close` event hadn't yet propagated.
watch(
  () => props.open,
  (isOpen) => {
    const el = dialogEl.value
    if (!el) return
    if (isOpen && !el.open) {
      el.showModal()
    } else if (!isOpen && el.open) {
      el.close()
    }
  },
  { flush: 'post' },
)

function closeDialog(): void {
  if (dialogEl.value?.open) {
    dialogEl.value.close()
  } else {
    emit('close')
  }
}

// Backdrop click — <dialog> backdrop fires click events on the dialog itself
// (target === dialogEl). Inner .picker-frame stops propagation, so clicks
// arriving here came from outside the frame.
function onDialogClick(ev: MouseEvent): void {
  if (ev.target === dialogEl.value) {
    closeDialog()
  }
}

function onRowClick(id: string): void {
  emit('select', id)
  if (dialogEl.value?.open) {
    dialogEl.value.close()
  }
}

// ── Thumbnail URL cache (component-scoped) ───────────────────────────────
// Distinct from SceneEditorAssetsSection's own cache; each component owns
// its own object URLs and revokes them independently.
const thumbnailUrls = ref<Map<string, string>>(new Map())

watch(
  filteredAssets,
  (current) => {
    const currentIds = new Set(current.map((a) => a.id))
    for (const [id, url] of thumbnailUrls.value) {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(url)
        thumbnailUrls.value.delete(id)
      }
    }
    for (const a of current) {
      if (a.thumbnail && !thumbnailUrls.value.has(a.id)) {
        thumbnailUrls.value.set(a.id, URL.createObjectURL(a.thumbnail))
      }
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of thumbnailUrls.value.values()) {
    URL.revokeObjectURL(url)
  }
  thumbnailUrls.value.clear()
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.asset-picker {
  width: min(520px, 90vw);
  max-height: 80vh;
  padding: 0;
  background: #0a1018;
  color: #a0b4c8;
  border: 1px solid #182a40;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
}
.asset-picker::backdrop {
  background: rgba(0, 0, 0, 0.55);
}

.picker-frame {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #182a40;
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #6a8aaa;
}
.title { user-select: none; }

.close-btn {
  background: none;
  border: 0;
  color: #4a6080;
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  font-family: inherit;
}
.close-btn:hover { color: #d27575; }

.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.empty {
  margin: 10px 14px;
  font-size: 11px;
  color: #2a3a4a;
  line-height: 1.5;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  user-select: none;
  outline: none;
}
.picker-row:hover,
.picker-row:focus {
  background: rgba(90, 176, 245, 0.08);
}

.asset-thumb {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 3px;
  background: #0a1018;
  border: 1px solid #182a40;
}
.asset-thumb.placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #3a5060;
  font-size: 14px;
}

.asset-info {
  flex: 1;
  min-width: 0;
}
.asset-name {
  font-size: 11px;
  color: #a0b4c8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.asset-meta {
  display: flex;
  gap: 6px;
  font-size: 9px;
  color: #4a6080;
  font-family: monospace;
  margin-top: 2px;
}
.kind-badge {
  background: #18304a;
  color: #5ab0f5;
  padding: 0 4px;
  border-radius: 2px;
}
.kind-badge[data-kind='character'] { color: #5ab0f5; }
.kind-badge[data-kind='animation-pack'] { color: #ffcc44; }
.kind-badge[data-kind='environment'] { color: #44ff88; }
.kind-badge[data-kind='prop'] { color: #c099ff; }
.size, .clip-count { color: #4a6080; }
</style>
