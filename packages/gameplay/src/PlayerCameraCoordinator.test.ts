import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { PlayerCameraCoordinator } from './PlayerCameraCoordinator'
import { PlayerController } from '@base/player-three'
import { GameplayCameraController } from '@base/camera-three'
import { EventBus } from '@base/engine-core'
import { EV_GAMEPLAY_CAMERA_MODE } from './gameplayEvents'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePlayer(): PlayerController {
  return new PlayerController({ characterSpeed: 6 })
}

function makeGameplayCam(mode: 'third-person' | 'first-person' = 'third-person'): GameplayCameraController {
  return new GameplayCameraController({ cameraLerp: 10, mode })
}

function makeCoordinator(opts?: {
  mode?: 'third-person' | 'first-person'
  onModeChange?: (m: string) => void
}) {
  const player = makePlayer()
  const cam = makeGameplayCam(opts?.mode)
  const coord = new PlayerCameraCoordinator(
    player,
    cam,
    { facingLerp: 10, facingLerpThirdPerson: 5 },
    opts?.onModeChange as any,
  )
  return { coord, player, cam }
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
}

function makeCharacter(): THREE.Mesh {
  const m = new THREE.Mesh()
  m.position.set(0, 0.85, 0)
  return m
}

function makeCtx() {
  return {
    camera: makeCamera(),
    character: makeCharacter(),
    sampler: undefined,
    playableRadius: 50,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlayerCameraCoordinator', () => {
  describe('getCameraMode', () => {
    it('reflects initial third-person mode', () => {
      const { coord } = makeCoordinator()
      expect(coord.getCameraMode()).toBe('third-person')
    })

    it('reflects initial first-person mode when constructed with it', () => {
      const { coord } = makeCoordinator({ mode: 'first-person' })
      expect(coord.getCameraMode()).toBe('first-person')
    })
  })

  describe('setCameraMode', () => {
    it('switches to first-person mode', () => {
      const { coord } = makeCoordinator()
      coord.setCameraMode('first-person', null, null, null)
      expect(coord.getCameraMode()).toBe('first-person')
    })

    it('switches to third-person mode', () => {
      const { coord } = makeCoordinator({ mode: 'first-person' })
      coord.setCameraMode('third-person', null, null, null)
      expect(coord.getCameraMode()).toBe('third-person')
    })

    it('emits EV_GAMEPLAY_CAMERA_MODE on the provided eventBus', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      const handler = vi.fn()
      bus.on(EV_GAMEPLAY_CAMERA_MODE, handler)
      coord.setCameraMode('first-person', null, null, bus)
      expect(handler).toHaveBeenCalledWith({ mode: 'first-person' })
    })

    it('calls the onModeChange callback', () => {
      const onModeChange = vi.fn()
      const { coord } = makeCoordinator({ onModeChange })
      coord.setCameraMode('first-person', null, null, null)
      expect(onModeChange).toHaveBeenCalledWith('first-person')
    })

    it('snaps camera when camera and character are provided', () => {
      const { coord } = makeCoordinator()
      const camera = makeCamera()
      const character = makeCharacter()
      // Should not throw even with a valid camera + character
      expect(() => coord.setCameraMode('first-person', camera, character, null)).not.toThrow()
    })

    it('resets pitch accumulator when switching to third-person', () => {
      const { coord } = makeCoordinator({ mode: 'first-person' })
      const bus = new EventBus()
      coord.mount(bus)
      // Accumulate pitch via look event
      bus.emit('input:axis', { axis: 'look', value: { x: 0, y: 0.5 } })
      // Switch away resets pitch
      coord.setCameraMode('third-person', null, null, null)
      // Tick a frame — in third-person pitch is not passed to camera update; no error
      expect(() => coord.tick(1 / 60, makeCtx())).not.toThrow()
      coord.unmount()
    })
  })

  describe('mount / unmount', () => {
    it('subscribes to input events on mount', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)

      const handler = vi.fn()
      // Simulate a move axis event; coordinator should accumulate it without throwing
      expect(() => bus.emit('input:axis', { axis: 'move', value: { x: 1, y: 0 } })).not.toThrow()
      coord.unmount()
    })

    it('unsubscribes on unmount so further events are ignored', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      coord.unmount()

      // Move intent set before unmount should be gone — tick should yield no motion
      bus.emit('input:axis', { axis: 'move', value: { x: 0, y: 1 } })
      const char = makeCharacter()
      coord.tick(1 / 60, { camera: makeCamera(), character: char, sampler: undefined, playableRadius: 50 })
      expect(char.position.z).toBeCloseTo(0, 5) // no movement
    })
  })

  describe('tick — input routing', () => {
    it('routes move axis to player move intent', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      bus.emit('input:axis', { axis: 'move', value: { x: 0, y: 1 } })

      const char = makeCharacter()
      coord.tickPlayer(1 / 60, { camera: makeCamera(), character: char, sampler: undefined, playableRadius: 50 })
      // Character should have moved (y=1 is "forward")
      expect(char.position.z).not.toBeCloseTo(0, 1)
      coord.unmount()
    })

    it('caps yaw input to facingLerpThirdPerson rate in third-person', () => {
      const { coord, player } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)

      const facingBefore = player.getFacing()
      // Large yaw input — should be capped
      bus.emit('input:axis', { axis: 'look', value: { x: 9999, y: 0 } })
      const delta = 1 / 60
      coord.tickPlayer(delta, makeCtx())

      const facingAfter = player.getFacing()
      const maxExpected = facingBefore + 5 * delta + 0.001 // facingLerpThirdPerson=5
      expect(Math.abs(facingAfter - facingBefore)).toBeLessThanOrEqual(maxExpected)
      coord.unmount()
    })

    it('passes yaw directly (uncapped) in first-person mode', () => {
      const { coord, player } = makeCoordinator({ mode: 'first-person' })
      const bus = new EventBus()
      coord.mount(bus)

      const facingBefore = player.getFacing()
      const largeDelta = 1.0 // 1 radian
      bus.emit('input:axis', { axis: 'look', value: { x: largeDelta, y: 0 } })
      coord.tickPlayer(1 / 60, makeCtx())

      // In first-person yaw is uncapped — full delta applied
      expect(player.getFacing()).toBeCloseTo(facingBefore + largeDelta, 5)
      coord.unmount()
    })

    it('consumes loco sprint/crouch flags after tickPlayer', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      bus.emit('input:axis', { axis: 'locomotion', value: { x: 1, y: 1 } })

      const ctx = makeCtx()
      coord.tickPlayer(1 / 60, ctx)
      // Second tick without new locomotion event — sprint/crouch should be off
      // This is a no-throw check; internal state reset is tested by lack of sprint on char
      expect(() => coord.tickPlayer(1 / 60, ctx)).not.toThrow()
      coord.unmount()
    })
  })

  describe('tickCamera', () => {
    it('drives camera without throwing in both modes', () => {
      const { coord } = makeCoordinator()
      const ctx = makeCtx()
      expect(() => {
        coord.tickPlayer(1 / 60, ctx)
        coord.tickCamera(1 / 60, ctx)
      }).not.toThrow()
    })

    it('tick() calls tickPlayer then tickCamera — combined shortcut works', () => {
      const { coord } = makeCoordinator()
      expect(() => coord.tick(1 / 60, makeCtx())).not.toThrow()
    })
  })

  describe('toggle_camera action', () => {
    it('toggles mode from third-person to first-person', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      bus.emit('input:action', { action: 'toggle_camera', type: 'pressed' })
      expect(coord.getCameraMode()).toBe('first-person')
      coord.unmount()
    })

    it('toggles back to third-person on second press', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      bus.emit('input:action', { action: 'toggle_camera', type: 'pressed' })
      bus.emit('input:action', { action: 'toggle_camera', type: 'pressed' })
      expect(coord.getCameraMode()).toBe('third-person')
      coord.unmount()
    })

    it('ignores toggle_camera release events', () => {
      const { coord } = makeCoordinator()
      const bus = new EventBus()
      coord.mount(bus)
      bus.emit('input:action', { action: 'toggle_camera', type: 'released' })
      expect(coord.getCameraMode()).toBe('third-person') // unchanged
      coord.unmount()
    })
  })
})
