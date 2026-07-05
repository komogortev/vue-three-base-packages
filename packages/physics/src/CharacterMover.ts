import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { CharacterMoverProfile, MoveResult } from './types'

/**
 * Kinematic character mover — wraps a Rapier `KinematicCharacterController` plus
 * its capsule collider and resolves caller-driven motion against the static
 * geometry registered in a {@link PhysicsWorld}.
 *
 * One {@link move} call performs collide-and-slide, autostep, snap-to-ground and
 * slope handling in a single pass and returns ONE corrected delta — collapsing a
 * "two position-writer" architecture into a single authority. The caller still
 * owns *desired* motion + gravity (e.g. a carry-impulse model); the mover only
 * *corrects* it. It never simulates rigid-body dynamics — the controller is
 * purely kinematic resolution.
 *
 * Construct via {@link PhysicsWorld.createCharacterMover}. Static obstacle geometry
 * must be registered on the host world (via `addStaticMesh`, which runs
 * `updateSceneQueries()` — required for the controller to see obstacles in this
 * never-stepped world). Register ALL static geometry BEFORE creating movers: the
 * mover's capsule is a live collider in the shared world, so an `addStaticMesh`
 * call made after mover creation indexes the capsule into the query pipeline and
 * subsequent `spherePenetration`/`castRayDown`/`shapeCastSphere` calls can hit the
 * character's own capsule. (The KCC itself always excludes its own collider.)
 *
 * Behaviour verified against the never-stepped trimesh world in the S0 spike
 * (`three-dbox/docs/PLAN-EX-NAV-RESOLVER-2026-06-19.md` §7): grounding, smooth
 * autostep up, smooth snap-to-ground down, collide-and-slide, and anti-tunnelling
 * of large single-tick displacements (swept by construction).
 */
export class CharacterMover {
  private readonly _world: RAPIER.World
  private readonly _collider: RAPIER.Collider
  private readonly _controller: RAPIER.KinematicCharacterController
  private _disposed = false

  /** @internal Construct via {@link PhysicsWorld.createCharacterMover}. */
  constructor(world: RAPIER.World, profile: CharacterMoverProfile) {
    this._world = world

    // Parentless capsule collider — the controller moves it kinematically; it is
    // never driven by simulation (this world is never stepped).
    this._collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(profile.capsuleHalfHeight, profile.capsuleRadius),
    )

    try {
      const cc = world.createCharacterController(profile.offset ?? 0.01)
      cc.setUp({ x: 0, y: 1, z: 0 })
      // Kinematic resolution only — never transfer momentum into dynamic bodies.
      cc.setApplyImpulsesToDynamicBodies(false)

      const maxStepUp = profile.maxStepUp ?? 0
      if (maxStepUp > 0) cc.enableAutostep(maxStepUp, profile.minStepWidth ?? 0.1, false)

      const snap = profile.snapToGroundDistance ?? 0
      if (snap > 0) cc.enableSnapToGround(snap)

      cc.setMaxSlopeClimbAngle(((profile.slopeClimbDeg ?? 45) * Math.PI) / 180)
      cc.setMinSlopeSlideAngle(((profile.slopeSlideDeg ?? 30) * Math.PI) / 180)
      this._controller = cc
    } catch (e) {
      // Don't leave an orphan capsule registered in the world if controller setup
      // fails — remount-heavy consumers would accumulate them until world.free().
      world.removeCollider(this._collider, false)
      throw e
    }
  }

  /**
   * Resolve one tick. `currentPos` is the capsule CENTRE in world space; `desired`
   * is this tick's desired translation delta — typically `(carry + input + gravity) · dt`.
   * Apply the returned `applied` delta to the character's position and write once.
   *
   * @returns a fresh {@link MoveResult} (safe to retain across frames).
   */
  move(currentPos: THREE.Vector3, desired: THREE.Vector3): MoveResult {
    this._collider.setTranslation({ x: currentPos.x, y: currentPos.y, z: currentPos.z })
    this._controller.computeColliderMovement(this._collider, {
      x: desired.x,
      y: desired.y,
      z: desired.z,
    })
    const m = this._controller.computedMovement()
    return {
      applied: new THREE.Vector3(m.x, m.y, m.z),
      grounded: this._controller.computedGrounded(),
      collisions: this._controller.numComputedCollisions(),
    }
  }

  /** Release the controller + capsule collider. Call before disposing the host PhysicsWorld. Idempotent. */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._world.removeCharacterController(this._controller)
    this._world.removeCollider(this._collider, false)
  }
}
