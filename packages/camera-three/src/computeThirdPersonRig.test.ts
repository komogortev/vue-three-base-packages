import { describe, expect, it } from 'vitest'
import { computeThirdPersonCamera } from './computeThirdPersonRig'
import type { ThirdPersonViewCam } from './thirdPersonPresets'

describe('computeThirdPersonCamera', () => {
  const rig: ThirdPersonViewCam = {
    distance: 10,
    height: 2,
    lateral: 0,
    pivotY: 1,
  }

  it('places camera behind character for facing 0 (forward +Z)', () => {
    const { camera, lookAt } = computeThirdPersonCamera({ x: 0, y: 0, z: 0 }, 0, rig, 0)
    expect(camera.x).toBeCloseTo(0)
    expect(camera.z).toBeCloseTo(10)
    expect(camera.y).toBeCloseTo(2)
    expect(lookAt.y).toBeCloseTo(1)
  })

  it('applies lateral offset on the right for positive lateral', () => {
    const r = { ...rig, lateral: 2 }
    const { camera } = computeThirdPersonCamera({ x: 0, y: 0, z: 0 }, 0, r, 0)
    expect(camera.x).toBeCloseTo(2)
    expect(camera.z).toBeCloseTo(10)
  })

  it('reduces height and pivot when crouch blend is 1', () => {
    const { camera, lookAt } = computeThirdPersonCamera({ x: 1, y: 2, z: 3 }, Math.PI / 2, rig, 1)
    expect(camera.y).toBeCloseTo(2 + 2 * 0.8)
    expect(lookAt.y).toBeCloseTo(2 + 1 * 0.65)
  })
})
