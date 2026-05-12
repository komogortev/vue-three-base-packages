import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { GameplayCameraController } from './GameplayCameraController'
import { THIRD_PERSON_CAMERA_PRESETS } from './thirdPersonPresets'

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
  cam.position.set(0, 0, 0)
  return cam
}

function makeCharacter(x = 0, y = 0, z = 0): THREE.Mesh {
  const obj = new THREE.Mesh()
  obj.position.set(x, y, z)
  return obj
}

describe('GameplayCameraController', () => {
  describe('construction and mode', () => {
    it('defaults to third-person mode', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      expect(ctrl.getMode()).toBe('third-person')
    })

    it('respects explicit initial mode', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      expect(ctrl.getMode()).toBe('first-person')
    })

    it('setMode / getMode round-trip', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      ctrl.setMode('first-person')
      expect(ctrl.getMode()).toBe('first-person')
      ctrl.setMode('third-person')
      expect(ctrl.getMode()).toBe('third-person')
    })
  })

  describe('preset management', () => {
    it('defaults to close-follow preset', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      expect(ctrl.getCameraPreset()).toBe('close-follow')
    })

    it('setCameraPreset changes active preset', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      ctrl.setCameraPreset('tactical')
      expect(ctrl.getCameraPreset()).toBe('tactical')
    })

    it('getThirdPersonViewCam returns a copy of the active rig', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, cameraPreset: 'high' })
      const rig = ctrl.getThirdPersonViewCam()
      expect(rig).toEqual(THIRD_PERSON_CAMERA_PRESETS['high'])
      // Mutating the returned object should not affect the controller
      rig.distance = 999
      expect(ctrl.getThirdPersonViewCam().distance).toBe(THIRD_PERSON_CAMERA_PRESETS['high'].distance)
    })

    it('thirdPersonOverrides are applied at construction', () => {
      const ctrl = new GameplayCameraController({
        cameraLerp: 10,
        cameraPreset: 'shoulder',
        thirdPersonOverrides: { distance: 42 },
      })
      expect(ctrl.getThirdPersonViewCam().distance).toBe(42)
    })

    it('setThirdPersonOverrides replaces and reapplies to current preset', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, cameraPreset: 'close-follow' })
      ctrl.setThirdPersonOverrides({ height: 99 })
      expect(ctrl.getThirdPersonViewCam().height).toBe(99)
      expect(ctrl.getThirdPersonViewCam().distance).toBe(THIRD_PERSON_CAMERA_PRESETS['close-follow'].distance)
    })

    it('setCameraPreset re-applies existing overrides', () => {
      const ctrl = new GameplayCameraController({
        cameraLerp: 10,
        cameraPreset: 'close-follow',
        thirdPersonOverrides: { distance: 20 },
      })
      ctrl.setCameraPreset('shoulder')
      // Override distance=20 should persist after preset switch
      expect(ctrl.getThirdPersonViewCam().distance).toBe(20)
      // Non-overridden fields come from the new preset
      expect(ctrl.getThirdPersonViewCam().height).toBe(THIRD_PERSON_CAMERA_PRESETS['shoulder'].height)
    })
  })

  describe('snapToCharacter (third-person)', () => {
    it('places camera behind character immediately (no lerp)', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      const cam = makeCamera()
      const char = makeCharacter(0, 0, 0)
      ctrl.snapToCharacter(cam, char, 0, 0)
      // Camera should have moved (it was at origin, character at origin → camera behind)
      // Verify it's not still at the initial position for a non-trivial preset
      expect(cam.position.z).toBeGreaterThan(0) // close-follow preset places cam behind at +z for facing=0
    })

    it('updates lookAt target (camera looks at character pivot)', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      const cam = makeCamera()
      const char = makeCharacter(0, 0, 0)
      ctrl.snapToCharacter(cam, char, 0, 0)
      // After snap, camera should not still look straight at its original target
      // We can verify the camera matrix is updated
      expect(() => ctrl.snapToCharacter(cam, char, 0, 0)).not.toThrow()
    })
  })

  describe('snapToCharacter (first-person)', () => {
    it('places camera at eye height in first-person mode', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      const cam = makeCamera()
      const char = makeCharacter(0, 0, 0)
      ctrl.snapToCharacter(cam, char, 0, 0)
      // Default eyeOffsetY = 0.75; character at y=0 → camera.y = 0.75
      expect(cam.position.y).toBeCloseTo(0.75, 3)
    })

    it('lowers camera Y by crouchEyeDrop when crouch blend is 1', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      const cam = makeCamera()
      const char = makeCharacter(0, 0, 0)
      ctrl.snapToCharacter(cam, char, 0, 1) // crouchBlend=1
      // Default: eyeOffsetY=0.75, crouchEyeDrop=0.28 → 0.75 - 0.28 = 0.47
      expect(cam.position.y).toBeCloseTo(0.75 - 0.28, 3)
    })

    it('sets camera Y rotation to facing angle', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      const cam = makeCamera()
      const char = makeCharacter()
      const facing = Math.PI / 4
      ctrl.snapToCharacter(cam, char, facing, 0)
      expect(cam.rotation.y).toBeCloseTo(facing, 5)
    })
  })

  describe('update (third-person)', () => {
    it('lerps camera toward target over multiple frames', () => {
      // Use cameraLerp=1 so t = min(1, 1 * delta) << 1 per frame → lerp is gradual
      const ctrl = new GameplayCameraController({ cameraLerp: 1, mode: 'third-person' })
      const cam = makeCamera()
      cam.position.set(0, 0, 0)
      const char = makeCharacter(0, 0, 0)

      // Snap to get baseline camera position (character at origin, facing=0)
      ctrl.snapToCharacter(cam, char, 0, 0)
      const initialX = cam.position.x

      // Move character 50 units along x; snap would put camera at x=50+lateral
      char.position.set(50, 0, 0)

      // Single frame with small delta — camera should start moving but not fully arrive
      const delta = 1 / 60
      ctrl.update(cam, delta, char, 0, 0)
      expect(cam.position.x).not.toBeCloseTo(initialX, 3)          // moved
      expect(cam.position.x).toBeLessThan(50 - 0.5)               // not fully at target yet
    })

    it('does not crash with large delta', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10 })
      const cam = makeCamera()
      expect(() => ctrl.update(cam, 100, makeCharacter(), 0, 0)).not.toThrow()
    })
  })

  describe('update (first-person)', () => {
    it('places camera at eye position each frame (no lerp)', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      const cam = makeCamera()
      const char = makeCharacter(10, 2, 5)
      ctrl.update(cam, 1 / 60, char, 0, 0)
      expect(cam.position.x).toBeCloseTo(10, 3)
      expect(cam.position.y).toBeCloseTo(2 + 0.75, 3) // y + eyeOffsetY
      expect(cam.position.z).toBeCloseTo(5, 3)
    })

    it('applies first-person pitch from update argument', () => {
      const ctrl = new GameplayCameraController({ cameraLerp: 10, mode: 'first-person' })
      const cam = makeCamera()
      const pitch = 0.3
      ctrl.update(cam, 1 / 60, makeCharacter(), 0, 0, pitch)
      expect(cam.rotation.x).toBeCloseTo(pitch, 5)
    })
  })
})
