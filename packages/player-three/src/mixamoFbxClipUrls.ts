const FBX_NAMES = [
  'Climbing.fbx',
  'Crouch To Stand.fbx',
  'Crouched Sneaking Left.fbx',
  'Crouched Sneaking Right.fbx',
  'Crouched To Standing.fbx',
  'Crouched Walking.fbx',
  'Crouching Idle.fbx',
  'Falling.fbx',
  'Falling Flat Impact.fbx',
  'Falling From Losing Balance.fbx',
  'Falling Into Pool.fbx',
  'Falling To Landing.fbx',
  'Falling To Roll.fbx',
  'Hard Landing.fbx',
  'Idle-action-ready.fbx',
  'Jumping Down.fbx',
  'Jumping.fbx',
  'Left Strafe Walking.fbx',
  'Male Crouch Pose.fbx',
  'Neutral Idle.fbx',
  'Reaction.fbx',
  'Right Strafe Walking.fbx',
  'Running slow.fbx',
  'Running sprint.fbx',
  'Start Walking.fbx',
  'Stop Walking.fbx',
  'Walking.fbx',
  'Walking Backwards.fbx',
  'Walking Turn 180.fbx',
] as const

/**
 * Canonical Mixamo FBX animation clips hosted by `@base/player-three`.
 *
 * These URLs resolve from package assets, so scenario repos no longer need
 * to duplicate `public/fbx` animation folders.
 */
export const MIXAMO_FBX_CLIP_URLS: string[] = FBX_NAMES.map((name) =>
  new URL(`../assets/fbx/${name}`, import.meta.url).href,
)

