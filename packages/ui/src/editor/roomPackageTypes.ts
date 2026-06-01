/**
 * Room Package — wire types for the interactional-room deliverable.
 *
 * ZIP layout:
 *   manifest.json           ← RoomPackageManifest
 *   scene.json              ← RoomPackageScene
 *   assets/<assetId>.<ext>  ← all referenced GLBs + audio blobs
 *
 * Contract is intentionally minimal for V1.  Future fields (reactions, lighting
 * presets, NPC dialogue, spline paths) are additive — loaders should be lenient
 * on unknown keys.
 */

import type { SavedPlacedObject } from './sandboxSceneSchema'
import type { EditorNpcEntry, EditorZoneEntry } from './sceneEditorTypes'

export interface RoomPackageManifest {
  /** Always 1 for this format version. Type-narrow against future bumps. */
  version: 1
  /** ISO 8601 — when the package was exported. */
  exportedAt: string
  /** 'room-<nanoid8>' — unique per export. */
  packageId: string
  /** Display name the editor showed when the scene was saved. */
  sceneLabel: string
}

export interface RoomPackageScene {
  /** Furniture / props placed in the scene (transform + asset reference). */
  placedObjects: SavedPlacedObject[]
  /** NPC character entities (asset binding + placement). */
  npcs: EditorNpcEntry[]
  /** Proximity and exit trigger zones. */
  zones: EditorZoneEntry[]
  /** Player spawn point (XZ). Absent → loader picks a sensible default. */
  spawnPoint?: { x: number; z: number }
  /** Asset registry ID of the ambient audio track (kind === 'audio'). */
  ambientAudioAssetId?: string
  /** Ambient audio volume in [0, 1]. Absent → loader defaults to 1.0. */
  ambientAudioVolume?: number
}
