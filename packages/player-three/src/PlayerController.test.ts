import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import type { TerrainSurfaceSampler } from './terrainSurface'
import { PlayerController, sampleTerrainFootprintY } from './PlayerController'

describe('PlayerController', () => {
  function setupCameraAtOriginLookingDownMinusZ(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100)
    camera.position.set(0, 2, 0)
    camera.lookAt(0, 0, -10)
    camera.updateMatrixWorld(true)
    return camera
  }

  it('does not move when move intent is zero', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 10 })
    ctrl.setMoveIntent(0, 0)
    ctrl.tick(1 / 60, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    expect(character.position.x).toBeCloseTo(0)
    expect(character.position.z).toBeCloseTo(0)
    const snap = ctrl.getSnapshot()
    expect(snap.velocity.x).toBe(0)
    expect(snap.velocity.z).toBe(0)
  })

  it('moves camera-relative forward along -Z when camera faces -Z', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 6 })
    ctrl.setMoveIntent(0, 1)
    const delta = 0.5
    ctrl.tick(delta, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    expect(character.position.z).toBeLessThan(0)
    expect(character.position.x).toBeCloseTo(0, 5)
    const snap = ctrl.getSnapshot()
    expect(snap.velocity.z).toBeLessThan(0)
  })

  it('uses 0.5x strafe speed in camera-basis movement by default', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 6, movementBasis: 'camera' })
    const delta = 0.5

    ctrl.setMoveIntent(0, 1)
    ctrl.tick(delta, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    const forwardDistance = Math.abs(character.position.z)

    character.position.set(0, 0.85, 0)
    ctrl.setMoveIntent(1, 0)
    ctrl.tick(delta, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    const strafeDistance = Math.abs(character.position.x)

    expect(strafeDistance).toBeCloseTo(forwardDistance * 0.5, 5)
  })

  it('sets jumpBuffered after notifyJumpPressed and clears after buffer duration', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 1 })
    expect(ctrl.getSnapshot().jumpBuffered).toBe(false)

    ctrl.notifyJumpPressed(0.1)
    expect(ctrl.getSnapshot().jumpBuffered).toBe(true)

    ctrl.tick(0.05, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(ctrl.getSnapshot().jumpBuffered).toBe(true)

    ctrl.tick(0.06, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(ctrl.getSnapshot().jumpBuffered).toBe(false)
  })

  it('uses minimum terrain height inside footprint when radius > 0', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const sampler: TerrainSurfaceSampler = {
      sample(x: number, z: number) {
        if (Math.abs(x) < 0.01 && Math.abs(z) < 0.01) return 10
        return 3
      },
    }
    const ctrl = new PlayerController({
      characterSpeed: 1,
      terrainFootprintRadius: 0.2,
      terrainYOffset: 0,
    })
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.y).toBeCloseTo(3)
  })

  it('sampleTerrainFootprintY returns centre sample when radius is 0', () => {
    const sampler = { sample: () => 42 } satisfies TerrainSurfaceSampler
    expect(sampleTerrainFootprintY(sampler, 1, 2, 0)).toBe(42)
  })

  it('applies setTerrainYOffset when snapping to terrain', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Group()
    character.position.set(1, 0, 2)

    const ctrl = new PlayerController({ characterSpeed: 1 })
    ctrl.setTerrainYOffset(0)
    const sampler = { sample: (_x: number, _z: number) => 3 } satisfies TerrainSurfaceSampler
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.y).toBeCloseTo(3)

    ctrl.setTerrainYOffset(0.85)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.y).toBeCloseTo(3.85)
  })

  it('clamps position to playable disc edge', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(48, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 100, edgeMargin: 1.5 })
    ctrl.setMoveIntent(1, 0) // strafe right in camera space
    ctrl.tick(0.2, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    const limit = 50 - 1.5
    const dist = Math.hypot(character.position.x, character.position.z)
    expect(dist).toBeLessThanOrEqual(limit + 1e-5)
  })

  it('applies sprint speed multiplier when sprintHeld and not crouching', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({
      characterSpeed: 10,
      runSpeedMultiplier: 2,
      crouchSpeedMultiplier: 0.5,
    })
    ctrl.setMoveIntent(0, 1)
    const delta = 0.1
    const ctxBase = {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      crouchHeld: false,
    } as const

    ctrl.tick(delta, { ...ctxBase, sprintHeld: false })
    const zWalk = character.position.z

    character.position.set(0, 0.85, 0)
    ctrl.tick(delta, { ...ctxBase, sprintHeld: true })
    const zSprint = character.position.z

    expect(zSprint).toBeLessThan(zWalk)
    expect(ctrl.getSnapshot().sprinting).toBe(true)
  })

  it('crouch cancels sprint multiplier', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)

    const ctrl = new PlayerController({ characterSpeed: 10, runSpeedMultiplier: 2 })
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler: undefined,
      playableRadius: 50,
      sprintHeld: true,
      crouchHeld: true,
    })
    expect(ctrl.getSnapshot().crouching).toBe(true)
    expect(ctrl.getSnapshot().sprinting).toBe(false)
  })

  it('uses one extra jump in air when enabled', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)
    const sampler = { sample: () => 0 } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 1,
      terrainYOffset: 0,
      jumpVelocity: 7,
      gravity: 20,
      extraJumps: 1,
    })

    ctrl.notifyJumpPressed()
    ctrl.tick(1 / 60, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    ctrl.consumeEvents() // initial jump event

    let sawExtra = false
    for (let i = 0; i < 8; i += 1) {
      if (i === 2) ctrl.notifyJumpPressed()
      ctrl.tick(1 / 60, {
        camera,
        character,
        sampler,
        playableRadius: 50,
        sprintHeld: false,
        crouchHeld: false,
      })
      const events = ctrl.consumeEvents()
      if (events.some((e) => e.type === 'extra_jump_used')) sawExtra = true
    }

    expect(sawExtra).toBe(true)
  })

  it('does not use extra jump when canUseExtraJump returns false', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)
    const sampler = { sample: () => 0 } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 1,
      terrainYOffset: 0,
      jumpVelocity: 7,
      gravity: 20,
      extraJumps: 1,
      canUseExtraJump: () => false,
    })

    ctrl.notifyJumpPressed()
    ctrl.tick(1 / 60, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    ctrl.consumeEvents()

    ctrl.notifyJumpPressed()
    ctrl.tick(1 / 60, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    const events = ctrl.consumeEvents()
    expect(events.some((e) => e.type === 'extra_jump_used')).toBe(false)
  })

  it('emits jump and landed events in order', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0.85, 0)
    const sampler = { sample: () => 0 } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 1,
      terrainYOffset: 0,
      jumpVelocity: 6,
      gravity: 30,
    })

    ctrl.notifyJumpPressed()
    ctrl.tick(1 / 60, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    const first = ctrl.consumeEvents()
    expect(first[0]?.type).toBe('jump_started')

    let landed = false
    for (let i = 0; i < 120 && !landed; i += 1) {
      ctrl.tick(1 / 60, {
        camera,
        character,
        sampler,
        playableRadius: 50,
        sprintHeld: false,
        crouchHeld: false,
      })
      const events = ctrl.consumeEvents()
      landed = events.some((e) => e.type === 'landed')
    }

    expect(landed).toBe(true)
  })

  it('blocks steep step-up while grounded', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? 2 : 0),
    } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      maxStepUpHeight: 0.4,
    })
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    expect(character.position.z).toBeGreaterThan(0.2)
    expect(ctrl.getSnapshot().grounded).toBe(true)
    expect(ctrl.consumeEvents().some((e) => e.type === 'wall_stumble')).toBe(true)
  })

  it('catches at cliff edge while walking but falls while sprinting', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const walker = new THREE.Mesh()
    walker.position.set(0, 0, 0)
    const walkCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
    })
    walkCtrl.setMoveIntent(0, 1)
    walkCtrl.tick(0.1, {
      camera,
      character: walker,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(walker.position.z).toBeCloseTo(0, 5)
    expect(walkCtrl.getSnapshot().grounded).toBe(true)

    const sprinter = new THREE.Mesh()
    sprinter.position.set(0, 0, 0)
    const sprintCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
    })
    sprintCtrl.setMoveIntent(0, 1)
    sprintCtrl.tick(0.1, {
      camera,
      character: sprinter,
      sampler,
      playableRadius: 50,
      sprintHeld: true,
      crouchHeld: false,
    })
    expect(sprinter.position.z).toBeLessThan(-0.5)
    expect(sprintCtrl.getSnapshot().grounded).toBe(false)
  })

  it('emits edge_catch when walk movement is blocked by cliff drop', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
    })
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    const events = ctrl.consumeEvents()
    expect(events.some((e) => e.type === 'edge_catch')).toBe(true)
  })

  it('detects delayed drop ahead using multi-point cliff probes', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.4 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 2,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
    })
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    // Old "single next-step sample" logic would miss this first frame (next z ~= -0.2).
    expect(character.position.z).toBeCloseTo(0, 5)
    const events = ctrl.consumeEvents()
    expect(events.some((e) => e.type === 'edge_catch')).toBe(true)
  })

  it('re-triggers edge_catch while holding into a warned pit', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const ctrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
    })
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(ctrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(true)

    ctrl.tick(0.2, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(ctrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(true)
  })

  it('allows pit bypass after release, then re-arms warning after timeout', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const ctrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      cliffEdgeReleaseBypassSeconds: 2,
    })

    // First push: warning blocks and emits edge catch.
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.z).toBeCloseTo(0, 5)
    expect(ctrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(true)

    // Release arms bypass window.
    ctrl.setMoveIntent(0, 0)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    ctrl.consumeEvents()

    // Re-push within bypass: allowed and transitions to falling.
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.z).toBeLessThan(-0.5)
    expect(ctrl.getSnapshot().grounded).toBe(false)
    expect(ctrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(false)

    // Land back on top and wait out bypass, then warning should block again.
    character.position.set(0, 0, 0)
    ctrl.resetFacing(0)
    ctrl.tick(2.2, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    ctrl.consumeEvents()
    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.z).toBeCloseTo(0, 5)
    expect(ctrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(true)
  })

  it('fails jump onto ledge above hips and applies recovery lock', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.25 ? 2 : 0),
    } satisfies TerrainSurfaceSampler
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)

    const ctrl = new PlayerController({
      characterSpeed: 8,
      movementBasis: 'camera',
      terrainYOffset: 0,
      jumpVelocity: 8,
      gravity: 20,
      failedJumpBackstepDistance: 0.8,
      failedJumpRecoverySeconds: 0.8,
    })

    ctrl.setMoveIntent(0, 1)
    ctrl.notifyJumpPressed()
    let failed = false
    for (let i = 0; i < 120 && !failed; i += 1) {
      ctrl.tick(1 / 60, {
        camera,
        character,
        sampler,
        playableRadius: 50,
        sprintHeld: false,
        crouchHeld: false,
      })
      const events = ctrl.consumeEvents()
      failed = events.some((e) => e.type === 'jump_failed_high_ledge')
    }
    expect(failed).toBe(true)
    expect(ctrl.getSnapshot().grounded).toBe(true)

    const xBefore = character.position.x
    ctrl.setMoveIntent(1, 0)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(character.position.x).toBeCloseTo(xBefore, 5)
  })

  it('walking into high wall triggers stumble event and backstep', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? 2 : 0),
    } satisfies TerrainSurfaceSampler
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const ctrl = new PlayerController({
      characterSpeed: 8,
      movementBasis: 'camera',
      terrainYOffset: 0,
      maxStepUpHeight: 0.4,
      wallStumbleBackstepDistance: 0.8,
    })

    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    expect(character.position.z).toBeGreaterThan(0.2)
    const events = ctrl.consumeEvents()
    expect(events.some((e) => e.type === 'wall_stumble')).toBe(true)
  })

  it('consequence resolver: pit walk warns, sprint falls, bypass falls', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const walkChar = new THREE.Mesh()
    walkChar.position.set(0, 0, 0)
    const walkCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      useConsequenceResolver: true,
    })
    walkCtrl.setMoveIntent(0, 1)
    walkCtrl.tick(0.1, {
      camera,
      character: walkChar,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(walkChar.position.z).toBeCloseTo(0, 5)
    expect(walkCtrl.consumeEvents().some((e) => e.type === 'edge_catch')).toBe(true)

    const sprintChar = new THREE.Mesh()
    sprintChar.position.set(0, 0, 0)
    const sprintCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      useConsequenceResolver: true,
    })
    sprintCtrl.setMoveIntent(0, 1)
    sprintCtrl.tick(0.1, {
      camera,
      character: sprintChar,
      sampler,
      playableRadius: 50,
      sprintHeld: true,
      crouchHeld: false,
    })
    expect(sprintChar.position.z).toBeLessThan(-0.5)
    expect(sprintCtrl.getSnapshot().grounded).toBe(false)

    const bypassChar = new THREE.Mesh()
    bypassChar.position.set(0, 0, 0)
    const bypassCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      cliffEdgeReleaseBypassSeconds: 2,
      useConsequenceResolver: true,
    })
    bypassCtrl.setMoveIntent(0, 1)
    bypassCtrl.tick(0.1, {
      camera,
      character: bypassChar,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    bypassCtrl.consumeEvents()
    bypassCtrl.setMoveIntent(0, 0)
    bypassCtrl.tick(0.1, {
      camera,
      character: bypassChar,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    bypassCtrl.setMoveIntent(0, 1)
    bypassCtrl.tick(0.1, {
      camera,
      character: bypassChar,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    expect(bypassChar.position.z).toBeLessThan(-0.5)
    expect(bypassCtrl.getSnapshot().grounded).toBe(false)
  })

  it('consequence resolver emits debug severity events when debugMovement is enabled', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler

    const walkChar = new THREE.Mesh()
    walkChar.position.set(0, 0, 0)
    const walkCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      useConsequenceResolver: true,
      debugMovement: true,
    })
    walkCtrl.setMoveIntent(0, 1)
    walkCtrl.tick(0.1, {
      camera,
      character: walkChar,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    const walkDebug = walkCtrl
      .consumeEvents()
      .find((e) => e.type === 'hazard_consequence_debug' && e.hazardType === 'pit')
    expect(walkDebug).toBeTruthy()
    expect((walkDebug as any).severity).toBe('L1')

    const sprintChar = new THREE.Mesh()
    sprintChar.position.set(0, 0, 0)
    const sprintCtrl = new PlayerController({
      characterSpeed: 10,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      useConsequenceResolver: true,
      debugMovement: true,
    })
    sprintCtrl.setMoveIntent(0, 1)
    sprintCtrl.tick(0.1, {
      camera,
      character: sprintChar,
      sampler,
      playableRadius: 50,
      sprintHeld: true,
      crouchHeld: false,
    })
    const sprintDebug = sprintCtrl
      .consumeEvents()
      .find((e) => e.type === 'hazard_consequence_debug' && e.hazardType === 'pit')
    expect(sprintDebug).toBeTruthy()
    expect((sprintDebug as any).severity).toBe('L3')
  })

  it('maintains grounded/mode mutual exclusion invariant across frames', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = { sample: () => 0 } satisfies TerrainSurfaceSampler
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)

    const ctrl = new PlayerController({
      characterSpeed: 8,
      movementBasis: 'camera',
      terrainYOffset: 0,
      jumpVelocity: 7,
      gravity: 20,
    })

    ctrl.notifyJumpPressed()
    for (let i = 0; i < 120; i += 1) {
      ctrl.tick(1 / 60, {
        camera,
        character,
        sampler,
        playableRadius: 50,
        sprintHeld: false,
        crouchHeld: false,
      })
      const snap = ctrl.getSnapshot()
      const mode = (ctrl as any).state.mode as 'grounded' | 'airborne' | 'recovery_locked'
      if (snap.grounded) {
        expect(mode).not.toBe('airborne')
      } else {
        expect(mode).toBe('airborne')
      }
      ctrl.consumeEvents()
    }
  })

  it('keeps transition timers non-negative with large delta ticks', () => {
    const camera = setupCameraAtOriginLookingDownMinusZ()
    const sampler = {
      sample: (_x: number, z: number) => (z < -0.2 ? -2 : 0),
    } satisfies TerrainSurfaceSampler
    const character = new THREE.Mesh()
    character.position.set(0, 0, 0)
    const ctrl = new PlayerController({
      characterSpeed: 8,
      movementBasis: 'camera',
      terrainYOffset: 0,
      cliffDropCatchThreshold: 0.5,
      cliffEdgeReleaseBypassSeconds: 2,
    })

    ctrl.setMoveIntent(0, 1)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })
    ctrl.setMoveIntent(0, 0)
    ctrl.tick(0.1, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    ctrl.tick(10, {
      camera,
      character,
      sampler,
      playableRadius: 50,
      sprintHeld: false,
      crouchHeld: false,
    })

    const state = (ctrl as any).state as {
      pitWarningRepeatTimer: number
      pitBypassRemaining: number
      recoveryLockRemaining: number
    }
    expect(state.pitWarningRepeatTimer).toBeGreaterThanOrEqual(0)
    expect(state.pitBypassRemaining).toBeGreaterThanOrEqual(0)
    expect(state.recoveryLockRemaining).toBeGreaterThanOrEqual(0)
  })
})
