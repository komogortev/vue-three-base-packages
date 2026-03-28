# PROJECT.md — SHARED (@base/* packages)

## Identity

- **Module:** `@base/*` pnpm monorepo workspace
- **Role:** Published infrastructure packages consumed by all game forks. Owns the reusable engine contract, rendering, input, audio, player, scene, and camera systems.
- **Fork of:** N/A — this is the shared package workspace, not a pwa-shell fork
- **Extracts to:** Packages are already the extraction target. New packages added here when proven in a game fork harness.

## North Star

A stable, versioned infrastructure stack that lets any new game fork mount a working Three.js player experience by adding `@base/*` dependencies — no boilerplate.

## Current Milestone

**Phase 3 close-out** — Ship the final Phase 3 deliverables (`@base/player-three` swimming + landing tiers stabilized, camera-three orbit) and prepare packages for Phase 4 game fork consumption.

## V1 Scope

**In scope:**
- `@base/engine-core` — `EngineModule`, `BaseModule`, `EventBus`, `ShellContext`, `EngineContext`
- `@base/pwa-core` — Service Worker registration, install prompt, offline cache strategy
- `@base/threejs-engine` — Three.js renderer, RAF loop, `ThreeContext`, `ThreeEntityManager`, `AssetLoader`
- `@base/input` — keyboard, gamepad, touch providers → abstract `InputAction`
- `@base/audio` — `AudioManager`, `MusicLayer`, spatial audio via THREE.AudioListener
- `@base/player-three` — `PlayerController`, `CharacterAnimationRig`, Mixamo FBX pipeline, `LandImpactTier` system, water + locomotion + overlay animation
- `@base/scene-builder` — `SceneDescriptor`, `SceneBuilder`, `TerrainSampler`, `SwimmableVolume`, `HeightmapLoader`, `EnvironmentRuntime`, `PrimitiveFactory`
- `@base/camera-three` — `GameplayCameraController`, third-person presets, `computeThirdPersonRig`
- `@base/ui` — Vue 3 shared component library

**Out of scope for v1:**
- `@base/physics` (Rapier) — deferred until game type requires it
- `@base/postfx` (EffectComposer / bloom) — deferred to Phase 5+
- Multiplayer / networking — not in scope until a game requires it
- Game-specific logic (lives in game forks, never in SHARED)

## Stack (beyond base fork)

- `three` + `@types/three`: Three.js renderer and scene graph
- `vitest`: unit testing for player-three and camera-three logic
- `pnpm` workspaces: local package resolution during development
- GitHub Packages: publish target at `https://npm.pkg.github.com` under `@base` scope

## Architectural Decisions

<!-- Append-only. Date each entry. Never remove old decisions. -->

- **2026-03-22** — `engine-core` interfaces (`EngineModule`, `ShellContext`, `EngineContext`) are the system contract. Any change is a breaking change requiring major version bump across all consumers.
- **2026-03-22** — All packages `"type": "module"` only. No CommonJS. Consumers get ES modules.
- **2026-03-22** — Cross-package dependencies allowed only when `engine-core` is the source. Prevents circular deps and keeps the graph a DAG.
- **2026-03-27** — `@base/player-three` owns all Mixamo FBX assets and the clip-resolution pipeline. Game forks reference assets via package URL exports; they do not vendor FBX files.
- **2026-03-28** — `SwimmableVolume` (per-body bounding rect + surfaceY) added to `@base/scene-builder`. Replaces global `seaLevel` scalar; backward-compat retained.
- **2026-03-28** — `LandImpactTier` extended to five tiers: soft / medium / hard / critical / fatal. Test suite expanded 42 → 47 tests to cover all branches.
