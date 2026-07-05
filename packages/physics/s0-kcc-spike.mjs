// ============================================================================
// S0 SPIKE — THROWAWAY. Proves Rapier's KinematicCharacterController behaves in
// the @base/physics world model: zero-gravity, NEVER stepped, trimesh-only,
// queries refreshed with updateSceneQueries() (no world.step()).
//
// Plan of record: three-dbox/docs/PLAN-EX-NAV-RESOLVER-2026-06-19.md §7 (S0).
// Gates ND-0 ("does KCC work in our never-stepped query world?") + confirms the
// down-stairs (snapToGround) and anti-tunnelling (swept) claims the plan rides on.
//
// Run:  node s0-kcc-spike.mjs        (from SHARED/packages/physics/)
// Geometry is synthetic + deterministic on purpose — Château-specific quirks are
// an S1 browser concern; S0 only proves the KCC mechanics in our world model.
// ============================================================================
import RAPIER from '@dimforge/rapier3d-compat'

await RAPIER.init()

// ---- capsule + KCC constants (dbox-ish: ~1.8 m tall player) -----------------
const R = 0.30 // capsule radius
const HH = 0.60 // capsule half-height (cylinder section)
const STAND_Y = HH + R // centre Y so the capsule bottom rests on a y=0 floor → 0.90
const OFFSET = 0.01 // KCC skin (createCharacterController offset)

// ---- result accounting ------------------------------------------------------
const results = []
function check(name, cond, detail) {
  results.push({ name, pass: !!cond })
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `   — ${detail}` : ''}`)
}
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
const fmt = (v) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`

// ---- trimesh helpers (winding irrelevant — Rapier trimesh collision is two-sided)
function quadXZ(x0, x1, z0, z1, y) {
  return { v: [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], i: [0, 1, 2, 0, 2, 3] }
}
function quadX(X, y0, y1, z0, z1) {
  // vertical wall in the plane x = X
  return { v: [X, y0, z0, X, y1, z0, X, y1, z1, X, y0, z1], i: [0, 1, 2, 0, 2, 3] }
}
function merge(parts) {
  const verts = []
  const idx = []
  for (const p of parts) {
    const base = verts.length / 3
    verts.push(...p.v)
    for (const k of p.i) idx.push(base + k)
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) }
}

// Build a fresh world that mirrors PhysicsWorld: zero gravity, static trimesh,
// parentless capsule + KCC. `update`/`step` control the never-stepped probe (T0).
function buildScene(parts, { update = true, step = false } = {}) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const { vertices, indices } = merge(parts)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body)

  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HH, R))
  const cc = world.createCharacterController(OFFSET)
  cc.setUp({ x: 0, y: 1, z: 0 })
  cc.enableAutostep(0.30, 0.10, false)
  cc.enableSnapToGround(0.30)
  cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180)
  cc.setMinSlopeSlideAngle((30 * Math.PI) / 180)

  if (update) world.updateSceneQueries()
  if (step) world.step()
  return { world, collider, cc }
}

// One kinematic resolve: sync capsule to current pos, compute, read results.
function move(scene, pos, delta) {
  scene.collider.setTranslation({ x: pos.x, y: pos.y, z: pos.z })
  scene.cc.computeColliderMovement(scene.collider, delta)
  const m = scene.cc.computedMovement()
  return {
    mv: { x: m.x, y: m.y, z: m.z },
    grounded: scene.cc.computedGrounded(),
    collisions: scene.cc.numComputedCollisions(),
  }
}

// Iterative walk — how the real game loop drives it: apply per-tick desired,
// accumulate the corrected movement into position. Returns final pos + a Y trace.
function walk(scene, startPos, perTick, ticks) {
  let pos = { ...startPos }
  let grounded = false
  const yTrace = []
  for (let t = 0; t < ticks; t++) {
    const r = move(scene, pos, perTick)
    pos = { x: pos.x + r.mv.x, y: pos.y + r.mv.y, z: pos.z + r.mv.z }
    grounded = r.grounded
    yTrace.push(pos.y)
  }
  return { pos, grounded, yTrace }
}
const traceStr = (ys) => ys.map((y) => y.toFixed(2)).join(' ')

const FLOOR = quadXZ(-5, 5, -5, 5, 0)

// ============================================================================
// T0 — THE CRUX (ND-0): in a never-stepped world, what does KCC need to see the
// floor? Print all three regimes; do not assert — this is the diagnostic.
// ============================================================================
console.log('\n— T0  never-stepped probe: capsule resting on floor, desired = down 0.05 —')
for (const cfg of [
  ['no update, no step      ', { update: false, step: false }],
  ['updateSceneQueries() only', { update: true, step: false }],
  ['world.step() once        ', { update: false, step: true }],
]) {
  const s = buildScene([FLOOR], cfg[1])
  const r = move(s, { x: 0, y: STAND_Y, z: 0 }, { x: 0, y: -0.05, z: 0 })
  console.log(`    [${cfg[0]}]  grounded=${String(r.grounded).padEnd(5)}  mv=${fmt(r.mv)}  collisions=${r.collisions}`)
  s.world.free()
}

// ============================================================================
// T1 — fall + ground: start 0.10 above floor, pull down 0.20. Must catch (not
// tunnel) and report grounded. (updateSceneQueries-only path from here on.)
// ============================================================================
console.log('\n— T1  fall onto floor and ground —')
{
  const s = buildScene([FLOOR])
  const r = move(s, { x: 0, y: STAND_Y + 0.1, z: 0 }, { x: 0, y: -0.2, z: 0 })
  check('T1 movement finite (no NaN)', finite(r.mv), fmt(r.mv))
  check('T1 grounded === true', r.grounded === true, `grounded=${r.grounded}`)
  check('T1 descended but caught (−0.2 < mv.y < 0)', r.mv.y < 0 && r.mv.y > -0.2, `mv.y=${r.mv.y.toFixed(4)}`)
  s.world.free()
}

// ============================================================================
// T2 — flat walk: horizontal preserved, grounded, no spurious collisions.
// ============================================================================
console.log('\n— T2  flat walk (10 ticks) —')
{
  const s = buildScene([FLOOR])
  const w = walk(s, { x: 0, y: STAND_Y, z: 0 }, { x: 0.1, y: -0.05, z: 0 }, 10)
  check('T2 finite', Number.isFinite(w.pos.x) && Number.isFinite(w.pos.y), fmt(w.pos))
  check('T2 grounded throughout', w.grounded === true, `grounded=${w.grounded}`)
  check('T2 advanced ~1.0 in x (> 0.9)', w.pos.x > 0.9, `x=${w.pos.x.toFixed(3)}`)
  check('T2 Y stayed on floor (|y−0.9| < 0.05)', Math.abs(w.pos.y - STAND_Y) < 0.05, `y=${w.pos.y.toFixed(3)}`)
  // NB: numComputedCollisions counts ground contacts too — not an error signal.
  s.world.free()
}

// ============================================================================
// T3 — AUTOSTEP (up-stairs): 0.25 m step < maxStepUp 0.30 → climb in one resolve.
//   lower floor [-5,1]@0 · riser wall x=1 [0,0.25] · upper floor [1,5]@0.25
// ============================================================================
console.log('\n— T3  autostep UP a 0.25 m step (iterative walk into it) —')
{
  const parts = [quadXZ(-5, 1, -5, 5, 0), quadX(1, 0, 0.25, -5, 5), quadXZ(1, 5, -5, 5, 0.25)]
  const s = buildScene(parts)
  const w = walk(s, { x: 0.5, y: STAND_Y, z: 0 }, { x: 0.1, y: -0.05, z: 0 }, 14)
  console.log(`    Y trace: ${traceStr(w.yTrace)}`)
  check('T3 finite', Number.isFinite(w.pos.y), fmt(w.pos))
  check('T3 climbed onto upper tread (y ≈ 1.15, > 1.10)', w.pos.y > 1.1, `y=${w.pos.y.toFixed(3)}`)
  check('T3 advanced past the riser (x > 1.3)', w.pos.x > 1.3, `x=${w.pos.x.toFixed(3)}`)
  check('T3 grounded on top', w.grounded === true, `grounded=${w.grounded}`)
  s.world.free()
}

// ============================================================================
// T4 — SNAP-TO-GROUND (down-stairs): the "missing mechanism" the plan rides on.
//   upper floor [-5,2]@0 · lower floor [2,5]@−0.25 (drop 0.25 < snap 0.30)
//   walk fully past the edge → must be pulled down onto the lower floor.
// ============================================================================
console.log('\n— T4  snap-to-ground DOWN a 0.25 m drop (iterative, real per-tick steps) —')
{
  const parts = [quadXZ(-5, 2, -5, 5, 0), quadXZ(2, 5, -5, 5, -0.25)]
  const s = buildScene(parts)
  const w = walk(s, { x: 1.5, y: STAND_Y, z: 0 }, { x: 0.1, y: -0.05, z: 0 }, 15)
  console.log(`    Y trace: ${traceStr(w.yTrace)}`)
  // feet rest on lower floor (y=−0.25) → centre ≈ 0.65
  check('T4 finite', Number.isFinite(w.pos.y), fmt(w.pos))
  check('T4 grounded after the drop', w.grounded === true, `grounded=${w.grounded}`)
  check('T4 snapped onto lower floor (y ≈ 0.65, < 0.72)', w.pos.y < 0.72, `y=${w.pos.y.toFixed(3)}`)
  check('T4 walked past the edge (x > 2.5)', w.pos.x > 2.5, `x=${w.pos.x.toFixed(3)}`)
  s.world.free()
}

// ============================================================================
// T5 — wall block + slide: collide-and-slide is inside computeColliderMovement.
//   floor + wall x=1 [0,2]. Push into wall + along z.
// ============================================================================
console.log('\n— T5  wall block + slide —')
{
  const parts = [FLOOR, quadX(1, 0, 2, -5, 5)]
  const s = buildScene(parts)
  const r = move(s, { x: 0.5, y: STAND_Y, z: 0 }, { x: 0.5, y: -0.05, z: 0.2 })
  check('T5 finite', finite(r.mv), fmt(r.mv))
  check('T5 reports collision', r.collisions > 0, `collisions=${r.collisions}`)
  check('T5 blocked into wall (mv.x < 0.25)', r.mv.x < 0.25, `mv.x=${r.mv.x.toFixed(4)}`)
  check('T5 slid along wall (mv.z > 0.1)', r.mv.z > 0.1, `mv.z=${r.mv.z.toFixed(4)}`)
  s.world.free()
}

// ============================================================================
// T5b — ANTI-TUNNEL (the EX-2.1 question): one giant tick (3 m, ≈152 m/s punch)
// straight into the wall. KCC is swept by construction → must NOT pass through.
// If this holds, the plan's "EX-2.1 shapeCastSphere likely deleted" is confirmed.
// ============================================================================
console.log('\n— T5b  anti-tunnel: 3 m single-tick punch into wall —')
{
  const parts = [FLOOR, quadX(1, 0, 2, -5, 5)]
  const s = buildScene(parts)
  const r = move(s, { x: 0.5, y: STAND_Y, z: 0 }, { x: 3.0, y: 0, z: 0 })
  check('T5b finite', finite(r.mv), fmt(r.mv))
  check('T5b did NOT tunnel (mv.x < 0.5)', r.mv.x < 0.5, `mv.x=${r.mv.x.toFixed(4)}`)
  check('T5b reports collision', r.collisions > 0, `collisions=${r.collisions}`)
  s.world.free()
}

// ---- verdict ----------------------------------------------------------------
const failed = results.filter((r) => !r.pass)
console.log(`\n==== S0 RESULT: ${results.length - failed.length}/${results.length} assertions passed ====`)
if (failed.length) {
  console.log(`GO/NO-GO: ⛔ NO-GO — failing: ${failed.map((f) => f.name).join('; ')}`)
  process.exit(1)
}
console.log('GO/NO-GO: ✅ GO — KCC resolves movement in the never-stepped trimesh query world')
