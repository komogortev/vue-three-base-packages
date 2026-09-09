/**
 * Saved-scene list + availability, shared by the switcher dropdown and the
 * Saved-scenes panel.
 *
 * Exists as one composable rather than two copies because both consumers need
 * the *same* answer to "can this row be opened", and one of them puts a
 * permanent delete behind it. Two independent Dexie subscriptions over the same
 * table could disagree mid-flight, and the guard below would then have to be
 * written — and kept correct — twice.
 *
 * **The load guard is the point.** Asset rows arrive asynchronously and
 * `useLiveQuery` seeds with `[]`, which is indistinguishable from a genuinely
 * empty library. Classifying against that seed marks every asset-bearing scene
 * `unloadable` — hiding healthy scenes from the switcher and, worse, offering
 * Remove on rows whose blobs are perfectly intact. So nothing is classified as
 * missing until both queries have actually emitted.
 */

import { computed, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { assetDb, type SceneRow } from '../assetDb'
import { useLiveQueryHandle } from '../useLiveQuery'
import { useAssetStore } from '../useAssetStore'
import { classifyScenes, isSceneLoadable, type ClassifiedScene } from './sceneAvailability'

export interface SavedScenesReturn {
  /** Every saved row, most-recently-saved first. */
  rows: ShallowRef<SceneRow[]>
  /** Each row with its availability. While `loaded` is false every entry is `ok`. */
  classified: ComputedRef<ClassifiedScene[]>
  /** Rows worth offering in the switcher. Unfiltered until `loaded`. */
  loadable: ComputedRef<SceneRow[]>
  /** True once BOTH the scene list and the asset library have emitted. */
  loaded: Ref<boolean>
}

export function useSavedScenes(): SavedScenesReturn {
  const store = useAssetStore()
  const { data: rows, loaded: scenesLoaded } = useLiveQueryHandle<SceneRow[]>(
    () => assetDb.scenes.orderBy('savedAt').reverse().toArray(),
    [],
  )

  const loaded = computed(() => scenesLoaded.value && store.assetsLoaded)

  const classified = computed<ClassifiedScene[]>(() => {
    // Set lookup rather than a linear scan per referenced id: this recomputes
    // on every asset upload and every scene save. `classifyScenes` owns the
    // not-yet-loaded guard.
    const ids = new Set(store.assets.map(a => a.id))
    return classifyScenes(rows.value, id => ids.has(id), loaded.value)
  })

  const loadable = computed<SceneRow[]>(() =>
    classified.value.filter(e => isSceneLoadable(e.availability)).map(e => e.scene),
  )

  return { rows, classified, loadable, loaded }
}
