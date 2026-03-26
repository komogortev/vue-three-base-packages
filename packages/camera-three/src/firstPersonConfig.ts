/**
 * First-person placement: {@link eyeOffsetY} is added to `Object3D.position.y` (locomotion root).
 * Tune per asset pivot (feet vs capsule centre).
 *
 * `eyePullback` shifts the camera **forward** in XZ along body/view forward (−sin f, −cos f),
 * same frame as `PlayerController` walk direction — from locomotion root toward the face.
 * Use when the root sits behind the skull and FPV clips interior face tris; tune 0.04–0.10 m.
 */
export interface FirstPersonViewConfig {
  eyeOffsetY: number
  /** Scaled by crouch blend (0–1); lowers eye in world Y when crouching. */
  crouchEyeDrop: number
  /**
   * World-space metres along view forward on XZ (see module JSDoc). 0 = only vertical eye offset.
   */
  eyePullback: number
}

export const DEFAULT_FIRST_PERSON_VIEW: FirstPersonViewConfig = {
  eyeOffsetY: 0.75,
  crouchEyeDrop: 0.28,
  eyePullback: 0,
}
