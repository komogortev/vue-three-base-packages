import { liveQuery, type Subscription } from 'dexie'
import { onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from 'vue'

/**
 * Vue composable wrapping Dexie `liveQuery` — reactive shallow ref that
 * auto-updates when any Dexie tables touched inside `query` mutate.
 *
 * Why `shallowRef` (not `ref`): asset rows carry `Blob` fields. A regular
 * `ref` would Proxy-wrap each row, and passing such a row back to IndexedDB
 * (e.g. for an update) would throw `DataCloneError` — the same hazard hit by
 * `apps/personal-planner` on 2026-04-27. shallowRef makes the array reference
 * reactive without proxying inner rows, so blobs survive structured-clone.
 *
 * Mirror of `apps/personal-planner/src/composables/useLiveQuery.ts`.
 *
 * Example:
 *   const assets = useLiveQuery(() => assetDb.assets.toArray(), [])
 */
export function useLiveQuery<T>(
  query: () => T | Promise<T>,
  initial: T,
): ShallowRef<T> {
  return useLiveQueryHandle(query, initial).data
}

export interface LiveQueryHandle<T> {
  data: ShallowRef<T>
  /**
   * False until the first Dexie emission arrives.
   *
   * **The seed value is indistinguishable from a real result**, so any caller
   * that draws a conclusion from *absence* — "no assets, therefore this scene
   * is broken" — must gate on this flag, or it will act on the empty seed.
   * The window is normally milliseconds but is unbounded when Dexie blocks
   * (e.g. a `versionchange` held open by a second tab), so it is not safe to
   * treat as a render-frame race.
   */
  loaded: Ref<boolean>
}

/**
 * {@link useLiveQuery} plus an explicit "has the first result arrived" flag.
 *
 * Use this whenever an empty result would drive a destructive or hiding
 * decision; use the plain `useLiveQuery` when rendering the rows is all you do.
 */
export function useLiveQueryHandle<T>(
  query: () => T | Promise<T>,
  initial: T,
): LiveQueryHandle<T> {
  const state = shallowRef(initial) as ShallowRef<T>
  const loaded = ref(false)
  const sub: Subscription = liveQuery(query).subscribe({
    next: (value) => {
      state.value = value
      loaded.value = true
    },
    error: (err) => {
      // eslint-disable-next-line no-console
      console.error('[useLiveQuery] error:', err)
    },
  })
  onScopeDispose(() => sub.unsubscribe())
  return { data: state, loaded }
}
