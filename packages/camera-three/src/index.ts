// @base/camera-three — gameplay camera rigs (third / first person) for Three.js

export {
  type ThirdPersonCameraPreset,
  type ThirdPersonViewCam,
  THIRD_PERSON_CAMERA_PRESETS,
  THIRD_PERSON_CAMERA_PRESET_ORDER,
  resolveThirdPersonViewCam,
} from './thirdPersonPresets'

export { type Vec3, computeThirdPersonCamera } from './computeThirdPersonRig'

export {
  type FirstPersonViewConfig,
  DEFAULT_FIRST_PERSON_VIEW,
} from './firstPersonConfig'

export {
  type GameplayCameraMode,
  type GameplayCameraControllerOptions,
  GameplayCameraController,
} from './GameplayCameraController'
