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

/**
 * Ordered pattern groups per semantic slot: try each group with {@link pickClipByPatterns}
 * (OR within a group), then the next group (fallback chain). This is the single source of
 * truth for overlay clip resolution; {@link resolveCharacterOverlayClips} adds cross-slot
 * fallbacks (e.g. second jump → rise clip).
 */
export const OVERLAY_SLOT_PATTERN_GROUPS: { readonly [K in AnimationOverlaySlot]: readonly (readonly RegExp[])[] } = {
  'air.jump.rise': [[/^jumping up$/i, /^jumping$/i, /^jumping \(\d+\)$/i]],
  'air.jump.second': [[/double jump|second jump/i]],
  'air.jump.fall': [[/jumping down/i], [/falling idle/i], [/\bfall/i]],
  'air.jump.land.soft': [
    [/^landing$/i, /^landing soft$/i, /^soft landing$/i, /falling to landing/i, /\bland\b/i],
  ],
  'air.jump.land.medium': [[/hard landing medium/i, /medium landing/i, /^hard landing$/i]],
  'air.jump.land.hard': [
    [/falling to roll hard/i, /falling to roll/i, /roll.*landing|landing.*roll/i],
    [/falling heavy/i],
    [/falling flat impact(?! fatal)/i],
  ],
  'air.jump.land.critical': [[/falling.*critical/i, /critical.*fall/i, /land.*critical/i, /\bbig.?fall\b/i]],
  'air.jump.land.fatal': [[/falling flat impact fatal/i, /falling.*fatal/i, /fatal.*impact/i]],
  'hazard.pit.edge_catch': [[/edge slip/i], [/teeter heavy/i], [/^teeter$/i]],
  'hazard.wall.stumble': [[/stumble backwards/i]],
  'air.fail.high_ledge': [[/straight landing/i, /recovery.*fail.*jump|fail.*jump.*recovery/i]],
  'recovery.failed_jump.exit': [[/zombie stand up|stand up/i]],
  'water.tread': [[/water.*tread|tread.*idle/i, /\bfloating\b/i]],
  'water.swim.forward': [
    [/water.*swim.*forward|swim.*forward/i],
    [/^swimming$/i],
    [/\bswimming\b/i],
    [/\bswim\b/i],
  ],
  'water.entry.fall': [[/water.*entry.*fall|falling.*pool|fall.*pool/i]],
}

/**
 * Resolve one overlay clip by semantic slot using {@link OVERLAY_SLOT_PATTERN_GROUPS}.
 */
export function resolveClipForOverlaySlot(
  clips: readonly THREE.AnimationClip[],
  slot: AnimationOverlaySlot,
): THREE.AnimationClip | undefined {
  const groups = OVERLAY_SLOT_PATTERN_GROUPS[slot]
  for (const patterns of groups) {
    const c = pickClipByPatterns(clips, patterns)
    if (c) return c
  }
  return undefined
}

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
 * Hazard / air / recovery slots use {@link OVERLAY_SLOT_PATTERN_GROUPS} via
 * {@link resolveClipForOverlaySlot}; cross-slot fallbacks stay here.
 */
export function resolveCharacterOverlayClips(
  clips: readonly THREE.AnimationClip[],
): CharacterOverlayClipSet {
  const jumpRise = resolveClipForOverlaySlot(clips, 'air.jump.rise')
  const jumpSecond = resolveClipForOverlaySlot(clips, 'air.jump.second') ?? jumpRise
  const jumpFall = resolveClipForOverlaySlot(clips, 'air.jump.fall')

  const landSoft = resolveClipForOverlaySlot(clips, 'air.jump.land.soft')
  const landMedium = resolveClipForOverlaySlot(clips, 'air.jump.land.medium') ?? landSoft
  const landHeavy =
    resolveClipForOverlaySlot(clips, 'air.jump.land.hard') ?? landMedium
  const landCritical = resolveClipForOverlaySlot(clips, 'air.jump.land.critical') ?? landHeavy
  const landFatal = resolveClipForOverlaySlot(clips, 'air.jump.land.fatal') ?? landCritical

  const edgeCatch = resolveClipForOverlaySlot(clips, 'hazard.pit.edge_catch')
  const wallStumble = resolveClipForOverlaySlot(clips, 'hazard.wall.stumble')
  const failJump = resolveClipForOverlaySlot(clips, 'air.fail.high_ledge')
  const recoverFromFail = resolveClipForOverlaySlot(clips, 'recovery.failed_jump.exit')

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
  return {
    tread: resolveClipForOverlaySlot(clips, 'water.tread'),
    swimForward: resolveClipForOverlaySlot(clips, 'water.swim.forward'),
    entryFall: resolveClipForOverlaySlot(clips, 'water.entry.fall'),
  }
}
