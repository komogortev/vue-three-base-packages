/**
 * NPC placement rule — where an authored NPC's model goes, and how big.
 *
 * One rule shared by the editor's display mesh and the room player, so the two
 * cannot disagree about a model (E5, plan Q-E5-1). Before this the editor fit
 * and grounded the model while the player did neither: a centimetre export was
 * normal-sized in the editor and 180 m tall in the player.
 *
 * Pure — no THREE, Vue or Dexie. The caller measures the loaded model's height
 * (in bind pose, at scale 1) and applies the returned transform.
 *
 * Deliberately NOT here: grounding the bounding box to y=0. `EditorNpcEntry.y`
 * is an authored field, and snapping to the floor would silently override it.
 */

import { fitScaleFor } from './characterFit'

/** The slice of `EditorNpcEntry` that placement reads. */
export interface NpcPlacementEntry {
  x: number
  z: number
  /** Authored world Y. Absent → 0. */
  y?: number
  /** Degrees, as authored. */
  rotationY?: number
  /** Uniform scale; absent or non-positive → 1. */
  scale?: number
}

export interface NpcTransform {
  /** Fit-rescue multiplier (1 when the model is already a sane size). */
  baseScale: number
  /** `baseScale × entry scale` — what to set on the model root. */
  scale: number
  position: { x: number; y: number; z: number }
  /** Radians. */
  rotationY: number
}

/**
 * The uniform scale an entry asks for. Absent, non-finite, zero or negative all
 * mean "unscaled": a scale of 0 would make the NPC vanish with no way to see
 * why, and a negative one mirrors the model.
 */
export function entryScale(scale: number | undefined): number {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** Fit-rescue multiplier for a measured model height (see `fitScaleFor`). */
export function baseScaleFor(measuredHeight: number): number {
  return fitScaleFor(measuredHeight) ?? 1
}

/** Model-root scale for an already-known base scale — used when only the entry's scale changed. */
export function totalScale(baseScale: number, entryScaleValue: number | undefined): number {
  return baseScale * entryScale(entryScaleValue)
}

/**
 * Transform for an NPC's model root once its fit-rescue `baseScale` is known.
 * The one place position / rotation / scale are derived from an entry: the
 * display registry (which keeps `baseScale` from load time) and `npcTransform`
 * both go through it, so they cannot drift.
 */
export function placementFor(baseScale: number, entry: NpcPlacementEntry): NpcTransform {
  return {
    baseScale,
    scale: totalScale(baseScale, entry.scale),
    position: { x: entry.x, y: entry.y ?? 0, z: entry.z },
    rotationY: ((entry.rotationY ?? 0) * Math.PI) / 180,
  }
}

/** Full transform for an NPC's model root, measuring fit-rescue from the model's height. */
export function npcTransform(measuredHeight: number, entry: NpcPlacementEntry): NpcTransform {
  return placementFor(baseScaleFor(measuredHeight), entry)
}
