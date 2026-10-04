# @base/scene-builder

SceneDescriptor → Three.js terrain, scatter, GLTF placement, character spawn, and environment runtime helpers.

Builds a Three.js scene from a plain `SceneDescriptor`.

## What is in it

- `SceneBuilder.build(ctx, descriptor, options?)`: adds terrain, water, lights, atmosphere, the player character and placed or scattered objects to `ctx.scene`, and returns a `SceneBuilderResult` (including `npcGltfEntries` for NPCs that loaded an animation pack). `SceneBuilder.buildCharacter(...)` spawns just the character. Call `ctx.scene.clear()` on unmount.
- `SceneDescriptor`: optional `terrain` (hills, lakes, rivers, heightmaps), `atmosphere` (sky, sun and moon, clouds, fog), `character`, `objects` (primitives, seeded scatter fields, GLB placements), `swimmableVolumes` and `skipPlayerCharacter`. Types are exported from the package.
- `TerrainSampler`, `PrimitiveFactory`, `createSeeder`, `loadHeightmap` / `sampleHeightmap`, `EnvironmentRuntime` (time of day), and glTF material and animation helpers.
- `bindResolvePublicUrl` / `resolveStaticAssetUrl`: resolve `/public` paths when an app is served under a sub-path such as GitHub Pages.

## Usage

```ts
import { SceneBuilder } from '@base/scene-builder'
import type { SceneDescriptor } from '@base/scene-builder'

const descriptor: SceneDescriptor = { terrain: { radius: 50 } }
const result = await SceneBuilder.build(ctx, descriptor)   // ctx is a ThreeContext
```

## Dependencies

`@base/player-three` and `@base/threejs-engine`. Peer dependency: `three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/scene-builder`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
