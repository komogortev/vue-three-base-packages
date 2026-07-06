// THROWAWAY diagnostic — isolates why computedGrounded() flipped false in the
// wrapper path. Two suspects: (a) updateSceneQueries() called BEFORE vs AFTER the
// character capsule exists, (b) TriMeshFlags.FIX_INTERNAL_EDGES on the floor.
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

const R = 0.3
const HH = 0.6
const STAND = HH + R
const fv = [-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]
// normal-DOWN winding (−y) vs normal-UP winding (+y) for a y=0 floor
const fiDown = [0, 1, 2, 0, 2, 3]
const fiUp = [0, 2, 1, 0, 3, 2]

function run(flag, windUp) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const verts = new Float32Array(fv)
  const idx = new Uint32Array(windUp ? fiUp : fiDown)
  const desc = flag
    ? RAPIER.ColliderDesc.trimesh(verts, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
    : RAPIER.ColliderDesc.trimesh(verts, idx)
  w.createCollider(desc, body)

  const cap = w.createCollider(RAPIER.ColliderDesc.capsule(HH, R))
  const cc = w.createCharacterController(0.01)
  cc.setUp({ x: 0, y: 1, z: 0 })
  cc.enableSnapToGround(0.3)
  cc.enableAutostep(0.3, 0.1, false)
  cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180)
  cc.setMinSlopeSlideAngle((30 * Math.PI) / 180)
  w.updateSceneQueries()

  cap.setTranslation({ x: 0, y: STAND + 0.1, z: 0 })
  cc.computeColliderMovement(cap, { x: 0, y: -0.2, z: 0 })
  const m = cc.computedMovement()
  console.log(
    `  flag=${flag ? 'FIX_INTERNAL_EDGES' : 'plain            '}  winding=${windUp ? 'UP (+y)  ' : 'DOWN (−y)'}  =>  grounded=${String(cc.computedGrounded()).padEnd(5)}  mv.y=${m.y.toFixed(4)}`,
  )
  w.free()
}

console.log('isolation matrix (capsule falls onto flat floor, expect grounded=true):')
for (const flag of [false, true]) for (const windUp of [false, true]) run(flag, windUp)
