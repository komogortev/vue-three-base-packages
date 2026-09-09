/**
 * Scene availability — can a saved scene row actually be opened?
 *
 * A `SceneRow` references asset blobs by id. Those ids can go stale: the asset
 * was deleted from the library, or the row was written in a different browser
 * profile (Dexie is per-origin *and* per-profile, so a scene saved in the
 * preview pane is invisible to the author's own Chrome and vice versa).
 *
 * The switcher dropdown must not offer a scene that cannot open, but "cannot
 * open right now" is NOT the same as "worthless": re-uploading the missing GLB
 * makes the row whole again. So this module only *classifies* — it never
 * deletes. Pruning is an explicit, author-confirmed action.
 *
 * Pure and dependency-free so it can be unit-tested without Dexie or Three.
 */

import type { SceneRow } from '../assetDb'

export type SceneAvailabilityStatus =
  /** Every referenced asset resolves — opens exactly as saved. */
  | 'ok'
  /** Some assets resolve, some do not — opens, but with objects missing. */
  | 'partial'
  /** The row references assets and NONE of them resolve — nothing would render. */
  | 'unloadable'

export interface SceneAvailability {
  status: SceneAvailabilityStatus
  /** Distinct asset ids referenced by the row, in first-seen order. */
  referenced: string[]
  /** Subset of `referenced` that could not be resolved. */
  missing: string[]
}

/**
 * Every asset id a row depends on: placed objects, NPC bodies, NPC animation
 * packs, and the ambient audio track.
 *
 * `config` is absent on v1/v2 rows (see {@link SceneRow}), so every read below
 * is defensive — a legacy row yields only its placed-object ids rather than
 * throwing.
 */
export function collectSceneAssetIds(row: SceneRow): string[] {
  const ids: string[] = []
  const push = (id: string | undefined | null): void => {
    if (id && !ids.includes(id)) ids.push(id)
  }

  for (const obj of row.placedObjects ?? []) push(obj?.assetId)

  const cfg = row.config
  for (const npc of cfg?.npcs ?? []) {
    push(npc?.assetId)
    push(npc?.animationPackAssetId)
  }
  push(cfg?.ambientAudioAssetId)

  return ids
}

/**
 * Classify a row against the current asset library.
 *
 * A scene that references no assets at all is `ok`, not `unloadable` — an empty
 * scene is a legitimate starting point, and NPC/zone markers still render from
 * config alone. Treating it as unloadable would hide every freshly-created
 * scene from the switcher.
 *
 * @param hasAsset predicate answering whether an asset id exists in the library
 */
export function classifyScene(
  row: SceneRow,
  hasAsset: (assetId: string) => boolean,
): SceneAvailability {
  const referenced = collectSceneAssetIds(row)
  const missing = referenced.filter(id => !hasAsset(id))

  let status: SceneAvailabilityStatus
  if (missing.length === 0) status = 'ok'
  else if (missing.length < referenced.length) status = 'partial'
  else status = 'unloadable'

  return { status, referenced, missing }
}

/** True when the row is worth offering in the scene switcher. */
export function isSceneLoadable(availability: SceneAvailability): boolean {
  return availability.status !== 'unloadable'
}

export interface ClassifiedScene {
  scene: SceneRow
  availability: SceneAvailability
}

/** A row referencing nothing, or one classified before the library loaded. */
const NOTHING_MISSING: SceneAvailability = { status: 'ok', referenced: [], missing: [] }

/**
 * Classify a whole list, refusing to judge until the asset library is known.
 *
 * `libraryLoaded` is the load-bearing argument. The library arrives
 * asynchronously and its "not yet" value is an **empty array** — identical to a
 * genuinely empty library. Classifying against that seed marks every
 * asset-bearing scene `unloadable`, which hides healthy scenes from the
 * switcher and offers a permanent delete on rows whose blobs are perfectly
 * intact. The window is normally milliseconds but is unbounded whenever the
 * query cannot complete (a Dexie `versionchange` held open by a second editor
 * tab, say), so it is not safe to treat as a render-frame race.
 *
 * The guard lives here rather than in the calling composable so it can be
 * tested without Dexie or Pinia — it is the rule that protects the only
 * irreversible action in this feature.
 */
export function classifyScenes(
  rows: readonly SceneRow[],
  hasAsset: (assetId: string) => boolean,
  libraryLoaded: boolean,
): ClassifiedScene[] {
  if (!libraryLoaded) {
    return rows.map(scene => ({ scene, availability: NOTHING_MISSING }))
  }
  return rows.map(scene => ({ scene, availability: classifyScene(scene, hasAsset) }))
}
