import { liveQuery, type Subscription } from 'dexie'
import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'

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
  const state = shallowRef(initial) as ShallowRef<T>
  const sub: Subscription = liveQuery(query).subscribe({
    next: (value) => {
      state.value = value
    },
    error: (err) => {
      // eslint-disable-next-line no-console
      console.error('[useLiveQuery] error:', err)
    },
  })
  onScopeDispose(() => sub.unsubscribe())
  return state
}
