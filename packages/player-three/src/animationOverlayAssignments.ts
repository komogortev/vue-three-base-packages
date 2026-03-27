import * as THREE from 'three'
import { pickClipByPatterns } from './locomotionClipAssignments'

/**
 * Semantic overlay slots (air, hazards, recovery, landing) — see
 * `docs/threejs-engine-dev/player-state-transition-animation-map.md`.
 */
export type AnimationOverlaySlot =
  | 'air.jump.rise'
  | 'air.jump.fall'
  | 'air.jump.second'
  | 'air.jump.land.soft'
  | 'air.jump.land.medium'
  | 'air.jump.land.hard'
  | 'hazard.pit.edge_catch'
  | 'hazard.wall.stumble'
  | 'air.fail.high_ledge'
  | 'recovery.failed_jump.exit'

export type LandImpactTier = 'none' | 'soft' | 'medium' | 'hard'

/** Below this fall distance (m) and air time, skip a dedicated land one-shot (tiny hops). */
export const LAND_IMPACT_SKIP_FALL_M = 0.38
export const LAND_IMPACT_SKIP_AIR_S = 0.14
/** Tier soft: `air.jump.land.soft` */
export const LAND_IMPACT_SOFT_MAX_FALL_M = 1.45
/** Tier medium: `air.jump.land.medium` */
export const LAND_IMPACT_MEDIUM_MAX_FALL_M = 3.65

/**
 * Choose landing overlay tier from controller `landed` metrics (`PlayerController` event).
 */
export function computeLandImpactTier(
  fallDistanceMeters: number | undefined,
  airTimeSeconds: number | undefined,
): LandImpactTier {
  const fd = Math.max(0, fallDistanceMeters ?? 0)
  const at = Math.max(0, airTimeSeconds ?? 0)
  if (fd < LAND_IMPACT_SKIP_FALL_M && at < LAND_IMPACT_SKIP_AIR_S) return 'none'
  if (fd < LAND_IMPACT_SOFT_MAX_FALL_M) return 'soft'
  if (fd < LAND_IMPACT_MEDIUM_MAX_FALL_M) return 'medium'
  return 'hard'
}

export type CharacterOverlayClipSet = {
  jumpRise: THREE.AnimationClip | undefined
  jumpSecond: THREE.AnimationClip | undefined
  jumpFall: THREE.AnimationClip | undefined
  landSoft: THREE.AnimationClip | undefined
  landMedium: THREE.AnimationClip | undefined
  landHeavy: THREE.AnimationClip | undefined
  edgeCatch: THREE.AnimationClip | undefined
  wallStumble: THREE.AnimationClip | undefined
  failJump: THREE.AnimationClip | undefined
  recoverFromFail: THREE.AnimationClip | undefined
}

/**
 * Resolve overlay clips from loaded FBX/GLTF animation names (Mixamo + scenario renames).
 */
export function resolveCharacterOverlayClips(
  clips: readonly THREE.AnimationClip[],
): CharacterOverlayClipSet {
  const jumpRise =
    pickClipByPatterns(clips, [/^jumping up$/i, /^jumping$/i, /^jumping \(\d+\)$/i])
  const jumpSecond =
    pickClipByPatterns(clips, [/double jump|second jump/i]) ?? jumpRise
  const jumpFall =
    pickClipByPatterns(clips, [/jumping down/i]) ??
    pickClipByPatterns(clips, [/falling idle/i]) ??
    pickClipByPatterns(clips, [/\bfall/i])

  const landSoft = pickClipByPatterns(clips, [/falling to landing/i])
  const landMedium =
    pickClipByPatterns(clips, [/hard landing/i]) ?? landSoft
  const landHeavy =
    pickClipByPatterns(clips, [/falling heavy/i]) ??
    pickClipByPatterns(clips, [/falling flat impact/i]) ??
    landMedium

  const reactionFallback = pickClipByPatterns(clips, [/\breaction\b/i])
  const edgeCatch =
    pickClipByPatterns(clips, [/edge slip/i]) ??
    pickClipByPatterns(clips, [/teeter heavy/i]) ??
    pickClipByPatterns(clips, [/^teeter$/i]) ??
    reactionFallback

  const wallStumble =
    pickClipByPatterns(clips, [/stumble backwards/i]) ?? reactionFallback

  const failJump =
    pickClipByPatterns(clips, [/falling back death|falling back/i]) ??
    pickClipByPatterns(clips, [/falling from losing balance|losing balance/i]) ??
    pickClipByPatterns(clips, [/falling to roll|falling flat impact/i]) ??
    reactionFallback

  const recoverFromFail =
    pickClipByPatterns(clips, [/zombie stand up|stand up/i]) ??
    pickClipByPatterns(clips, [/hard landing|falling to landing/i]) ??
    reactionFallback

  return {
    jumpRise,
    jumpSecond,
    jumpFall,
    landSoft,
    landMedium,
    landHeavy,
    edgeCatch,
    wallStumble,
    failJump,
    recoverFromFail,
  }
}
