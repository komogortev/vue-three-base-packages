/**
 * Paths are relative to the `assets/` directory at the player-three package root.
 * All files follow the `category__subcategory__action.fbx` naming convention.
 * These map to the keys produced by the `import.meta.glob` call below.
 *
 * File renames only affect paths here — internal FBX clip names are unchanged, so
 * `locomotionClipAssignments` and `animationOverlayAssignments` patterns need no update.
 */
const FBX_ASSET_PATHS = [
  // ── Locomotion: stand layer ───────────────────────────────────────────────
  'fbx/locomotion/locomotion__idle__stand.fbx',
  'fbx/locomotion/locomotion__walk__forward.fbx',
  'fbx/locomotion/locomotion__walk__backward.fbx',
  'fbx/locomotion/locomotion__walk__strafe_left.fbx',
  'fbx/locomotion/locomotion__walk__strafe_right.fbx',
  'fbx/locomotion/locomotion__run__forward.fbx',
  'fbx/locomotion/locomotion__run__slow.fbx',

  // ── Locomotion: crouch layer ──────────────────────────────────────────────
  'fbx/locomotion/locomotion__crouch__idle.fbx',
  'fbx/locomotion/locomotion__crouch__walk_forward.fbx',
  'fbx/locomotion/locomotion__crouch__strafe_left.fbx',
  'fbx/locomotion/locomotion__crouch__strafe_right.fbx',

  // ── Transitions ───────────────────────────────────────────────────────────
  'fbx/transitions/transition__idle_stand__walk_forward.fbx',
  'fbx/transitions/transition__walk_forward__idle_stand.fbx',
  'fbx/transitions/transition__stand__crouch.fbx',
  'fbx/transitions/transition__crouch__stand.fbx',

  // ── Air: jump rise / fall ─────────────────────────────────────────────────
  'fbx/air/air__jump__rise.fbx',
  'fbx/air/air__jump__fall.fbx',
  'fbx/air/air__fall__idle.fbx',

  // ── Air: landing ──────────────────────────────────────────────────────────
  'fbx/air/air__land__soft.fbx',
  'fbx/air/air__land__heavy.fbx',
  'fbx/air/air__land__impact_flat.fbx',

  // ── Hazard ────────────────────────────────────────────────────────────────
  'fbx/hazard/hazard__wall__stumble.fbx',
  'fbx/hazard/hazard__edge__slip.fbx',
  'fbx/hazard/hazard__edge__teeter_heavy.fbx',
  'fbx/hazard/hazard__edge__teeter.fbx',

  // ── Recovery ──────────────────────────────────────────────────────────────
  'fbx/recovery/recovery__stand_up.fbx',
] as const

/**
 * Vite resolves this glob at transform time into a map of relative path → dev-server URL
 * (or content-hashed production URL). This avoids `import.meta.url` URL arithmetic,
 * which is unreliable when the package is loaded via a Vite source alias.
 *
 * NOTE: this is a Vite-specific API. The compiled `dist/` output is not usable outside
 * a Vite build pipeline. All current consumers use Vite, so this is acceptable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _fbxAssetUrls = (import.meta as any).glob('../assets/**/*.fbx', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Canonical Mixamo FBX animation clip URLs hosted by `@base/player-three`.
 *
 * Resolved by Vite at transform time — consuming apps no longer need to duplicate
 * animation FBX files in their own `public/` directories.
 */
export const MIXAMO_FBX_CLIP_URLS: string[] = FBX_ASSET_PATHS
  .map((relativePath) => _fbxAssetUrls[`../assets/${relativePath}`])
  .filter((url): url is string => typeof url === 'string' && url.length > 0)
