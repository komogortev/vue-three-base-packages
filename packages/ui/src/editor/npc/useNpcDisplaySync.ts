import { computed, toRaw, watch, type Ref } from 'vue'
import type { EditorNpcEntry } from '../sceneEditorTypes'
import type { NpcDisplayEntry } from './npcDisplayRegistry'

/** The slice of the asset store the sync reads. */
export interface NpcAssetResolver {
  /** Reactive list — read so the sync re-runs when the library changes. */
  readonly assets: readonly unknown[]
  resolveBlobUrl(assetId: string): string | null
}

/**
 * Keep the viewport's NPC models in step with the editor's NPC list (E5).
 *
 * Declarative: builds the wanted list from `npcs` + resolvable asset URLs and hands it
 * to `apply` on every change. The viewport diffs it, so setting an asset, adding or
 * removing an NPC, loading a scene and the library finishing its async load are one
 * path. An NPC whose asset is not (yet) resolvable is simply absent from the list.
 */
export function useNpcDisplaySync(
  npcs: Ref<EditorNpcEntry[]>,
  assets: NpcAssetResolver,
  apply: (entries: NpcDisplayEntry[]) => Promise<void>,
): void {
  const entries = computed<NpcDisplayEntry[]>(() => {
    // resolveBlobUrl caches per id, so reading `assets` is what re-triggers this.
    void assets.assets
    return npcs.value.flatMap(n => {
      if (!n.assetId) return []
      const assetUrl = assets.resolveBlobUrl(n.assetId)
      if (!assetUrl) return []
      return [{
        entityId: n.entityId,
        assetUrl,
        x: n.x,
        z: n.z,
        y: n.y,
        rotationY: n.rotationY,
        scale: n.scale,
        poseOverride: toRaw(n.poseOverride),
      }]
    })
  })
  watch(entries, list => { void apply(list) }, { immediate: true })
}
