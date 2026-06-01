# STATE.md — SHARED (@base/* packages)

## Status

_Last updated: 2026-06-01_

**What's working:** All packages build cleanly. **Phase 5 S4 (Pose Editor) fully complete — S4-a (FK) + S4-b (CCD IK) + S4-c (polish) all shipped on branch `feat/t-f7-glb-normalization`.** S4-c adds: bone search filter in Pose tab (live case-insensitive `<input>`, resets on NPC deselect); IK hint UI (4 chain buttons for rightArm/leftArm/rightLeg/leftLeg, active chain highlighted, wired to `selectIkTarget()`/`activeIkChainName` in SceneEditorView). **Vitest foundation added to `@base/ui`**: vitest 2.x installed, `vitest.config.ts` + tsconfig `exclude` pattern, 19 passing tests (`SceneEditorExporter` × 12 + `usePoseEditor` × 7). Prior: Phase 5 Room Package pipeline complete on `main` (S1 Dexie v3 + audio, S2 export, S3 room player, T-F7 GLB normalization, S4-a FK, S4-b CCD IK). Full pipeline end-to-end: Editor export → ZIP → Load Room → FPV walkthrough.

**What's broken / incomplete:** `water__entry__fall.fbx` is a placeholder. `failJump` uses "Straight Landing" as mild substitute. `@base/pwa-core` stub. `retargetMixamoClipsToCharacter` untested (WebGL context needed).

## Active Work

- Phase 5 S5 — Animation Recorder (`capturePose()` as keyframe primitive, `QuaternionKeyframeTrack` + `AnimationClip.optimize()` + `GLTFExporter`)

## Blockers & Open Questions

- **[2026-03-28]** `water__entry__fall.fbx` — placeholder file. Source real Mixamo water-entry animation and replace.
- **[2026-03-28]** Terrain surface-normal API not exposed from `@base/scene-builder` — needed for uphill lean animation in `@base/player-three`. API design decision needed before implementing.

## Next Session

> **First action of next Claude Code session:** smoke-test custom subagents — invoke `CodeReview` with a single-file Read request; success = `tool_uses ≥ 1`. If still `tool_uses: 0`, rename `*.agent.md` → `*.md` per `feedback_codereview_agent_broken_session.md`. Then start Phase 3 F-9 (NPC mesh binding via AssetPicker).

## Decision Log

<!-- Append-only. One line per decision, newest first. -->

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
