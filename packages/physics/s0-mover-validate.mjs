// THROWAWAY. Validates the COMPILED @base/physics CharacterMover wrapper (dist/)
// end-to-end in the never-stepped world — proves the class dbox will import
// actually runs (THREE.Vector3 in/out contract, autostep, snap, dispose), not
// just raw KCC (which s0-kcc-spike.mjs already proved). Run from the package dir.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { CharacterMover } from './dist/CharacterMover.js'

await RAPIER.init()

const R = 0.3
const HH = 0.6
const STAND_Y = HH + R
const results = []
const check = (n, c, d) => {
  results.push({ n, pass: !!c })
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? `   — ${d}` : ''}`)
}

// Up-facing (+y normal) winding — required for grounded detection under FIX_INTERNAL_EDGES.
const quadXZ = (x0, x1, z0, z1, y) => ({ v: [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], i: [0, 2, 1, 0, 3, 2] })
const quadX = (X, y0, y1, z0, z1) => ({ v: [X, y0, z0, X, y1, z0, X, y1, z1, X, y0, z1], i: [0, 1, 2, 0, 2, 3] })
function merge(parts) {
  const v = []
  const idx = []
  for (const p of parts) {
    const b = v.length / 3
    v.push(...p.v)
    for (const k of p.i) idx.push(b + k)
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) }
}
// Mirrors PhysicsWorld.addStaticMesh({ fixInternalEdges: true }) + never-stepped query refresh.
function buildWorld(parts) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const { vertices, indices } = merge(parts)
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  w.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES), body)
  w.updateSceneQueries()
  return w
}
const profile = {
  capsuleRadius: R,
  capsuleHalfHeight: HH,
  offset: 0.01,
  maxStepUp: 0.3,
  minStepWidth: 0.1,
  snapToGroundDistance: 0.3,
  slopeClimbDeg: 45,
  slopeSlideDeg: 30,
}
function walk(mover, start, per, ticks) {
  const pos = new THREE.Vector3(start.x, start.y, start.z)
  const d = new THREE.Vector3(per.x, per.y, per.z)
  let grounded = false
  const ys = []
  for (let t = 0; t < ticks; t++) {
    const r = mover.move(pos, d)
    pos.add(r.applied) // exercises the THREE.Vector3 return contract
    grounded = r.grounded
    ys.push(pos.y)
  }
  return { pos, grounded, ys }
}

console.log('— wrapper: grounding + return contract —')
{
  const w = buildWorld([quadXZ(-5, 5, -5, 5, 0)])
  const m = new CharacterMover(w, profile)
  const r = m.move(new THREE.Vector3(0, STAND_Y + 0.1, 0), new THREE.Vector3(0, -0.2, 0))
  check('applied is a THREE.Vector3', r.applied instanceof THREE.Vector3, `(${r.applied.x.toFixed(3)}, ${r.applied.y.toFixed(3)}, ${r.applied.z.toFixed(3)})`)
  check('grounded on floor', r.grounded === true)
  check('finite + caught the fall', Number.isFinite(r.applied.y) && r.applied.y < 0 && r.applied.y > -0.2, `y=${r.applied.y.toFixed(4)}`)
  m.dispose()
  w.free()
}

console.log('— wrapper: autostep up 0.25 m —')
{
  const w = buildWorld([quadXZ(-5, 1, -5, 5, 0), quadX(1, 0, 0.25, -5, 5), quadXZ(1, 5, -5, 5, 0.25)])
  const m = new CharacterMover(w, profile)
  const r = walk(m, { x: 0.5, y: STAND_Y, z: 0 }, { x: 0.1, y: -0.05, z: 0 }, 14)
  console.log(`    Y: ${r.ys.map((y) => y.toFixed(2)).join(' ')}`)
  check('climbed onto upper tread (y > 1.10)', r.pos.y > 1.1, `y=${r.pos.y.toFixed(3)}`)
  m.dispose()
  w.free()
}

console.log('— wrapper: snap-to-ground down 0.25 m —')
{
  const w = buildWorld([quadXZ(-5, 2, -5, 5, 0), quadXZ(2, 5, -5, 5, -0.25)])
  const m = new CharacterMover(w, profile)
  const r = walk(m, { x: 1.5, y: STAND_Y, z: 0 }, { x: 0.1, y: -0.05, z: 0 }, 15)
  console.log(`    Y: ${r.ys.map((y) => y.toFixed(2)).join(' ')}`)
  check('snapped onto lower floor (y < 0.72)', r.pos.y < 0.72, `y=${r.pos.y.toFixed(3)}`)
  check('grounded after drop', r.grounded === true)
  m.dispose()
  w.free()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n==== MOVER WRAPPER: ${results.length - failed.length}/${results.length} passed ====`)
process.exit(failed.length ? 1 : 0)
