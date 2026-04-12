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
