/**
 * Schema for the scene saved by the editor and consumed by SandboxView.
 *
 * Stored in localStorage['sandbox:scene'] (for the live Editor → Sandbox round-trip)
 * and also used as manifest.json in ZIP artifact exports (F-A5).
 *
 * version: 1 is a literal so consumers can type-narrow against future format changes.
 */

/**
 * How a placed child meets its parent — declared placement intent.
 *
 * **At L0 this is descriptive, not behavioural.** `validatePlacement` does not
 * branch on it: gap-failure severity is decided solely by whether
 * `parentWorldBounds` could be measured (veto when it could, advisory when it
 * could not). `contactType` currently feeds the idempotence hash and the
 * human-readable failure message.
 *
 * Per-type checks (hinge pivots, embed-depth vs overlap semantics) are the
 * deferred/warn tier and land with a later slice.
 */
export type ContactType =
  | 'embedded'
  | 'socket'
  | 'overlap'
  | 'hinge'
  | 'surface-contact'
  | 'glued'

/**
 * L0 attachment record for a placed object (F-G1).
 *
 * Optional and additive — absent means today's free placement (no gate applies).
 * The drag gesture authors the transform on {@link SavedPlacedObject}; a placement
 * gesture sets `contactType`/`parentSocket` intent; `localStart`/`localEnd`/
 * `embedDepth` are derived from geometry at drop.
 */
export interface PlacedAttachment {
  /**
   * Parent: another placed object (`placed-<nanoid6>`, matching
   * {@link SavedPlacedObject.id}) or a scene sentinel.
   *
   * Typed as a template literal rather than `string | 'room-root' | 'terrain'` —
   * that union collapses to bare `string` in TypeScript, so the sentinels were
   * documentation only and a typo (`'Room-Root'`) typechecked.
   */
  parentId: `placed-${string}` | 'room-root' | 'terrain'
  /** Named socket / contact region on the parent (optional at L0). */
  parentSocket?: string
  /** Child root point, parent-local coords (the pivot should sit here). */
  localStart: { x: number; y: number; z: number }
  /** Child tip/end point, parent-local coords (mesh oriented start→end). */
  localEnd: { x: number; y: number; z: number }
  /** Penetration into the parent (metres). One of embedDepth / overlap. */
  embedDepth?: number
  /** Blend overlap with the parent (metres). One of embedDepth / overlap. */
  overlap?: number
  contactType: ContactType
  /** Max acceptable visible gap between child root and parent surface (metres). */
  gapTolerance: number
}

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
  /**
   * L0 attachment metadata (F-G1). Absent = free placement, no gate applies.
   * Additive/backward-compatible — loaders stay lenient, no version bump.
   */
  attachment?: PlacedAttachment
}

export interface SandboxSceneSave {
  version: 1
  /** User-provided scene name. Optional for backward compat with legacy localStorage saves. */
  name?: string
  /** ISO 8601 timestamp of when the scene was saved. */
  savedAt: string
  placedObjects: SavedPlacedObject[]
  /**
   * Floor configuration — reserved for future use.
   * D-6 SandboxView ignores this field; the sandbox procedural terrain is always present.
   */
  floorConfig?: { kind: 'flat' }
}
