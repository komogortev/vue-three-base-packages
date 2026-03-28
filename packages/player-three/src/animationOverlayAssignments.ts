import * as THREE from 'three'
import { pickClipByPatterns } from './locomotionClipAssignments'

/**
 * Semantic overlay slots (air, hazards, recovery, landing, water) — see
 * `docs/threejs-engine-dev/player-state-transition-animation-map.md`.
 */
export type AnimationOverlaySlot =
  | 'air.jump.rise'
  | 'air.jump.fall'
  | 'air.jump.second'
  | 'air.jump.land.soft'
  | 'air.jump.land.medium'
  | 'air.jump.land.hard'
  | 'air.jump.land.critical'
  | 'air.jump.land.fatal'
  | 'hazard.pit.edge_catch'
  | 'hazard.wall.stumble'
  | 'air.fail.high_ledge'
  | 'recovery.failed_jump.exit'
  | 'water.tread'
  | 'water.swim.forward'
  | 'water.entry.fall'

export type LandImpactTier = 'none' | 'soft' | 'medium' | 'hard' | 'critical' | 'fatal'

/** Below this fall distance (m) and air time, skip a dedicated land one-shot (tiny hops). */
export const LAND_IMPACT_SKIP_FALL_M = 0.38
export const LAND_IMPACT_SKIP_AIR_S = 0.14
/** Tier soft: `air.jump.land.soft` — up to ~1.5 m */
export const LAND_IMPACT_SOFT_MAX_FALL_M = 1.45
/** Tier medium: `air.jump.land.medium` — up to ~3.65 m */
export const LAND_IMPACT_MEDIUM_MAX_FALL_M = 3.65
/** Tier hard: `air.jump.land.hard` — up to 8 m */
export const LAND_IMPACT_HARD_MAX_FALL_M = 8.0
/** Tier critical: `air.jump.land.critical` — up to 20 m */
export const LAND_IMPACT_CRITICAL_MAX_FALL_M = 20.0
/** Above 20 m → `fatal` */

/**
 * Choose landing overlay tier from controller `landed` metrics (`PlayerController` event).
 *
 * Tier boundaries (fall distance in metres):
 *  none     < 0.38 m + < 0.14 s air
 *  soft     0.38 m – 1.45 m
 *  medium   1.45 m – 3.65 m
 *  hard     3.65 m – 8.0 m
 *  critical 8.0 m – 20.0 m
 *  fatal    > 20.0 m
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
  if (fd < LAND_IMPACT_HARD_MAX_FALL_M) return 'hard'
  if (fd < LAND_IMPACT_CRITICAL_MAX_FALL_M) return 'critical'
  return 'fatal'
}

export type CharacterOverlayClipSet = {
  jumpRise: THREE.AnimationClip | undefined
  jumpSecond: THREE.AnimationClip | undefined
  jumpFall: THREE.AnimationClip | undefined
  landSoft: THREE.AnimationClip | undefined
  landMedium: THREE.AnimationClip | undefined
  landHeavy: THREE.AnimationClip | undefined
  /** Available when `air__land__critical.fbx` is supplied. Falls back to `landHeavy`. */
  landCritical: THREE.AnimationClip | undefined
  /** Available when `air__land__fatal.fbx` is supplied. Falls back to `landCritical`. */
  landFatal: THREE.AnimationClip | undefined
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

  // "Landing soft.fbx" → Mixamo internal clip name is usually the page title.
  // Common Mixamo names: "Landing", "Soft Landing", "Landing soft", "Falling To Landing".
  const landSoft =
    pickClipByPatterns(clips, [
      /^landing$/i, /^landing soft$/i, /^soft landing$/i,
      /falling to landing/i, /\bland\b/i,
    ])
  // "Hard Landing medium.fbx" → "Hard Landing Medium", "Hard Landing", "Medium Landing".
  const landMedium =
    pickClipByPatterns(clips, [
      /hard landing medium/i, /medium landing/i,
      /^hard landing$/i,
    ]) ?? landSoft
  // "Falling To Roll hard.fbx" → "Falling To Roll", "Falling To Roll Hard", "Roll Landing".
  const landHeavy =
    pickClipByPatterns(clips, [
      /falling to roll hard/i, /falling to roll/i, /roll.*landing|landing.*roll/i,
    ]) ??
    pickClipByPatterns(clips, [/falling heavy/i]) ??
    pickClipByPatterns(clips, [/falling flat impact(?! fatal)/i]) ??
    landMedium

  // "falling critical.fbx" → Mixamo name may be "Falling Critical", "Falling",
  // "Big Fall", etc.  Patterns ordered most-specific → least-specific.
  const landCritical =
    pickClipByPatterns(clips, [
      /falling.*critical/i, /critical.*fall/i, /land.*critical/i,
      /\bbig.?fall\b/i,
    ]) ??
    landHeavy
  // "Falling Flat Impact Fatal.fbx" → "Falling Flat Impact Fatal".
  const landFatal =
    pickClipByPatterns(clips, [
      /falling flat impact fatal/i, /falling.*fatal/i, /fatal.*impact/i,
    ]) ??
    landCritical

  const edgeCatch =
    pickClipByPatterns(clips, [/edge slip/i]) ??
    pickClipByPatterns(clips, [/teeter heavy/i]) ??
    pickClipByPatterns(clips, [/^teeter$/i])

  const wallStumble = pickClipByPatterns(clips, [/stumble backwards/i])

  // Straight-leg backward landing — mild stumble-back with no hip X-rotation.
  // Matched from recovery__fail_jump.fbx (Mixamo "Straight Landing" internal clip name).
  const failJump =
    pickClipByPatterns(clips, [/straight landing/i, /recovery.*fail.*jump|fail.*jump.*recovery/i])

  const recoverFromFail = pickClipByPatterns(clips, [/zombie stand up|stand up/i])

  return {
    jumpRise,
    jumpSecond,
    jumpFall,
    landSoft,
    landMedium,
    landHeavy,
    landCritical,
    landFatal,
    edgeCatch,
    wallStumble,
    failJump,
    recoverFromFail,
  }
}

export type CharacterWaterClipSet = {
  /** Floating upright with no horizontal movement. */
  tread: THREE.AnimationClip | undefined
  /** Forward swimming stroke loop. */
  swimForward: THREE.AnimationClip | undefined
  /** One-shot entry from above (fall into water). Optional. */
  entryFall: THREE.AnimationClip | undefined
}

/**
 * Resolve water-state animation clips from loaded FBX clip names.
 * Matched from `fbx/water/` assets following the `water__*__*.fbx` naming convention.
 */
export function resolveWaterClips(clips: readonly THREE.AnimationClip[]): CharacterWaterClipSet {
  const tread =
    pickClipByPatterns(clips, [/water.*tread|tread.*idle/i, /\bfloating\b/i])
  const swimForward =
    pickClipByPatterns(clips, [
      /water.*swim.*forward|swim.*forward/i,
      /^swimming$/i,
      /\bswimming\b/i,  // Mixamo "Swimming" or "Swimming Forward" variants
      /\bswim\b/i,      // last-resort broad match
    ])
  const entryFall =
    pickClipByPatterns(clips, [/water.*entry.*fall|falling.*pool|fall.*pool/i])
  return { tread, swimForward, entryFall }
}
