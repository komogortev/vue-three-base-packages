<!--
  AssetLibraryDialog — asset management modal.

  Upload zone, progress, errors, and the full asset library list in one place.
  "Use" on any row emits `asset-picked(assetId)` and closes the dialog.
  Nested AssetDetailDialog handles thumbnail-click detail view.
-->
<template>
  <dialog
    ref="dialogEl"
    class="asset-lib-dialog"
    @close="emit('close')"
    @click="onBackdropClick"
  >
    <div class="lib-frame" @click.stop>

      <!-- Header -->
      <div class="lib-header">
        <span class="lib-title">Asset Library</span>
        <span v-if="assets.length > 0" class="lib-count">{{ assets.length }}</span>
        <button class="close-btn" type="button" title="Close (Esc)" @click="closeDialog">×</button>
      </div>

      <!-- Upload zone -->
      <div
        class="dropzone"
        :class="{ dragover, uploading: uploads.length > 0 }"
        @dragover.prevent="dragover = true"
        @dragleave.prevent="dragover = false"
        @drop.prevent="onDrop"
      >
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".glb,.gltf,.fbx"
          class="file-input"
          @change="onFileChange"
        />
        <button class="dropzone-btn" type="button" @click="fileInput?.click()">
          <span class="dropzone-icon">⬢</span>
          <span>Drop GLB / FBX or click to upload</span>
        </button>
      </div>

      <!-- Uploads in flight -->
      <div v-for="job in uploads" :key="job.id" class="asset-row uploading">
        <span class="asset-thumb placeholder">⏳</span>
        <div class="asset-info">
          <div class="asset-name">{{ job.name }}</div>
          <div class="asset-meta">Uploading…</div>
        </div>
      </div>

      <!-- Errors -->
      <div v-for="err in errors" :key="err.id" class="asset-row error">
        <span class="asset-thumb placeholder error-icon">⚠</span>
        <div class="asset-info">
          <div class="asset-name">{{ err.name }}</div>
          <div class="asset-meta error-text">{{ err.message }}</div>
        </div>
        <button class="dismiss-btn" type="button" title="Dismiss" @click="dismissError(err.id)">×</button>
      </div>

      <!-- Asset list -->
      <div class="asset-list">
        <div v-for="asset in assets" :key="asset.id" class="asset-row">
          <div
            class="asset-detail-trigger"
            title="Click for details"
            @click="openDetail(asset)"
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
          <button class="use-btn" type="button" title="Place in scene" @click="onUse(asset.id)">
            Use
          </button>
        </div>

        <p v-if="assets.length === 0 && uploads.length === 0" class="empty">
          No assets uploaded yet. Drop a GLB or FBX above.
        </p>
      </div>

    </div>

    <!-- Asset detail sub-dialog (shown on thumbnail click) -->
    <AssetDetailDialog
      :asset="detailAsset"
      :thumbnail-url="detailAsset ? thumbnailUrls.get(detailAsset.id) : undefined"
      @close="detailAsset = null"
      @place="onDetailPlace"
    />
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useAssetStore, UploadError } from './useAssetStore'
import AssetDetailDialog from './AssetDetailDialog.vue'
import type { AssetRow } from './assetDb'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  close: []
  'asset-picked': [assetId: string]
}>()

// ── Dialog open/close ────────────────────────────────────────────────────────

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  },
  { flush: 'post' },
)

function closeDialog(): void {
  if (dialogEl.value?.open) dialogEl.value.close()
}

function onBackdropClick(ev: MouseEvent): void {
  if (ev.target === dialogEl.value) closeDialog()
}

// ── Asset store ──────────────────────────────────────────────────────────────

const store = useAssetStore()
const assets = computed(() => store.assets)

// ── Detail sub-dialog ────────────────────────────────────────────────────────

const detailAsset = ref<AssetRow | null>(null)

function openDetail(asset: AssetRow): void {
  detailAsset.value = asset
}

function onDetailPlace(assetId: string): void {
  emit('asset-picked', assetId)
  closeDialog()
}

// ── Use button ───────────────────────────────────────────────────────────────

function onUse(assetId: string): void {
  emit('asset-picked', assetId)
  closeDialog()
}

// ── Upload ───────────────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null)
const dragover = ref(false)

interface UploadJob { id: string; name: string }
interface UploadErrorEntry { id: string; name: string; message: string }

const uploads = ref<UploadJob[]>([])
const errors = ref<UploadErrorEntry[]>([])

let jobCounter = 0
let errCounter = 0

async function handleFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const jobId = `job-${++jobCounter}`
    uploads.value.push({ id: jobId, name: file.name })
    try {
      await store.upload(file)
    } catch (err) {
      const kind = err instanceof UploadError ? err.kind : 'error'
      const msg = err instanceof Error ? err.message : String(err)
      errors.value.push({ id: `err-${++errCounter}`, name: file.name, message: `${kind}: ${msg}` })
    } finally {
      const idx = uploads.value.findIndex(j => j.id === jobId)
      if (idx >= 0) uploads.value.splice(idx, 1)
    }
  }
}

function onDrop(ev: DragEvent): void {
  dragover.value = false
  if (ev.dataTransfer?.files) handleFiles(ev.dataTransfer.files)
}

function onFileChange(ev: Event): void {
  const target = ev.target as HTMLInputElement
  if (target.files) handleFiles(target.files)
  target.value = ''
}

function dismissError(id: string): void {
  const idx = errors.value.findIndex(e => e.id === id)
  if (idx >= 0) errors.value.splice(idx, 1)
}

// ── Thumbnail URL cache ───────────────────────────────────────────────────────

const thumbnailUrls = shallowRef<Map<string, string>>(new Map())

watch(
  assets,
  (current) => {
    const next = new Map(thumbnailUrls.value)
    const currentIds = new Set(current.map(a => a.id))
    for (const [id, url] of next) {
      if (!currentIds.has(id)) { URL.revokeObjectURL(url); next.delete(id) }
    }
    for (const a of current) {
      if (a.thumbnail && !next.has(a.id)) next.set(a.id, URL.createObjectURL(a.thumbnail))
    }
    thumbnailUrls.value = next
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of thumbnailUrls.value.values()) URL.revokeObjectURL(url)
  thumbnailUrls.value.clear()
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.asset-lib-dialog {
  width: min(560px, 92vw);
  max-height: min(640px, 88vh);
  padding: 0;
  background: #0a1018;
  color: #a0b4c8;
  border: 1px solid #182a40;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
}
.asset-lib-dialog::backdrop {
  background: rgba(0, 0, 0, 0.55);
}

/* ── Frame ────────────────────────────────────────────────────────────────── */
.lib-frame {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.lib-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #182a40;
  flex-shrink: 0;
}
.lib-title {
  font-size: 12px;
  font-weight: 600;
  color: #c0d4e8;
  flex: 1;
}
.lib-count {
  background: #18304a;
  color: #3a6080;
  font-family: monospace;
  font-size: 9px;
  padding: 0 5px;
  border-radius: 8px;
}
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

/* ── Dropzone ────────────────────────────────────────────────────────────── */
.dropzone {
  margin: 10px 14px 6px;
  border: 1px dashed #1e3a58;
  border-radius: 4px;
  background: rgba(24, 48, 74, 0.18);
  flex-shrink: 0;
  transition: background 0.1s, border-color 0.1s;
}
.dropzone.dragover {
  border-color: #5ab0f5;
  background: rgba(90, 176, 245, 0.12);
}
.dropzone.uploading { opacity: 0.7; }
.file-input { display: none; }
.dropzone-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 6px;
  background: none;
  border: 0;
  color: #6a8aaa;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.dropzone-btn:hover { color: #b0c8e0; }
.dropzone-icon { font-size: 14px; color: #3a6080; }

/* ── Asset list (scrollable) ─────────────────────────────────────────────── */
.asset-list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-bottom: 6px;
}

/* ── Rows ────────────────────────────────────────────────────────────────── */
.asset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
}
.asset-row.uploading { opacity: 0.6; }
.asset-row.error { background: rgba(220, 80, 80, 0.06); }

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
.asset-thumb.placeholder.error-icon { color: #d27575; }

.asset-detail-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  border-radius: 3px;
  padding: 2px 4px;
  margin: -2px -4px;
}
.asset-detail-trigger:hover { background: rgba(90, 176, 245, 0.07); }

.asset-info { flex: 1; min-width: 0; }
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
.kind-badge[data-kind='character']      { color: #5ab0f5; }
.kind-badge[data-kind='animation-pack'] { color: #ffcc44; }
.kind-badge[data-kind='environment']    { color: #44ff88; }
.kind-badge[data-kind='prop']           { color: #c099ff; }
.kind-badge[data-kind='audio']          { color: #ff9944; }
.size, .clip-count { color: #4a6080; }
.error-text { color: #d27575; font-family: inherit; }

.dismiss-btn {
  background: none;
  border: 0;
  color: #4a6080;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.dismiss-btn:hover { color: #d27575; }

.use-btn {
  flex-shrink: 0;
  background: #18304a;
  border: 1px solid #1e3a58;
  color: #6a8aaa;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.use-btn:hover {
  color: #b0c8e0;
  border-color: #5ab0f5;
}

.empty {
  padding: 20px 14px;
  font-size: 11px;
  color: #2a3a4a;
  text-align: center;
  line-height: 1.6;
}
</style>
