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
