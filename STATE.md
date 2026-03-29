# STATE.md — SHARED (@base/* packages)

## Status

_Last updated: 2026-03-29_

**What's working:** All 9 packages build cleanly. `@base/player-three` test suite passes at 47 tests. Swimming v1 (`water` PlayerMode, `SwimmableVolume`, tread/swim FBX slots) landed. Five-tier landing severity (`LandImpactTier`) wired with pattern-matched animation resolution. Third-person orbit camera in `@base/camera-three` (via `facingLerpThirdPerson`). Checkpoint `checkpoint/session-09-10-2026-03-28` tagged at `be61e99`.

**What's broken / incomplete:** `water__entry__fall.fbx` is a placeholder — no real water-entry animation. `failJump` uses "Straight Landing" as a mild substitute. Some landing tiers may not resolve correctly due to Mixamo internal clip name variance (enable `debugClipResolution` in harness to diagnose). `@base/pwa-core` is a stub (SW registration scaffolded, not fully implemented).

## Active Work

- No active package work in progress; harnesses consuming current builds
- Awaiting Phase 3d camera strategy work in `threejs-engine-dev` before final Phase 3 sign-off

## Blockers & Open Questions

- **[2026-03-28]** `water__entry__fall.fbx` — placeholder file. Source real Mixamo water-entry animation and replace.
- **[2026-03-28]** Terrain surface-normal API not exposed from `@base/scene-builder` — needed for uphill lean animation in `@base/player-three`. API design decision needed before implementing.

## Next Session

> Run `pnpm run test` in `@base/player-three` to confirm all 47 tests still pass after harness changes. Then update `@base/scene-builder` to expose a `surfaceNormal(x, z)` API from `TerrainSampler` — this unblocks the uphill lean work in `PlayerController`.

## Decision Log

<!-- Append-only. One line per decision, newest first. -->

- **2026-03-29** — NPC stub/respawn mechanics confirmed as game-layer concern (in `three-dreams/GameplaySceneConfig`), not a shared package concern. `@base/player-three` and `@base/scene-builder` APIs require no changes for Phase 4A NPC system.
- **2026-03-28** — Five-tier `LandImpactTier` landed: soft / medium / hard / critical / fatal. Four-tier was insufficient for nuanced animation responses.
- **2026-03-28** — `SwimmableVolume` per-body rather than global `seaLevel` scalar. Supports pools at any elevation.
- **2026-03-27** — FBX naming convention locked: `category__subcategory__action.fbx`. Vite glob URL resolution depends on stable naming.
- **2026-03-27** — Regex clip resolution with fallback chain. Explicit name maps rejected: too brittle against Mixamo name variants across character exports.
- **2026-03-22** — `engine-core` interfaces frozen as system contract. Breaking changes require major version and migration docs.

## Deferred

- **`@base/pwa-core` full implementation:** SW registration stub only. Implement when Phase 4 game fork needs offline support.
- **`@base/physics` (Rapier):** Not started. Trigger when game genre requires collision/rigidbodies.
- **`@base/postfx`:** Not started. Trigger when a game requires bloom/DOF.
- **Surface-normal API in `@base/scene-builder`:** Needed for uphill lean. Deferred until after swimming animation validation.
- **`water__entry__fall.fbx` real animation:** Placeholder in place. Source from Mixamo when prioritized.
