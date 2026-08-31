/**
 * Placed-object model — the pure kernel of the placement pipeline.
 *
 * Three call sites in `useSceneEditorViewport.ts` construct or derive an
 * {@link EditorPlacedObject}: `placeObject` (fresh drop), `restorePlacedObjects`
 * (saved-scene load) and `snapshotPlacedTransforms` (save). Each used to
 * hand-list the record's fields, which is how F-G3 broke: the restore path
 * omitted `attachment`, silently stripping every attachment on reload and
 * making `runPlacementGate()` a permanent no-op for any saved scene. A
 * hand-listed field set has no way to notice a missing member.
 *
 * Everything here is engine-agnostic — plain numbers in, plain numbers out, no
 * THREE / Vue / Dexie imports — so the record shape and the bbox arithmetic are
 * unit-testable without a renderer. The caller converts `THREE.Box3` to
 * {@link Aabb} at the boundary (mirrors `glbLintAdapter`'s split).
 */
import type { Aabb, Vec3 } from './gate/verdict'
import type { EditorPlacedObject } from './sceneEditorTypes'
import type { PlacedAttachment } from './sandboxSceneSchema'

/** Padding added to each axis of the invisible raycast hit box around a placed GLB. */
export const HITBOX_PADDING = 0.2

/**
 * Stand-in bounds for a GLB that failed to load or reported empty bounds — a
 * 1 m cube sitting on the floor, matching the wireframe fallback proxy.
 */
export const FALLBACK_LOCAL_BBOX: Aabb = {
  min: { x: -0.5, y: 0, z: -0.5 },
  max: { x: 0.5, y: 1, z: 0.5 },
}

/** Identity transform applied to a freshly dropped object (rotation 0, scale 1). */
export const IDENTITY_PLACED_TRANSFORM: PlacedTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

/** A placed object's world transform, decomposed. Euler XYZ in radians. */
export interface PlacedTransform {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

/** Identity fields that distinguish one placement from another. */
export interface PlacedIdentity {
  id: string
  assetId: string
  label: string
}

/** True when the box has no extent on any axis (THREE.Box3.isEmpty semantics). */
export function isEmptyBbox(b: Aabb): boolean {
  return b.max.x < b.min.x || b.max.y < b.min.y || b.max.z < b.min.z
}

/** Resolve usable local bounds, substituting {@link FALLBACK_LOCAL_BBOX} for absent/empty input. */
export function resolveLocalBbox(bbox: Aabb | null | undefined): Aabb {
  if (!bbox || isEmptyBbox(bbox)) return FALLBACK_LOCAL_BBOX
  return bbox
}

/**
 * Dimensions of the invisible hit box for a placed GLB: the bounds' own size
 * padded by {@link HITBOX_PADDING} on every axis, centred on the bounds' centre
 * so the box wraps geometry whose pivot is not at its centre.
 */
export function hitBoxDims(bbox: Aabb): { size: Vec3; center: Vec3 } {
  return {
    size: {
      x: bbox.max.x - bbox.min.x + HITBOX_PADDING,
      y: bbox.max.y - bbox.min.y + HITBOX_PADDING,
      z: bbox.max.z - bbox.min.z + HITBOX_PADDING,
    },
    center: {
      x: (bbox.min.x + bbox.max.x) / 2,
      y: (bbox.min.y + bbox.max.y) / 2,
      z: (bbox.min.z + bbox.max.z) / 2,
    },
  }
}

/**
 * Build the single canonical {@link EditorPlacedObject} record.
 *
 * **Every** construction path goes through here. Adding a field to
 * `EditorPlacedObject` means adding it once, in this function — which is the
 * property the F-G3 attachment bug needed and did not have.
 */
export function makePlacedObject(
  identity: PlacedIdentity,
  transform: PlacedTransform,
  attachment?: PlacedAttachment,
): EditorPlacedObject {
  return {
    id: identity.id,
    assetId: identity.assetId,
    label: identity.label,
    x: transform.position.x,
    y: transform.position.y,
    z: transform.position.z,
    rotationX: transform.rotation.x,
    rotationY: transform.rotation.y,
    rotationZ: transform.rotation.z,
    scaleX: transform.scale.x,
    scaleY: transform.scale.y,
    scaleZ: transform.scale.z,
    // Free placements carry no attachment; the saved-scene path passes one through.
    ...(attachment ? { attachment } : {}),
  }
}

/**
 * Re-stamp a record's transform from live scene values, preserving every other
 * field (notably `attachment`). Used when snapshotting for save.
 */
export function withTransform(
  obj: EditorPlacedObject,
  transform: PlacedTransform,
): EditorPlacedObject {
  return {
    ...obj,
    x: transform.position.x,
    y: transform.position.y,
    z: transform.position.z,
    rotationX: transform.rotation.x,
    rotationY: transform.rotation.y,
    rotationZ: transform.rotation.z,
    scaleX: transform.scale.x,
    scaleY: transform.scale.y,
    scaleZ: transform.scale.z,
  }
}

/** Read a saved record's transform back out into {@link PlacedTransform} form. */
export function transformOf(obj: EditorPlacedObject): PlacedTransform {
  return {
    position: { x: obj.x, y: obj.y, z: obj.z },
    rotation: { x: obj.rotationX, y: obj.rotationY, z: obj.rotationZ },
    scale: { x: obj.scaleX, y: obj.scaleY, z: obj.scaleZ },
  }
}
