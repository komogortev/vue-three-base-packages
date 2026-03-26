import * as THREE from 'three'
import type { FirstPersonViewConfig } from './firstPersonConfig'
import { DEFAULT_FIRST_PERSON_VIEW } from './firstPersonConfig'
import { computeThirdPersonCamera } from './computeThirdPersonRig'
import type { ThirdPersonCameraPreset, ThirdPersonViewCam } from './thirdPersonPresets'
import { resolveThirdPersonViewCam } from './thirdPersonPresets'

export type GameplayCameraMode = 'third-person' | 'first-person'

export interface GameplayCameraControllerOptions {
  /** Smoothing for third-person position lerp; higher = snappier. Ignored in first-person (instant). */
  cameraLerp: number
  cameraPreset?: ThirdPersonCameraPreset
  /** Applied on every preset change and at construction — matches constructor distance/height overrides. */
  thirdPersonOverrides?: Partial<ThirdPersonViewCam>
  firstPerson?: Partial<FirstPersonViewConfig>
  /** Initial mode; default third-person. */
  mode?: GameplayCameraMode
}

/**
 * Drives a {@link THREE.PerspectiveCamera} for third-person chase or first-person eye height.
 * Third-person uses the same XZ frame as {@link PlayerController} `movementBasis: 'facing'`.
 */
export class GameplayCameraController {
  private mode: GameplayCameraMode
  private readonly cameraLerp: number
  private activePreset: ThirdPersonCameraPreset
  private thirdPersonOverrides: Partial<ThirdPersonViewCam>
  private viewCam: ThirdPersonViewCam
  private readonly fp: FirstPersonViewConfig

  private readonly _camTarget = new THREE.Vector3()
  private readonly _lookAt = new THREE.Vector3()

  constructor(options: GameplayCameraControllerOptions) {
    const {
      cameraLerp,
      cameraPreset = 'close-follow',
      thirdPersonOverrides = {},
      firstPerson,
      mode = 'third-person',
    } = options
    this.cameraLerp = cameraLerp
    this.activePreset = cameraPreset
    this.thirdPersonOverrides = { ...thirdPersonOverrides }
    this.viewCam = resolveThirdPersonViewCam(cameraPreset, this.thirdPersonOverrides)
    this.fp = { ...DEFAULT_FIRST_PERSON_VIEW, ...firstPerson }
    this.mode = mode
  }

  getMode(): GameplayCameraMode {
    return this.mode
  }

  setMode(mode: GameplayCameraMode): void {
    this.mode = mode
  }

  getCameraPreset(): ThirdPersonCameraPreset {
    return this.activePreset
  }

  /**
   * Switch named rig; merges {@link thirdPersonOverrides} from construction /
   * {@link setThirdPersonOverrides} so runtime preset changes stay consistent with harness config.
   */
  setCameraPreset(preset: ThirdPersonCameraPreset): void {
    this.activePreset = preset
    this.viewCam = resolveThirdPersonViewCam(preset, this.thirdPersonOverrides)
  }

  /** Replace partial rig fields (e.g. from scene descriptor); reapplies current preset. */
  setThirdPersonOverrides(overrides: Partial<ThirdPersonViewCam>): void {
    this.thirdPersonOverrides = { ...overrides }
    this.viewCam = resolveThirdPersonViewCam(this.activePreset, this.thirdPersonOverrides)
  }

  getThirdPersonViewCam(): ThirdPersonViewCam {
    return { ...this.viewCam }
  }

  snapToCharacter(camera: THREE.PerspectiveCamera, character: THREE.Object3D, facing: number, crouchBlend: number): void {
    if (this.mode === 'first-person') {
      this.applyFirstPerson(camera, character, facing, crouchBlend, 0)
    } else {
      const p = character.position
      const { camera: c, lookAt: l } = computeThirdPersonCamera(
        { x: p.x, y: p.y, z: p.z },
        facing,
        this.viewCam,
        crouchBlend,
      )
      camera.position.set(c.x, c.y, c.z)
      this._lookAt.set(l.x, l.y, l.z)
      camera.lookAt(this._lookAt)
    }
  }

  /**
   * @param firstPersonPitch — radians, X rotation (YXZ). Optional mouse-look hook; default 0.
   */
  update(
    camera: THREE.PerspectiveCamera,
    delta: number,
    character: THREE.Object3D,
    facing: number,
    crouchGroundBlend: number,
    firstPersonPitch = 0,
  ): void {
    if (this.mode === 'first-person') {
      this.applyFirstPerson(camera, character, facing, crouchGroundBlend, firstPersonPitch)
      return
    }

    const p = character.position
    const { camera: c, lookAt: l } = computeThirdPersonCamera(
      { x: p.x, y: p.y, z: p.z },
      facing,
      this.viewCam,
      crouchGroundBlend,
    )
    this._camTarget.set(c.x, c.y, c.z)
    const t = Math.min(1, this.cameraLerp * delta)
    camera.position.lerp(this._camTarget, t)
    this._lookAt.set(l.x, l.y, l.z)
    camera.lookAt(this._lookAt)
  }

  private applyFirstPerson(
    camera: THREE.PerspectiveCamera,
    character: THREE.Object3D,
    facing: number,
    crouchBlend: number,
    pitch: number,
  ): void {
    const cb = Math.min(1, Math.max(0, crouchBlend))
    const p = character.position
    const eyeY = p.y + this.fp.eyeOffsetY - this.fp.crouchEyeDrop * cb
    const pull = this.fp.eyePullback
    // Body / view forward in XZ matches PlayerController walk dir: (−sin f, −cos f). Positive pull
    // shifts the eye from locomotion root toward the nose (outside the skull vs pelvis-centred XZ).
    const bx = pull !== 0 ? -Math.sin(facing) * pull : 0
    const bz = pull !== 0 ? -Math.cos(facing) * pull : 0
    camera.position.set(p.x + bx, eyeY, p.z + bz)
    camera.rotation.order = 'YXZ'
    camera.rotation.y = facing
    camera.rotation.x = pitch
    camera.rotation.z = 0
  }
}
