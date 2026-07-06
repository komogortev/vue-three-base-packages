import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type {
  ColliderHandle,
  PenetrationResult,
  ShapeCastResult,
  CharacterMoverProfile,
} from './types'
import { extractTrimesh } from './extractTrimesh'
import { CharacterMover } from './CharacterMover'

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
   * @param filter - optional predicate passed to {@link extractTrimesh}; return false
   *   to exclude a mesh (e.g. `mesh => !/^smd_bone_vis/i.test(mesh.name)` to strip
   *   OWLib rig-visualization helpers before registering with Rapier).
   * @param opts.fixInternalEdges - build the trimesh with `TriMeshFlags.FIX_INTERNAL_EDGES`,
   *   which suppresses spurious "ghost" contact normals on the shared edges between
   *   adjacent triangles (e.g. tile seams on an OW floor). Recommended when a swept
   *   shape — like {@link CharacterMover}'s capsule — traverses the mesh, where ghost
   *   normals cause stumbles/snags. Off by default to keep existing query results
   *   (`spherePenetration`/`shapeCastSphere`/`castRayDown`) byte-identical.
   *   CAVEAT (verified in the S0 spike): this flag makes the mesh winding-aware, so
   *   {@link CharacterMover}'s ground detection then requires outward/up-facing
   *   triangle winding — inverted winding silently yields `grounded=false` while
   *   collide-and-slide/snap stay correct. GLB exports are normally wound correctly;
   *   confirm `grounded` reads true on the real mesh's floor when enabling. Plain
   *   trimesh (flag off) reports grounded correctly regardless of winding.
   * @throws {Error} if root contains no renderable mesh geometry after filtering.
   */
  addStaticMesh(
    root: THREE.Object3D,
    filter?: (mesh: THREE.Mesh) => boolean,
    opts?: { fixInternalEdges?: boolean },
  ): ColliderHandle {
    const { vertices, indices } = extractTrimesh(root, filter)
    const body = this._world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const desc = opts?.fixInternalEdges
      ? RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      : RAPIER.ColliderDesc.trimesh(vertices, indices)
    const collider = this._world.createCollider(desc, body)
    // Refresh the query pipeline so swept casts (`shapeCastSphere`) see the new
    // collider. This world is never stepped, so without an explicit update the
    // query pipeline stays empty for shape casts. (`spherePenetration` /
    // `castRayDown` happen to work pre-update, but `castShape` requires it.)
    this._world.updateSceneQueries()
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

  /**
   * Cast a ray downward from (x, fromY, z) and return the Y of the first hit, or null.
   * Useful for spawn grounding and Rapier-backed terrain sampling on OW map geometry.
   *
   * @param solid false — only detects surface crossings (correct for above-ground queries).
   */
  castRayDown(x: number, z: number, fromY: number): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 })
    const hit = this._world.castRay(ray, fromY + 500, false)
    if (!hit) return null
    return fromY - hit.timeOfImpact
  }

  /**
   * Swept sphere cast from `from` to `to` (radius `radius`). Returns the first
   * contact with registered static geometry as a fraction along the segment plus
   * the world-space surface normal, or null if the path is clear.
   *
   * Anti-tunnelling companion to {@link spherePenetration}: a sphere moving faster
   * than ~2×radius/tick can pass fully through a thin wall in one step, which the
   * overlap test misses. Sweep the motion instead and stop at the contact.
   *
   * The static body is created at the origin with identity rotation and world-space
   * vertices ({@link addStaticMesh}), so the collider's local frame equals world
   * space — `normal` is returned directly as a world-space push-out direction.
   */
  shapeCastSphere(from: THREE.Vector3, to: THREE.Vector3, radius: number): ShapeCastResult | null {
    const vx = to.x - from.x
    const vy = to.y - from.y
    const vz = to.z - from.z
    // No motion → nothing to sweep (a zero velocity is undefined for castShape).
    if (vx === 0 && vy === 0 && vz === 0) return null

    const hit = this._world.castShape(
      { x: from.x, y: from.y, z: from.z }, // shapePos — sweep start
      { x: 0, y: 0, z: 0, w: 1 },          // shapeRot — identity (sphere is rotation-invariant)
      { x: vx, y: vy, z: vz },             // shapeVel — full displacement
      new RAPIER.Ball(radius),
      0,     // targetDistance — register a hit at surface contact
      1,     // maxToi — velocity is the whole displacement, so toi ∈ [0, 1]
      false, // stopAtPenetration — skip an initial graze; report the crossing
    )
    if (!hit) return null

    // `normal2` is the contact normal on the static collider (world-space, body at
    // origin). Rapier's sign for a shape cast is not guaranteed to face the caster,
    // so flip it to oppose the sweep direction — then it is always a valid push-out
    // / slide normal, matching `spherePenetration`'s outward convention.
    const normal = new THREE.Vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z)
    if (normal.x * vx + normal.y * vy + normal.z * vz > 0) normal.negate()
    return { toi: hit.time_of_impact, normal }
  }

  /**
   * Create a kinematic {@link CharacterMover} bound to this world's static geometry.
   * The mover owns a capsule collider + Rapier `KinematicCharacterController` and
   * resolves caller-driven motion (collide-and-slide + autostep + snap-to-ground +
   * slope) into a single corrected delta per tick. Register static geometry with
   * {@link addStaticMesh} (which runs `updateSceneQueries()`) before `mover.move()`.
   * Call `mover.dispose()` before {@link dispose}.
   */
  createCharacterMover(profile: CharacterMoverProfile): CharacterMover {
    return new CharacterMover(this._world, profile)
  }

  dispose(): void {
    this._world.free()
  }
}
