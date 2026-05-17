<!--
  SceneEditorAssetsSection — Assets section in the editor hierarchy.

  Drag-drop zone + file-picker fallback + live-bound list of uploaded assets.
  Reads from `useAssetStore` directly (no props, no emits to the host page).
  Mounted by SceneEditorHierarchy above the Scene Settings row.

  Contract: SHARED/packages/ui/docs/ASSET-PIPELINE.md
-->
<template>
  <div class="section assets-section">
    <div class="section-header">
      <span>Assets</span>
      <span class="section-count">{{ assets.length }}</span>
    </div>

    <!-- Drag-drop / picker zone -->
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
        <span>Drop GLB/FBX or click</span>
      </button>
    </div>

    <!-- Uploads in flight -->
    <div v-for="job in uploads" :key="job.id" class="row asset-row uploading">
      <span class="asset-thumb placeholder">⏳</span>
      <div class="asset-info">
        <div class="asset-name">{{ job.name }}</div>
        <div class="asset-meta">Uploading…</div>
      </div>
    </div>

    <!-- Errors -->
    <div v-for="err in errors" :key="err.id" class="row asset-row error">
      <span class="asset-thumb placeholder error-icon">⚠</span>
      <div class="asset-info">
        <div class="asset-name">{{ err.name }}</div>
        <div class="asset-meta error-text">{{ err.message }}</div>
      </div>
      <button class="dismiss-btn" type="button" @click="dismissError(err.id)" title="Dismiss">×</button>
    </div>

    <!-- Assets -->
    <div v-for="asset in assets" :key="asset.id" class="row asset-row">
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
      <button
        class="use-btn"
        type="button"
        :title="`Pick a ${asset.kind} asset`"
        @click="openPicker(asset.kind)"
      >
        Use…
      </button>
    </div>

    <!-- Empty state -->
    <p v-if="assets.length === 0 && uploads.length === 0" class="empty">
      No assets uploaded.
    </p>

    <!-- Ephemeral selection feedback (W3 picker demo) -->
    <p v-if="showStatus" class="status-line" role="status">
      Selected asset: {{ lastSelectedAssetId }}
    </p>

    <AssetPicker
      :open="pickerOpen"
      :kind-filter="pickerKindFilter"
      @close="pickerOpen = false"
      @select="onPickerSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAssetStore, UploadError } from './useAssetStore'
import AssetPicker from './AssetPicker.vue'
import type { AssetKind } from './assetDb'

const store = useAssetStore()
const assets = computed(() => store.assets)

// ── Picker (W3) ────────────────────────────────────────────────────────────
const pickerOpen = ref(false)
const pickerKindFilter = ref<AssetKind | undefined>(undefined)
const lastSelectedAssetId = ref<string | null>(null)
const showStatus = ref(false)
let statusTimer: ReturnType<typeof setTimeout> | null = null

function openPicker(kind: AssetKind): void {
  pickerKindFilter.value = kind
  pickerOpen.value = true
}

function onPickerSelect(assetId: string): void {
  lastSelectedAssetId.value = assetId
  // eslint-disable-next-line no-console
  console.log(`[AssetPicker] Selected asset: ${assetId}`)
  showStatus.value = true
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    showStatus.value = false
  }, 3000)
}

const fileInput = ref<HTMLInputElement | null>(null)
const dragover = ref(false)

interface UploadJob {
  id: string
  name: string
}
interface UploadErrorEntry {
  id: string
  name: string
  message: string
}

const uploads = ref<UploadJob[]>([])
const errors = ref<UploadErrorEntry[]>([])

let jobCounter = 0
let errCounter = 0

async function handleFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files)
  for (const file of list) {
    const jobId = `job-${++jobCounter}`
    uploads.value.push({ id: jobId, name: file.name })
    try {
      await store.upload(file)
    } catch (err) {
      const kind = err instanceof UploadError ? err.kind : 'error'
      const msg = err instanceof Error ? err.message : String(err)
      errors.value.push({
        id: `err-${++errCounter}`,
        name: file.name,
        message: `${kind}: ${msg}`,
      })
    } finally {
      const idx = uploads.value.findIndex((j) => j.id === jobId)
      if (idx >= 0) uploads.value.splice(idx, 1)
    }
  }
}

function onDrop(ev: DragEvent): void {
  dragover.value = false
  if (!ev.dataTransfer?.files) return
  handleFiles(ev.dataTransfer.files)
}

function onFileChange(ev: Event): void {
  const target = ev.target as HTMLInputElement
  if (!target.files) return
  handleFiles(target.files)
  // Reset so the same file can be re-selected if needed.
  target.value = ''
}

function dismissError(id: string): void {
  const idx = errors.value.findIndex((e) => e.id === id)
  if (idx >= 0) errors.value.splice(idx, 1)
}

// ── Thumbnail URL cache (component-scoped) ─────────────────────────────────
// Distinct from the store's blob-URL cache for asset.blob. These are for
// `asset.thumbnail` (PNG preview) — revoked on unmount or when an asset row
// is removed from the live-query list.
const thumbnailUrls = ref<Map<string, string>>(new Map())

watch(
  assets,
  (current) => {
    const currentIds = new Set(current.map((a) => a.id))
    // Revoke URLs for assets that left the list.
    for (const [id, url] of thumbnailUrls.value) {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(url)
        thumbnailUrls.value.delete(id)
      }
    }
    // Create URLs for new arrivals with thumbnails.
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
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.assets-section {
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

/* ── Dropzone ─────────────────────────────────────────────────────────── */
.dropzone {
  margin: 4px 12px 6px;
  border: 1px dashed #1e3a58;
  border-radius: 4px;
  background: rgba(24, 48, 74, 0.18);
  transition: background 0.1s, border-color 0.1s;
}
.dropzone.dragover {
  border-color: #5ab0f5;
  background: rgba(90, 176, 245, 0.12);
}
.dropzone.uploading {
  opacity: 0.7;
}
.file-input {
  display: none;
}
.dropzone-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 6px;
  background: none;
  border: 0;
  color: #6a8aaa;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.dropzone-btn:hover {
  color: #b0c8e0;
}
.dropzone-icon {
  font-size: 12px;
  color: #3a6080;
}

/* ── Asset rows ───────────────────────────────────────────────────────── */
.row.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  user-select: none;
}
.row.asset-row.uploading { opacity: 0.6; }
.row.asset-row.error { background: rgba(220, 80, 80, 0.06); }

.asset-thumb {
  width: 28px;
  height: 28px;
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
  font-size: 12px;
}
.asset-thumb.placeholder.error-icon { color: #d27575; }

.asset-info {
  flex: 1;
  min-width: 0;
}
.asset-name {
  font-size: 10px;
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
  margin-top: 1px;
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
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.use-btn:hover {
  color: #b0c8e0;
  border-color: #5ab0f5;
}

.empty {
  margin: 6px 12px 0;
  font-size: 10px;
  color: #2a3a4a;
  line-height: 1.5;
}

.status-line {
  margin: 4px 12px;
  padding: 4px 6px;
  font-size: 10px;
  font-family: monospace;
  color: #5ab0f5;
  background: rgba(90, 176, 245, 0.08);
  border-left: 2px solid #5ab0f5;
  line-height: 1.3;
  word-break: break-all;
}
</style>
