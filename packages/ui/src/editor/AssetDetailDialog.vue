<!--
  AssetDetailDialog — read-only detail view for a single asset.

  Opens when `asset` prop is non-null. Shows a large thumbnail, full name,
  metadata, and clip list. "Place in scene" emits `place(assetId)`.
  Close via X button, Escape, or backdrop click — none of those emit `place`.

  Usage:
    <AssetDetailDialog
      :asset="detailAsset"
      :thumbnail-url="thumbnailUrls.get(detailAsset?.id)"
      @close="detailAsset = null"
      @place="(id) => emit('asset-picked', id)"
    />
-->
<template>
  <dialog
    ref="dialogEl"
    class="asset-detail-dialog"
    @close="emit('close')"
    @click="onBackdropClick"
  >
    <div class="detail-frame" @click.stop>
      <div class="detail-header">
        <span class="detail-title" :title="asset?.name">{{ asset?.name }}</span>
        <button class="close-btn" type="button" title="Close (Esc)" @click="closeDialog">×</button>
      </div>

      <div class="detail-body">
        <div class="detail-thumb-wrap">
          <img
            v-if="thumbnailUrl"
            :src="thumbnailUrl"
            class="detail-thumb"
            :alt="asset?.name"
          />
          <span v-else class="detail-thumb-placeholder">⬢</span>
        </div>

        <div class="detail-meta">
          <span class="kind-badge" :data-kind="asset?.kind">{{ asset?.kind }}</span>
          <span class="size">{{ formatBytes(asset?.size ?? 0) }}</span>
          <span v-if="asset?.clipNames?.length" class="clip-count">
            {{ asset.clipNames.length }} clip{{ asset.clipNames.length === 1 ? '' : 's' }}
          </span>
        </div>

        <ul v-if="asset?.clipNames?.length" class="clip-list">
          <li v-for="clip in asset.clipNames" :key="clip" class="clip-name">{{ clip }}</li>
        </ul>
      </div>

      <div class="detail-footer">
        <button class="place-btn" type="button" @click="onPlace">Place in scene</button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetRow } from './assetDb'

interface Props {
  asset: AssetRow | null
  thumbnailUrl?: string
}
const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  place: [assetId: string]
}>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const isOpen = computed(() => props.asset !== null)

watch(
  isOpen,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  },
  { flush: 'post' },
)

function closeDialog(): void {
  // Native <dialog> emits its own 'close' DOM event → @close handler emits the Vue event.
  // No need for a fallback: if the dialog isn't open there's nothing to close.
  if (dialogEl.value?.open) dialogEl.value.close()
}

function onBackdropClick(ev: MouseEvent): void {
  if (ev.target === dialogEl.value) closeDialog()
}

function onPlace(): void {
  if (props.asset) emit('place', props.asset.id)
  closeDialog()
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.asset-detail-dialog {
  width: min(400px, 90vw);
  padding: 0;
  background: #0a1018;
  color: #a0b4c8;
  border: 1px solid #182a40;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
}
.asset-detail-dialog::backdrop {
  background: rgba(0, 0, 0, 0.55);
}

.detail-frame {
  display: flex;
  flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #182a40;
}
.detail-title {
  font-size: 12px;
  font-weight: 600;
  color: #c0d4e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.close-btn {
  flex-shrink: 0;
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

/* ── Body ────────────────────────────────────────────────────────────────── */
.detail-body {
  padding: 20px 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.detail-thumb-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 140px;
  height: 140px;
  border-radius: 6px;
  background: #060c14;
  border: 1px solid #182a40;
  overflow: hidden;
}
.detail-thumb {
  width: 140px;
  height: 140px;
  object-fit: contain;
}
.detail-thumb-placeholder {
  font-size: 40px;
  color: #1e3a58;
}

.detail-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 10px;
  font-family: monospace;
  flex-wrap: wrap;
  justify-content: center;
}
.kind-badge {
  background: #18304a;
  color: #5ab0f5;
  padding: 2px 6px;
  border-radius: 3px;
}
.kind-badge[data-kind='character']      { color: #5ab0f5; }
.kind-badge[data-kind='animation-pack'] { color: #ffcc44; }
.kind-badge[data-kind='environment']    { color: #44ff88; }
.kind-badge[data-kind='prop']           { color: #c099ff; }
.size, .clip-count { color: #4a6080; }

.clip-list {
  width: 100%;
  max-height: 130px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid #182a40;
  border-radius: 4px;
  background: #060c14;
}
.clip-name {
  padding: 3px 10px;
  font-size: 10px;
  font-family: monospace;
  color: #6a8aaa;
  border-bottom: 1px solid #0d1e2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clip-name:last-child { border-bottom: 0; }

/* ── Footer ──────────────────────────────────────────────────────────────── */
.detail-footer {
  padding: 12px 20px 16px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #182a40;
}
.place-btn {
  background: #1a4a7a;
  border: 1px solid #2a6aaa;
  color: #90c8f0;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 5px 16px;
  border-radius: 4px;
  cursor: pointer;
}
.place-btn:hover {
  background: #1e5a8e;
  border-color: #5ab0f5;
  color: #c0e0f8;
}
</style>
