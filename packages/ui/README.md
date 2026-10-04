# @base/ui

Shared Vue 3 component library for the @base ecosystem.

The main piece is the scene editor.

## What is in it

- **Scene editor:** `SceneEditorView` (hierarchy, 3D viewport and inspector in one shell), the `useSceneEditorViewport` composable for custom layouts, `createEditorGltfLoader` (the GLB loader the editor must use; it wires the self-hosted Draco decoder), and the exporters `serializeEditorConfigTS` and `buildRoomPackageScene`.
- **Waypoint editor:** `WaypointEditorView`, `WaypointEditorHUD` and the headless `useWaypointEditor` composable.
- **Asset pipeline:** an IndexedDB asset registry: the `useAssetStore` Pinia store (upload, lookup, remove) and the `AssetPicker` modal. See [docs/ASSET-PIPELINE.md](./docs/ASSET-PIPELINE.md).
- **Saved scenes:** `classifyScenes`, which hides saved scenes whose assets are missing from the library.

`src/index.ts` is the full list. It has no game imports, so a host page maps its own scene data to the editor's config.

## Peer dependencies

`vue`, `pinia`, `three` and `@base/threejs-engine`. It also uses `dexie`, `fflate` and `nanoid`.

## Build

From the repository root, `pnpm install && pnpm build`. This package builds with Vite and then `vue-tsc`.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
