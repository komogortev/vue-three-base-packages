# @base/camera-three

Gameplay camera rigs for Three.js: third-person follow presets, first-person eye, and shared rig math.

Camera rigs for gameplay scenes: third-person follow presets and a first-person eye view, with the mode switching handled by one controller.

## What is in it

- `GameplayCameraController`: holds the current mode (`'third-person'`, `'first-person'` or `'free-float'`) and preset. `setMode` / `getMode`, `setCameraPreset` / `getCameraPreset`, `setThirdPersonOverrides`, `getThirdPersonViewCam`, and `snapToCharacter(camera, character, facing, crouchBlend)`.
- Third-person presets: `'close-follow'`, `'shoulder'`, `'high'` and `'tactical'`, each a distance, height, lateral offset and look pivot (`THIRD_PERSON_CAMERA_PRESETS`, `THIRD_PERSON_CAMERA_PRESET_ORDER`, `resolveThirdPersonViewCam`).
- `computeThirdPersonCamera`: the rig maths, usable on its own.
- First person: `DEFAULT_FIRST_PERSON_VIEW` and the `FirstPersonViewConfig` type.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the controller and the coordinator in `@base/gameplay` split the work.

## Peer dependencies

`three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/camera-three`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
