import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { ColliderHandle, PenetrationResult } from './types'
import { extractTrimesh } from './extractTrimesh'

// Promise-cache guard — safe against concurrent PhysicsWorld.create() calls.
let rapierInitPromise: Promise<void> | null = null

function initRapier(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init()
  }
  return rapierInitPromise
}

/**
 * Wraps a Rapier physics world scoped to static collision geometry.
 *
 * Usage pattern:
 *   const world = await PhysicsWorld.create()
 *   world.addStaticMesh(gltf.scene)              // register OW map GLB
 *   const hit = world.spherePenetration(pos, r)  // query each tick
 *   world.dispose()                              // on unmount
 *
 * No simulation stepping — this world is query-only. Dynamic bodies and
 * gravity are not used; the PlayerController carry system stays unchanged.
 */
export class PhysicsWorld {
  private readonly _world: RAPIER.World

  private constructor(world: RAPIER.World) {
    this._world = world
  }

  static async create(): Promise<PhysicsWorld> {
    await initRapier()
    // Zero gravity — world is query-only, no simulation stepping needed.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    return new PhysicsWorld(world)
  }

  /**
   * Register a loaded GLB scene as static trimesh collision geometry.
   * All Mesh children (excluding SkinnedMesh) are merged into one trimesh
   * with world transforms applied. Safe to call multiple times for multiple assets.
   *
   * @throws {Error} if root contains no renderable mesh geometry.
   */
  addStaticMesh(root: THREE.Object3D): ColliderHandle {
    const { vertices, indices } = extractTrimesh(root)
    const body = this._world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const collider = this._world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices),
      body,
    )
    return { __brand: 'ColliderHandle', _handle: collider.handle } as ColliderHandle
  }

  /**
   * Test whether a sphere at `center` with `radius` penetrates any registered
   * static geometry. Returns the push-out normal and depth, or null if clear.
   *
   * Two-step: `intersectionWithShape` detects true sphere/trimesh overlap;
   * `projectPoint` supplies the push-out direction.
   *
   * Known limitation: if the player clips fully through a thin surface in one
   * tick (possible at >2×radius/tick), the push-out normal may be inverted.
   * This matches the existing WallCollider behaviour and is acceptable for V1.
   */
  spherePenetration(center: THREE.Vector3, radius: number): PenetrationResult | null {
    const pos = { x: center.x, y: center.y, z: center.z }
    const rot = { x: 0, y: 0, z: 0, w: 1 }

    // Step 1 — true sphere/trimesh overlap (not point proximity).
    const overlap = this._world.intersectionWithShape(pos, rot, new RAPIER.Ball(radius))
    if (!overlap) return null

    // Step 2 — nearest surface point → push-out direction + depth.
    const proj = this._world.projectPoint(pos, false)
    if (!proj) return null

    const nearest = new THREE.Vector3(proj.point.x, proj.point.y, proj.point.z)
    const offset = center.clone().sub(nearest)
    const dist = offset.length()

    if (dist < 1e-6) return null  // centre exactly on surface — direction undefined

    return {
      normal: offset.divideScalar(dist),
      depth: radius - dist,
    }
  }

  dispose(): void {
    this._world.free()
  }
}
