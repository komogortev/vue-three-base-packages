# @base/physics

Rapier-backed physics queries for the @base ecosystem — trimesh collision, sphere penetration, static map registration.

Query-only collision for static map geometry. Rapier resolves collisions; it does not simulate the character's dynamics.

## What is in it

- `PhysicsWorld`: `await PhysicsWorld.create()`, then `addStaticMesh(gltf.scene)` to register a loaded GLB as a static trimesh. Queries: `spherePenetration(center, radius)` (push-out normal and depth, or `null`), `castRayDown(x, z, fromY)`, `shapeCastSphere(from, to, radius)` (swept test, so a fast mover cannot tunnel through a wall). `dispose()` releases the world.
- `CharacterMover`: from `world.createCharacterMover(profile)`; `move(currentPos, desired)` returns a `MoveResult`; `dispose()`.
- Types: `PenetrationResult`, `ColliderHandle`, `ShapeCastResult`, `CharacterMoverProfile`, `MoveResult`.

## Usage

```ts
import { PhysicsWorld } from '@base/physics'

const world = await PhysicsWorld.create()
world.addStaticMesh(gltf.scene)                 // the map's collision geometry

const hit = world.spherePenetration(position, radius)   // each tick
// ...
world.dispose()                                  // on unmount
```

## Dependencies

`@dimforge/rapier3d-compat`. Peer dependency: `three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/physics`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
