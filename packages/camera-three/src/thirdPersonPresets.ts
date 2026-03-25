/**
 * Named third-person rigs: distance / height / lateral offset / look pivot.
 * `lateral` > 0 shifts the camera to the character's **right**; negative = left (over-the-shoulder style).
 */

export type ThirdPersonCameraPreset = 'close-follow' | 'shoulder' | 'high' | 'tactical'

export const THIRD_PERSON_CAMERA_PRESET_ORDER: ThirdPersonCameraPreset[] = [
  'close-follow',
  'shoulder',
  'high',
  'tactical',
]

export interface ThirdPersonViewCam {
  /** Horizontal distance behind the character (along facing back-vector). */
  distance: number
  /** Eye height above character origin. */
  height: number
  /** Offset along character right (XZ); negative = camera left of centerline. */
  lateral: number
  /** World-space Y add for `lookAt` above character feet / root. */
  pivotY: number
}

export const THIRD_PERSON_CAMERA_PRESETS: Record<ThirdPersonCameraPreset, ThirdPersonViewCam> = {
  /** Over-the-shoulder: higher eye line, look-at on upper torso; lateral bias = camera left of spine. */
  'close-follow': {
    distance: 5.4,
    height: 2.35,
    lateral: -0.72,
    pivotY: 1.38,
  },
  /** Higher, mild right bias — classic “shoulder” adventure cam. */
  shoulder: {
    distance: 6.8,
    height: 3.0,
    lateral: 0.42,
    pivotY: 1.05,
  },
  /** Further back and higher overview. */
  high: {
    distance: 11,
    height: 7.5,
    lateral: 0,
    pivotY: 0.35,
  },
  /** Strong top-down / tactical framing (strategy modules). */
  tactical: {
    distance: 16,
    height: 42,
    lateral: 0,
    pivotY: 0.2,
  },
}

export function resolveThirdPersonViewCam(
  preset: ThirdPersonCameraPreset,
  overrides: Partial<ThirdPersonViewCam> = {},
): ThirdPersonViewCam {
  const b = THIRD_PERSON_CAMERA_PRESETS[preset]
  return {
    distance: overrides.distance ?? b.distance,
    height: overrides.height ?? b.height,
    lateral: overrides.lateral ?? b.lateral,
    pivotY: overrides.pivotY ?? b.pivotY,
  }
}
