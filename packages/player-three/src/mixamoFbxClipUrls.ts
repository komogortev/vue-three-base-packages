/**
 * Paths are relative to `assets/` at package root. Used with `import.meta.url`
 * so bundlers emit correct URLs for published `files: ["assets"]`.
 *
 * Intentionally **minimal**: Scenario 01 `fbx/**`, clips `CharacterAnimationRig`
 * selects, plus paths **named in scenario docs** (e.g. Scenario 03 crouch enter/exit).
 */
const FBX_ASSET_PATHS = [
  // Scenario 01 — bundled layout (identification pattern filenames)
  'fbx/locomotion/locomotion__idle__stand.fbx',
  'fbx/locomotion/locomotion__walk__forward.fbx',
  'fbx/transitions/transition__idle_stand__walk_forward.fbx',
  'fbx/transitions/transition__walk_forward__idle_stand.fbx',

  // Grounded locomotion (rig: walk back, strafe, single run forward — sprint clip)
  'sources/movement/Running sprint.fbx',
  'sources/movement/Walk Strafe Left.fbx',
  'sources/movement/Walk Strafe Right.fbx',
  'sources/movement/Walking Backwards.fbx',

  // Scenario 03 — crouch locomotion + enter/exit (loops used by rig; transitions load for future one-shots)
  'fbx/locomotion/locomotion__crouch__strafe_left.fbx',
  'fbx/locomotion/locomotion__crouch__strafe_right.fbx',
  'fbx/locomotion/locomotion__crouch__walk_forward.fbx',
  'fbx/locomotion/locomotion__crouch__idle.fbx',
  'sources/crouching/Crouched To Standing.fbx',
  'sources/transitions/Standing To Crouched.fbx',

  // Air + hazards + recovery (overlay assignments)
  'sources/jump/Jumping Up.fbx',
  'sources/fbx-unused/Falling.fbx',
  'sources/fbx-unused/Jumping.fbx',
  'sources/fbx-unused/Jumping Down.fbx',
  'sources/fbx-unused/Reaction.fbx',
  'sources/fbx-unused/Falling From Losing Balance.fbx',
  'sources/fbx-unused/Falling To Roll.fbx',
  'sources/falling/Falling Flat Impact.fbx',
  'sources/falling/Falling Heavy.fbx',
  'sources/fbx-unused/Hard Landing.fbx',
  'sources/fbx-unused/Falling To Landing.fbx',
  'sources/fbx-unused/Sweep Fall.fbx',
  'sources/jump/Stumble Backwards.fbx',
  'sources/transitions/Edge Slip.fbx',
  'sources/transitions/Stand Up.fbx',
] as const

/**
 * Canonical Mixamo FBX animation clips hosted by `@base/player-three`.
 *
 * These URLs resolve from package assets, so scenario repos no longer need
 * to duplicate `public/fbx` animation folders.
 */
export const MIXAMO_FBX_CLIP_URLS: string[] = FBX_ASSET_PATHS.map((relativePath) =>
  new URL(`../assets/${relativePath}`, import.meta.url).href,
)
