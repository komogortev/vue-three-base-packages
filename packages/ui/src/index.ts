// @base/ui — Shared Vue 3 components + editor tools for the @base ecosystem

// ── Waypoint Editor ──────────────────────────────────────────────────────────
// Standalone click-to-place waypoint tool (single NPC path, fullscreen page).
// For multi-object scenes use SceneEditorView instead.
//
// Consumers:
//   WaypointEditorView   → fullscreen route page
//   useWaypointEditor    → composable for headless / custom UI
//   WaypointEditorHUD    → reusable sidebar list

export { useWaypointEditor } from './editor/useWaypointEditor'
export type {
  WaypointEditorConfig,
  WaypointEditorReturn,
} from './editor/useWaypointEditor'

export { default as WaypointEditorView } from './editor/WaypointEditorView.vue'
export { default as WaypointEditorHUD } from './editor/WaypointEditorHUD.vue'

// ── Scene Editor ─────────────────────────────────────────────────────────────
// Unified inspector-style editor: hierarchy + 3D viewport + contextual panels.
// Supports NPC placement overview, per-NPC waypoint authoring, trigger zone
// display. Packageable — no game imports; host page maps game descriptors to
// SceneEditorConfig.
//
// Consumers:
//   SceneEditorView      → full editor shell (hierarchy + viewport + inspector)
//   useSceneEditorViewport → composable for custom editor layouts
//   SceneEditorConfig    → config type the host page builds and passes as prop

export { default as SceneEditorView } from './editor/SceneEditorView.vue'
export { useSceneEditorViewport } from './editor/useSceneEditorViewport'
export type { SceneEditorViewportReturn } from './editor/useSceneEditorViewport'
export type {
  SceneEditorConfig,
  SceneEditorEntry,
  EditorNpcEntry,
  EditorZoneEntry,
  EditorSelection,
} from './editor/sceneEditorTypes'
export { EDITOR_ORBIT_BOOKMARKS, EDITOR_ORBIT_LOCOMOTION_IDS } from './editor/editorOrbitPresets'
export type { EditorOrbitBookmark } from './editor/sceneEditorTypes'
export { serializeEditorConfigTS, buildRoomPackageScene } from './editor/SceneEditorExporter'
export { exportRoomPackage } from './editor/exportRoomPackage'
export { loadRoomPackage, loadRoomFromDb } from './editor/loadRoomPackage'
export type { LoadedRoomPackage } from './editor/loadRoomPackage'
export type { RoomPackageManifest, RoomPackageScene } from './editor/roomPackageTypes'

// ── Asset Pipeline ───────────────────────────────────────────────────────────
// Editor asset registry (IndexedDB) — see docs/ASSET-PIPELINE.md.
//
// Consumers:
//   useAssetStore        → Pinia store (upload / getById / resolveBlobUrl / remove)
//   AssetRow, AssetKind  → row + enum types
//   UploadError          → typed error thrown by useAssetStore.upload()
//   AssetPicker          → modal asset selector (props: open, kindFilter; emits: close, select)

export { useAssetStore, UploadError } from './editor/useAssetStore'
export type { UploadErrorKind } from './editor/useAssetStore'
export type { AssetRow, AssetKind, SceneRow } from './editor/assetDb'
export { assetDb } from './editor/assetDb'
export { default as AssetPicker } from './editor/AssetPicker.vue'

// ── Sandbox scene schema ─────────────────────────────────────────────────────
// Used by SandboxView (threejs-engine-dev) to load editor-saved scenes.
export type { SavedPlacedObject, SandboxSceneSave } from './editor/sandboxSceneSchema'
export type { PlacedAttachment, ContactType } from './editor/sandboxSceneSchema'

// ── L0 Asset Gate ────────────────────────────────────────────────────────────
// Deterministic placement/attachment validator (F-G2) + two-tier gate summary.
// Engine-agnostic pure TS — geometry arrives as plain numbers so the same code
// backs the in-editor gate and a future CLI twin. VLM reviewer fills the verdict
// JSON later (F-G7) with no architecture change.
export {
  validatePlacement,
  summarizeVerdicts,
  transformPoint,
  pointToAabbDistance,
  hashKey,
  DEFAULT_PIVOT_EPSILON,
} from './editor/gate/attachmentValidator'
export type {
  ValidatePlacementInput,
  GateSummary,
} from './editor/gate/attachmentValidator'
export type {
  PlacementVerdict,
  GateCheck,
  VerdictStatus,
  CheckSeverity,
  Vec3,
  Mat4,
  Aabb,
} from './editor/gate/verdict'
