import type * as THREE from 'three'

/**
 * Result of a sphere-vs-geometry penetration query.
 * Matches the shape of CollisionResult in dbox's WallCollider.ts so
 * DboxCharacterEntity can swap in physics queries without changing its resolve logic.
 */
export interface PenetrationResult {
  /** Unit vector pointing away from the surface (push-out direction). */
  normal: THREE.Vector3
  /** How far the sphere centre is inside the surface (> 0 means penetrating). */
  depth: number
}

/** Opaque handle to a collider registered in a PhysicsWorld. */
export type ColliderHandle = { readonly __brand: 'ColliderHandle'; readonly _handle: number }

/**
 * Result of a swept (continuous) sphere cast — see `PhysicsWorld.shapeCastSphere`.
 * Anti-tunnelling companion to {@link PenetrationResult}: catches a thin surface
 * crossed within a single fast tick that an overlap test would miss.
 */
export interface ShapeCastResult {
  /**
   * Fraction along the `from → to` segment at first contact, in `[0, 1]`.
   * The contact point is `from.lerp(to, toi)`.
   */
  toi: number
  /** Unit world-space surface normal at the contact (push-out direction). */
  normal: THREE.Vector3
}
