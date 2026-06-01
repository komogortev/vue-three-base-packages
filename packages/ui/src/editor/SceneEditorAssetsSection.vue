<!--
  SceneEditorAssetsSection — compact assets entry point in the hierarchy panel.

  Shows a count badge and a single "Add Assets" button that opens AssetLibraryDialog,
  which owns uploading, the full asset list, and the "Use" flow.
-->
<template>
  <div class="assets-section">
    <div class="section-header">
      <span>Assets</span>
      <span v-if="assetCount > 0" class="section-count">{{ assetCount }}</span>
    </div>

    <div class="section-body">
      <button class="add-btn" type="button" @click="dialogOpen = true">
        + Add Assets
      </button>
    </div>

    <AssetLibraryDialog
      :open="dialogOpen"
      @close="dialogOpen = false"
      @asset-picked="(id) => emit('asset-picked', id)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAssetStore } from './useAssetStore'
import AssetLibraryDialog from './AssetLibraryDialog.vue'

const emit = defineEmits<{
  'asset-picked': [assetId: string]
}>()

const store = useAssetStore()
const assetCount = computed(() => store.assets.length)
const dialogOpen = ref(false)
</script>

<style scoped>
.assets-section {
  border-top: 1px solid #182a40;
  padding: 4px 0 6px;
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

.section-body {
  padding: 2px 12px 0;
}

.add-btn {
  width: 100%;
  padding: 6px 8px;
  background: #0d1e30;
  border: 1px dashed #1e3a58;
  border-radius: 4px;
  color: #6a8aaa;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  text-align: center;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
}
.add-btn:hover {
  color: #b0c8e0;
  border-color: #3a6aaa;
  background: rgba(24, 48, 74, 0.35);
}
</style>
