/**
 * First-person placement: {@link eyeOffsetY} is added to `Object3D.position.y` (locomotion root).
 * Tune per asset pivot (feet vs capsule centre).
 */
export interface FirstPersonViewConfig {
  eyeOffsetY: number
  /** Scaled by crouch blend (0–1); lowers eye in world Y when crouching. */
  crouchEyeDrop: number
}

export const DEFAULT_FIRST_PERSON_VIEW: FirstPersonViewConfig = {
  eyeOffsetY: 0.75,
  crouchEyeDrop: 0.28,
}
