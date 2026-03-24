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
})
