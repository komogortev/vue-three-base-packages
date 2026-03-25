import type { ThirdPersonViewCam } from './thirdPersonPresets'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * World camera position and look-at target for a chase rig behind {@link facing} (Y-axis radians),
 * matching the math used by {@link GameplayCameraController} for third-person mode.
 */
export function computeThirdPersonCamera(
  character: Vec3,
  facing: number,
  rig: ThirdPersonViewCam,
  crouchGroundBlend: number,
): { camera: Vec3; lookAt: Vec3 } {
  const cb = Math.min(1, Math.max(0, crouchGroundBlend))
  const effHeight = rig.height * (1 - 0.2 * cb)
  const effPivot = rig.pivotY * (1 - 0.35 * cb)
  const { distance, lateral } = rig
  const bx = Math.sin(facing) * distance
  const bz = Math.cos(facing) * distance
  const rx = Math.cos(facing) * lateral
  const rz = -Math.sin(facing) * lateral

  return {
    camera: {
      x: character.x + bx + rx,
      y: character.y + effHeight,
      z: character.z + bz + rz,
    },
    lookAt: {
      x: character.x,
      y: character.y + effPivot,
      z: character.z,
    },
  }
}
