# @base/gameplay

Player-camera coordination kernel: input routing, mode switching, and per-frame tick for Three.js gameplay scenes.

Ties input, the player controller and the camera together each frame.

## What is in it

- `PlayerCameraCoordinator`: constructed with a player controller, a `GameplayCameraController` and a config (`PlayerCameraCoordinatorConfig`, for example facing lerp speeds and the first-person pitch limit). Its per-frame work is split into `tickPlayer` and `tickCamera` so a host can inject its own steps between them; per-frame inputs come in as a `CoordinatorTickContext` (terrain sampler, playable radius, and so on). `tick(delta, ctx)` runs the two back-to-back.
- `EV_GAMEPLAY_CAMERA_MODE`: the event name emitted when the camera mode changes.

Game-specific rules (scene content, win conditions, NPC logic) stay in the game; this package only coordinates the shared pieces.

## Dependencies

`@base/engine-core`, `@base/input`, `@base/player-three` and `@base/camera-three`. Peer dependency: `three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/gameplay`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
