/**
 * Schema for the scene saved by the editor and consumed by SandboxView.
 *
 * Stored in localStorage['sandbox:scene'] (for the live Editor → Sandbox round-trip)
 * and also used as manifest.json in ZIP artifact exports (F-A5).
 *
 * version: 1 is a literal so consumers can type-narrow against future format changes.
 */

export interface SavedPlacedObject {
  /** Matches EditorPlacedObject.id — 'placed-<nanoid6>'. */
  id: string
  /** Source asset in the registry — 'asset-<nanoid>'. */
  assetId: string
  /** Human-readable label (asset filename). */
  label: string
  x: number
  y: number
  z: number
  rotationX: number
  rotationY: number
  rotationZ: number
  scaleX: number
  scaleY: number
  scaleZ: number
}

export interface SandboxSceneSave {
  version: 1
  /** ISO 8601 timestamp of when the scene was saved. */
  savedAt: string
  placedObjects: SavedPlacedObject[]
  /**
   * Floor configuration — reserved for future use.
   * D-6 SandboxView ignores this field; the sandbox procedural terrain is always present.
   */
  floorConfig?: { kind: 'flat' }
}
