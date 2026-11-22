/**
 * Scene reader — gathers the live values `describeScene` / `listAssets` serialize (PP-2).
 *
 * Stateless glue on the L2 side of the decomposition: it holds nothing, imports no
 * THREE, and reads only through the interfaces the owning modules already expose —
 * the placed registry's `snapshot()` (records with live transforms) and
 * `visibleWorldBounds()` (world AABB after a world-matrix update, hit box excluded),
 * the host's NPC and zone lists, and the asset library. No second copy of the
 * scene is kept anywhere: every call reads the current state.
 *
 * It is kept out of `useSceneEditorViewport` (over its structural budget) and depends
 * on L1 modules by type only, so it adds no L1 → L1 edge. The editor host wires it
 * when the prompt panel (PP-5) is the first caller.
 */
import type { Aabb } from '../gate/verdict'
import type { AssetKind } from '../assetDb'
import type { EditorNpcEntry, EditorZoneEntry } from '../sceneEditorTypes'
import type { PlacedRegistry } from '../placement/placedRegistry'
import type { AssetBoundsCache, MeasurableAsset } from './assetBoundsCache'
import {
  describeScene, listAssets,
  type AssetCatalog, type CatalogAssetInput, type SceneDescription,
} from './sceneDescription'

export interface SceneSources {
  placed: Pick<PlacedRegistry, 'snapshot' | 'visibleWorldBounds'>
  npcs?: readonly EditorNpcEntry[]
  /** World bounds of an NPC's display model (null when none is loaded). */
  npcWorldBounds?: (entityId: string) => Aabb | null
  zones?: readonly EditorZoneEntry[]
  spawn?: { x: number; z: number } | null
  assetKind: (assetId: string) => AssetKind | undefined
}

/** Describe the scene as it is now. */
export function readSceneDescription(s: SceneSources): SceneDescription {
  return describeScene({
    placed: s.placed.snapshot().map(record => ({ record, worldBounds: s.placed.visibleWorldBounds(record.id) })),
    npcs: (s.npcs ?? []).map(entry => ({ entry, worldBounds: s.npcWorldBounds?.(entry.entityId) ?? null })),
    zones: s.zones,
    spawn: s.spawn,
    assetKind: s.assetKind,
  })
}

/** Measure what is not measured yet, then list the library. */
export async function describeAssets(
  assets: readonly (CatalogAssetInput & MeasurableAsset)[],
  cache: AssetBoundsCache,
): Promise<AssetCatalog> {
  await cache.measureAll(assets)
  return listAssets(assets, id => cache.get(id))
}
