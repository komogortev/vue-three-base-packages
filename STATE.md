# STATE.md — SHARED (@base/* packages)

## Status

_Last updated: 2026-06-02_

**What's working:** All 11 packages build cleanly. **Phase 5 S4 (Pose Editor) fully complete on `main`**: T-F7 (`normalizeGLTFOrigin()` pivot-wrap) + S4-a (FK foundation — `usePoseEditor.ts`, `EditorNpcEntry.poseOverride`, viewport pose mesh + SkeletonHelper + bone TC) squash-merged as PR #31; S4-b (CCD IK solver `runCcdIk`, 4 IK target spheres, `selectIkTarget()` API, `RoomPlayerModule` poseOverride apply-before-render) + S4-c (bone search filter in Pose tab, IK hint UI — 4 chain buttons, vitest 2.x foundation, 19 passing tests) merged as PR #32. Prior: Phase 5 S1/S2/S3 (Dexie v3, audio kind, room package export/load, `AssetLibraryDialog`) via PRs #29+#30. Full pipeline end-to-end: Editor export → ZIP → Load Room → FPV walkthrough.

**What's broken / incomplete:** `water__entry__fall.fbx` is a placeholder. `failJump` uses "Straight Landing" as mild substitute. `@base/pwa-core` stub. `retargetMixamoClipsToCharacter` untested (WebGL context needed).

## Active Work

- **S5 Animation Recorder** — `capturePose()` keyframe primitive, `QuaternionKeyframeTrack` + `AnimationClip.optimize()` + `GLTFExporter`, Dexie animation-pack.

## Blockers & Open Questions

- **[2026-03-28]** `water__entry__fall.fbx` — placeholder file. Source real Mixamo water-entry animation and replace.
- **[2026-03-28]** Terrain surface-normal API not exposed from `@base/scene-builder` — needed for uphill lean animation in `@base/player-three`. API design decision needed before implementing.

## Next Session

Begin S5 Animation Recorder.

## Decision Log

<!-- Append-only. One line per decision, newest first. -->

- **2026-06-02** — fix(ui): 7-bug sweep of editor code (PR #36 open). Memory leaks: `clearScene` disposed scene graph but leaked GPU resources — NPC/zone marker materials, placed-object geometries/materials, path-viz dot materials — fixed with traverse-and-dispose before `.clear()`. `updateNpcPath` same dot leak on replace. State bugs: `saveScene` never set `activeSavedSceneId` (dropdown desync after first save); `restoreWaypoints` read `activeConfig.value.npcs` instead of `localNpcs` (saved-scene waypoints never restored); `onLoadScene` didn't call `restoreWaypoints`. Silent failure: `_loadPlayCharacter` bare `catch {}` → `console.warn`. `onSwitchScene` guard blocked reinit when `activeSceneId` stale after saved-scene load (PR #35 merged). `onLoadScene` missing NPC/zone restore + wrong `reinitScene` config arg (PR #34 merged).
- **2026-06-02** — fix(ui): `saveScene()` was silently failing — `effectiveConfig` spreads `localNpcs`/`localZones` (deep-reactive `ref` arrays) whose `.value` returns Vue Proxy objects; IndexedDB structured clone throws `DataCloneError`, swallowed by bare `catch {}`. Fix: `toRaw()` on spread + `.map(toRaw)` on NPC/zone arrays before `assetDb.scenes.put()`. `console.error` added to all 3 editor catch blocks. PR #34.
- **2026-06-01** — Editor: delete placed objects — `removePlacedObject()` added to `@base/ui` viewport composable. × button (hover-reveal, red on hover) on each Placed Objects hierarchy row + Delete/Backspace key in orbit mode. Geometry + material disposal on removal prevents GPU memory leak. TC detach guard added for edge case where deleted root is current TC target. PR #33 open on `feat/editor-delete-placed-objects`.
- **2026-06-01** — PR #32 (S4-b + S4-c) rebased onto updated main before merge. Root cause: PR #31 was a squash-merge that included both T-F7 and S4-a; branch still carried those as separate commits → CONFLICTING. Rebase dropped duplicates, leaving only S4-b + S4-c on top of current main. Force-pushed; PR merged clean.
- **2026-06-01** — Phase 5 S4-c shipped + vitest foundation: bone search filter + IK hint UI in Pose inspector tab; `@base/ui` gains vitest 2.x with 19 passing tests (`SceneEditorExporter` × 12 + `usePoseEditor` × 7). Phase 5 S4 fully complete (a + b + c). S5 Animation Recorder is next.
- **2026-05-20** — Editor Phase 2 closed: W3 PR #24 (`AssetPicker` modal + Use… wiring in AssetsSection + index.ts export) merged 2026-05-17; CI hotfix PR #25 (`engine-core` + `scene-builder` tsconfig `skipLibCheck` + `exclude src/**/*.test.ts` to match sibling pattern) merged 2026-05-20 restoring green main since 2026-05-12 breakage. F-A1/F-A2/F-A3/F-A4 all ✅. AssetPicker exported from `@base/ui` ready for Phase 3 F-9 consumption.
- **2026-05-11 EOD** — Editor Phase 2 W2 (asset registry + upload + thumbnails) shipped, merged as PR #23 on 2026-05-12.
- **2026-05-11** — Editor Phase 2 W1 design doc (`packages/ui/docs/ASSET-PIPELINE.md`) shipped — three-layer model, frozen Dexie v1 schema, Q1-Q7 resolutions.
- **2026-04-20** — Test coverage gap closed across 5 packages (~195 new tests, commit `169386d`). Uses real Three.js/EventBus instances, no `vi.mock('three')` — tests exercise actual math. WebGL-dependent paths (`retargetMixamoClipsToCharacter`) deliberately deferred to integration tests.
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
