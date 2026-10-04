# @base/threejs-engine

Three.js engine module for the @base ecosystem — renderer, RAF loop, ECS entity manager, asset loader.

A host module: it creates the renderer, scene, camera and animation loop, and hands them to child modules.

## What is in it

- `ThreeModule`: mounts into a DOM container, runs the frame loop, observes resizes, and provides a `ThreeContext` to its children.
- `ThreeContext` (type): `renderer`, `scene`, `camera`, `clock`, `assets`, `entityManager` and `registerSystem(id, fn)`, which runs `fn(delta)` every frame before rendering and returns an unsubscribe function.
- `ThreeEntityManager`: the Three.js implementation of the `EntityManager` interface (adds `addMesh`, `setTransform`, `setState`).
- `AssetLoader`: `loadGLTF`, `loadFBX`, `loadTexture`, with caching and progress events; `dispose()` to release it.
- Draco helpers: `localDracoDecoderPath()`, `DRACO_CDN_FALLBACK_URL`, `resetDracoLoaderOnInitFailure`.

## Usage

```ts
import { ThreeModule } from '@base/threejs-engine'

const engine = new ThreeModule()
await engine.mount(container, shellContext)       // shellContext: { eventBus, locale, navigate }
await engine.mountChild('scene', myChildModule)   // children receive a ThreeContext
```

In a child module, register per-frame work and remove it on unmount:

```ts
const off = ctx.registerSystem('player-movement', (delta) => { /* ... */ })
// in onUnmount: off()
```

## Draco decoder

`AssetLoader` loads the Draco decoder from the app's own origin (`localDracoDecoderPath()`, which is `<base>draco/gltf/`),
so the decoder files from `three/examples/jsm/libs/draco/gltf/` must be copied into the app's `public/draco/gltf/`.
`DRACO_CDN_FALLBACK_URL` is exported for apps that have not copied them, but nothing in the package switches to it
automatically.

## Peer dependencies

`@base/engine-core` and `three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/threejs-engine`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
