import * as THREE from 'three'

/**
 * Normalize clip names for matching Mixamo exports and scenario renames (`locomotion__walk__forward` → spaces).
 */
export function normalizeClipLabelForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/__/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * First clip matching any pattern against raw or normalized clip name.
 * Use ordered pattern lists so primary Mixamo names win before fallbacks.
 */
export function pickClipByPatterns(
  clips: readonly THREE.AnimationClip[],
  patterns: readonly RegExp[],
): THREE.AnimationClip | undefined {
  for (const re of patterns) {
    const hit = clips.find(
      (c) => re.test(c.name) || re.test(normalizeClipLabelForMatch(c.name)),
    )
    if (hit) return hit
  }
  return undefined
}

/** Semantic steady slots used by `CharacterAnimationRig` stand/crouch layers (see scenario docs + animation map). */
export type LocomotionSteadySlot =
  | 'locomotion.idle.stand'
  | 'locomotion.walk.forward'
  | 'locomotion.walk.backward'
  | 'locomotion.walk.strafe_left'
  | 'locomotion.walk.strafe_right'
  | 'locomotion.crouch.idle'
  | 'locomotion.crouch.walk_forward'
  | 'locomotion.crouch.strafe_left'
  | 'locomotion.crouch.strafe_right'

const STEADY_PATTERNS: Record<LocomotionSteadySlot, readonly RegExp[]> = {
  'locomotion.idle.stand': [
    /neutral idle/i,
    /^idle$/i,
    /^mixamorig\|idle$/i,
    /idle|stand|wait|rest|t[-_]?pose|idle-action-ready/i,
  ],
  'locomotion.walk.forward': [
    /^walking$/i,
    /^walking \(\d+\)$/i,
    /walk forward|forward walk/i,
    /start walking/i,
  ],
  'locomotion.walk.backward': [/walking backwards|backwards/i],
  'locomotion.walk.strafe_left': [/left strafe/i],
  'locomotion.walk.strafe_right': [/right strafe/i],
  'locomotion.crouch.idle': [/crouching idle/i, /male crouch pose/i],
  'locomotion.crouch.walk_forward': [/^crouched walking$/i, /crouched walking/i],
  'locomotion.crouch.strafe_left': [/crouched sneaking left/i],
  'locomotion.crouch.strafe_right': [/crouched sneaking right/i],
}

export function resolveSteadyLocomotionClip(
  clips: readonly THREE.AnimationClip[],
  slot: LocomotionSteadySlot,
): THREE.AnimationClip | undefined {
  return pickClipByPatterns(clips, STEADY_PATTERNS[slot])
}

/**
 * One stand **run** loop for forward sprint input (`locomotion.run.forward` semantic).
 * Picks a single clip in priority order; never returns the forward **walk** clip.
 */
const STAND_RUN_FWD_PATTERNS_ORDERED: readonly RegExp[] = [
  /running sprint/i,
  /\brun sprint\b/i,
  /running slow/i,
  /\brun slow\b/i,
  /^running$/i,
  /^running \(\d+\)$/i,
  /\bjog\b/i,
  /^sprint/i,
]

export function resolveStandRunFwdClip(
  clips: readonly THREE.AnimationClip[],
  walkFwdClip: THREE.AnimationClip | undefined,
): THREE.AnimationClip | undefined {
  for (const re of STAND_RUN_FWD_PATTERNS_ORDERED) {
    const c = pickClipByPatterns(clips, [re])
    if (c && walkFwdClip && c === walkFwdClip) continue
    if (c) return c
  }
  return undefined
}

export type CharacterLocomotionClipSet = {
  idleStand: THREE.AnimationClip | undefined
  walkFwdStand: THREE.AnimationClip | undefined
  walkBackStand: THREE.AnimationClip | undefined
  strafeLStand: THREE.AnimationClip | undefined
  strafeRStand: THREE.AnimationClip | undefined
  idleCrouch: THREE.AnimationClip | undefined
  walkCrouch: THREE.AnimationClip | undefined
  strafeLCrouch: THREE.AnimationClip | undefined
  strafeRCrouch: THREE.AnimationClip | undefined
  runFwdStand: THREE.AnimationClip | undefined
}

/**
 * Single entry point: map loaded clips to stand/crouch steady slots + one stand run forward loop.
 * Idle stand falls back to `clips[0]` when nothing matches (legacy rig behavior).
 */
export function resolveCharacterLocomotionClips(
  clips: readonly THREE.AnimationClip[],
): CharacterLocomotionClipSet {
  const idleStand =
    resolveSteadyLocomotionClip(clips, 'locomotion.idle.stand') ?? clips[0]
  const walkFwdStand = resolveSteadyLocomotionClip(clips, 'locomotion.walk.forward')
  const walkBackStand = resolveSteadyLocomotionClip(clips, 'locomotion.walk.backward')
  const strafeLStand = resolveSteadyLocomotionClip(clips, 'locomotion.walk.strafe_left')
  const strafeRStand = resolveSteadyLocomotionClip(clips, 'locomotion.walk.strafe_right')

  const idleCrouch =
    resolveSteadyLocomotionClip(clips, 'locomotion.crouch.idle') ?? idleStand
  let walkCrouch = resolveSteadyLocomotionClip(clips, 'locomotion.crouch.walk_forward')
  if (!walkCrouch) walkCrouch = walkFwdStand
  const strafeLCrouch = resolveSteadyLocomotionClip(clips, 'locomotion.crouch.strafe_left')
  const strafeRCrouch = resolveSteadyLocomotionClip(clips, 'locomotion.crouch.strafe_right')

  const runFwdStand = resolveStandRunFwdClip(clips, walkFwdStand)

  return {
    idleStand,
    walkFwdStand,
    walkBackStand,
    strafeLStand,
    strafeRStand,
    idleCrouch,
    walkCrouch,
    strafeLCrouch,
    strafeRCrouch,
    runFwdStand,
  }
}
