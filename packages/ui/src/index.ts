// @base/ui — Shared Vue 3 components + editor tools for the @base ecosystem

// ── Waypoint Editor ──────────────────────────────────────────────────────────
// Drop-in scene authoring tool: click-to-place navigation waypoints on a GLB
// floor mesh, visualize the path in 3D, and export a TypeScript array.
//
// Three consumers:
//   WaypointEditorView   → fullscreen route page (e.g. /#/editor in three-dreams)
//   WaypointEditorPanel  → compact panel embedded in threejs-engine-dev's EngineHarness
//   useWaypointEditor    → composable if you need headless / custom UI
//   WaypointEditorHUD    → reusable sidebar (used by WaypointEditorView)

export { useWaypointEditor } from './editor/useWaypointEditor'
export type {
  WaypointEditorConfig,
  WaypointEditorReturn,
} from './editor/useWaypointEditor'

export { default as WaypointEditorView } from './editor/WaypointEditorView.vue'
export { default as WaypointEditorHUD } from './editor/WaypointEditorHUD.vue'
export { default as WaypointEditorPanel } from './editor/WaypointEditorPanel.vue'
