# vue-three-base-packages

Eleven reusable TypeScript packages for building Three.js games and tools in the browser: engine core,
scene building, player and camera control, input, physics, audio, and a Vue editor UI. This is the shared
layer under the `@base` platform; the apps built on it are
[threejs-engine-dev](https://github.com/komogortev/threejs-engine-dev) (a scene editor and room player) and
[three-dbox](https://github.com/komogortev/three-dbox) (a combat sandbox).

It is a pnpm workspace. All packages are `@base/*` at version 0.1.0, written in TypeScript, and built with `tsc`
(Vite for `ui`).

## Packages

| Package | What it does |
|--------|--------------|
| `@base/engine-core` | Mount contract, `EventBus` and `BaseModule`: the interfaces every other package builds on |
| `@base/threejs-engine` | Renderer, scene, camera, animation-frame loop, ECS entity manager and asset loader (including Draco) |
| `@base/scene-builder` | `SceneDescriptor` to Three.js: terrain, scatter, GLB placement, NPC and character spawn |
| `@base/player-three` | Third-person player locomotion, terrain snap, Mixamo animation helpers, skinned-mesh utilities |
| `@base/camera-three` | Third-person follow presets, first-person eye offset, shared camera rig math |
| `@base/gameplay` | `PlayerCameraCoordinator`: routes input to the player and camera, with per-frame `tickPlayer` / `tickCamera` hooks |
| `@base/input` | Keyboard, gamepad and touch mapped to game-agnostic actions; ability slots and rebinding |
| `@base/physics` | Rapier-backed queries: trimesh collision, sphere penetration, static map registration |
| `@base/audio` | Web Audio spatial audio, music layers and crossfade, SFX |
| `@base/pwa-core` | Service worker registration, offline handling, install prompt |
| `@base/ui` | Vue 3 components: the scene editor (`SceneEditorView`), waypoint editor, input settings |

`dist/` is gitignored, so run `pnpm build` before linking the packages into an app.

## Build and test

Needs Node 20 or newer and pnpm 9 or newer.

```bash
pnpm install
pnpm build        # topological order: engine-core before the packages that depend on it
pnpm typecheck
pnpm test         # in the packages that have tests
```

CI (`.github/workflows/ci.yml`) runs install and build on every push and pull request to `main`.

## Use the packages in an app

During development an app links the packages from a sibling checkout, which is how
[threejs-engine-dev](https://github.com/komogortev/threejs-engine-dev) consumes them:

```text
workspace/
  SHARED/              # this repo
  threejs-engine-dev/  # app with link:../SHARED/packages/... dependencies
```

Build this workspace first, then run `pnpm install` in the app. Each package declares a `publishConfig` for
GitHub Packages, but nothing here depends on a published release.

## License

The source code is [MIT](./LICENSE) licensed. The Mixamo animation files under
`packages/player-three/assets/fbx/` (37 FBX files, about 150 MB) are third-party assets that keep their own
terms and are not covered by it.
