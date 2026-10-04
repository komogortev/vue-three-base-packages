# @base/player-three

Third-person player locomotion, Mixamo animation helpers, and skinned-mesh utilities for Three.js.

## What is in it

- `PlayerController`: third-person locomotion on terrain. Feed it movement with `setMoveIntent(x, y)` and `notifyJumpPressed()`; it handles jumping, crouching, swimming (`setSwimmableVolumes`), carry impulses (`addPlanarCarryImpulse`, `setPlanarCarryVelocity`) and terrain snapping, and reports `consumeEvents()`.
- `CharacterAnimationRig`: blends a character's locomotion layers and plays one-shot overlays (jump, landing, water). `update(...)` each frame, `dispose()` when done.
- Clip resolution and retargeting: `resolveCharacterLocomotionClips`, `resolveCharacterOverlayClips`, `retargetMixamoClipsToCharacter`, `stripMixamoHipsPositionTracks`, `sanitizeMixamoClips`, and the skinned-mesh helpers (`primarySkinnedMeshForRig`, `pruneExtraSkinnedMeshes`).
- `computeLandImpactTier` and the `LAND_IMPACT_*` thresholds; `resolveConsequence`.
- `MIXAMO_FBX_CLIP_URLS`: the URLs of the bundled animation clips (see below).

## Bundled animation files

The package ships `assets/fbx/`: 37 third-party Mixamo animation files, about 150 MB, named
`category__subcategory__action.fbx`. `MIXAMO_FBX_CLIP_URLS` resolves them with `import.meta.glob`, so **an app
that imports it bundles all of them**. Those files keep their own terms and are not covered by the MIT licence.
Before changing the list in `src/mixamoFbxClipUrls.ts`, run `pnpm validate:clips` (see [CLIP_VALIDATION.md](./CLIP_VALIDATION.md)).

## Peer dependencies

`three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/player-three`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed; the Mixamo files under `assets/` are excluded, as described above.
