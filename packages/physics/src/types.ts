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

/**
 * Configuration for a {@link CharacterMover}'s Rapier KinematicCharacterController
 * and its capsule collider. Capsule dimensions are required; tuning knobs are
 * optional and default to sane locomotion values (resolved in the CharacterMover
 * constructor), so a consumer may pass only the capsule and still get
 * collide-and-slide + grounding.
 *
 * Each tuning field maps 1:1 to a Rapier KCC setter — this is the data-driven
 * surface that replaces movement constants scattered across the consumer.
 */
export interface CharacterMoverProfile {
  /** Capsule radius (m). Drives `ColliderDesc.capsule` + the KCC character width. */
  capsuleRadius: number
  /** Half-height of the capsule's CYLINDER section (m), excluding the hemispherical caps. */
  capsuleHalfHeight: number
  /** Skin gap kept between the capsule and geometry. Default `0.01`. (`createCharacterController` offset) */
  offset?: number
  /** Max step height auto-climbed (m). `0`/omitted disables autostep. (`enableAutostep` maxHeight) */
  maxStepUp?: number
  /** Min free width required atop a step (m). Default `0.1`. (`enableAutostep` minWidth) */
  minStepWidth?: number
  /**
   * Distance below the feet within which the character snaps to ground (m) — the
   * down-stairs / down-slope mechanism. `0`/omitted disables. (`enableSnapToGround`)
   */
  snapToGroundDistance?: number
  /** Max floor angle the character can climb (deg). Default `45`. (`setMaxSlopeClimbAngle`) */
  slopeClimbDeg?: number
  /** Min floor angle at which the character slides back down (deg). Default `30`. (`setMinSlopeSlideAngle`) */
  slopeSlideDeg?: number
}

/**
 * Result of one {@link CharacterMover.move} resolve.
 */
export interface MoveResult {
  /** Collision-corrected translation delta to add to the character's position this tick (one write). */
  applied: THREE.Vector3
  /** True if ground was detected beneath the character after the move — feed jump reset + grounded animation. */
  grounded: boolean
  /**
   * Number of obstacle contacts detected along the path. Includes ground contacts,
   * so a non-zero value on flat floor is normal — use for debug/telemetry, not as
   * an error signal.
   */
  collisions: number
}
