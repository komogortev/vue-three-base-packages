import * as THREE from 'three'
import { largestSkinnedMesh } from './mixamoSkinnedMeshUtils'

/**
 * FBX rigs place bones under the loaded group; `SkinnedMesh` is often a sibling.
 * `AnimationMixer` must use that group so clip tracks resolve (mixer on mesh alone ⇒ T-pose).
 */
function animationRigRoot(locomotionRoot: THREE.Object3D): THREE.Object3D {
  if (locomotionRoot.children.length === 1) return locomotionRoot.children[0]!
  return locomotionRoot
}

function pickClip(
  clips: THREE.AnimationClip[],
  re: RegExp,
): THREE.AnimationClip | undefined {
  return clips.find((c) => re.test(c.name))
}

type LocoActions = {
  idle: THREE.AnimationAction | null
  walkFwd: THREE.AnimationAction | null
  walkBack: THREE.AnimationAction | null
  strafeL: THREE.AnimationAction | null
  strafeR: THREE.AnimationAction | null
}

/**
 * Third-person locomotion: stand + crouch clip sets, sprint tightens walk blend.
 * Clips in `root.userData.gltfAnimations` (from `SceneBuilder`).
 */
export class CharacterAnimationRig {
  private readonly mixer: THREE.AnimationMixer | null = null
  private readonly stand: LocoActions
  private readonly crouch: LocoActions

  /** 0 = idle, 1 = full locomotion layer */
  private moveBlend = 0
  /** 0 = stand poses, 1 = crouch poses */
  private crouchBlend = 0

  private readonly _worldFwd = new THREE.Vector3()
  private readonly _worldRight = new THREE.Vector3()
  private readonly _vel = new THREE.Vector3()

  constructor(root: THREE.Object3D) {
    const clips = (root.userData['gltfAnimations'] as THREE.AnimationClip[] | undefined) ?? []
    const rigRoot = animationRigRoot(root)
    const skinned = largestSkinnedMesh(rigRoot)
    if (!skinned || clips.length === 0) {
      this.mixer = null
      this.stand = this.emptyLoco()
      this.crouch = this.emptyLoco()
      return
    }

    // Retargeted Mixamo clips use `.bones[name].*` tracks and need the SkinnedMesh as root.
    this.mixer = new THREE.AnimationMixer(skinned)

    const idleStand =
      pickClip(clips, /neutral idle/i) ??
      pickClip(clips, /idle|stand|wait|rest|breath|t[-_]?pose|idle-action-ready/i) ??
      clips[0]
    const walkFwdStand =
      pickClip(clips, /^walking$/i) ??
      pickClip(clips, /^walking \(\d+\)$/i) ??
      pickClip(clips, /start walking/i)
    const walkBackStand = pickClip(clips, /walking backwards|backwards/i)
    const strafeLStand = pickClip(clips, /left strafe/i)
    const strafeRStand = pickClip(clips, /right strafe/i)

    const idleCrouch =
      pickClip(clips, /crouching idle/i) ?? pickClip(clips, /male crouch pose/i) ?? idleStand
    const walkCrouch =
      pickClip(clips, /^crouched walking$/i) ??
      pickClip(clips, /crouched walking/i) ??
      walkFwdStand
    const strafeLCrouch = pickClip(clips, /crouched sneaking left/i)
    const strafeRCrouch = pickClip(clips, /crouched sneaking right/i)

    const play = (clip: THREE.AnimationClip | undefined, w: number): THREE.AnimationAction | null => {
      if (!clip || !this.mixer) return null
      const a = this.mixer.clipAction(clip)
      a.play()
      a.setEffectiveWeight(w)
      return a
    }

    this.stand = {
      idle: play(idleStand, 1),
      walkFwd: play(walkFwdStand, 0),
      walkBack: play(walkBackStand, 0),
      strafeL: play(strafeLStand, 0),
      strafeR: play(strafeRStand, 0),
    }
    this.crouch = {
      idle: play(idleCrouch, 0),
      walkFwd: play(walkCrouch, 0),
      walkBack: null,
      strafeL: play(strafeLCrouch, 0),
      strafeR: play(strafeRCrouch, 0),
    }
  }

  private emptyLoco(): LocoActions {
    return {
      idle: null,
      walkFwd: null,
      walkBack: null,
      strafeL: null,
      strafeR: null,
    }
  }

  private applyLocoWeights(
    set: LocoActions,
    idleW: number,
    wF: number,
    wB: number,
    wL: number,
    wR: number,
    moveLayer: number,
  ): void {
    const m = moveLayer
    set.idle?.setEffectiveWeight(idleW)
    const crouchWalkBack = !set.walkBack && set.walkFwd
    if (crouchWalkBack) {
      const fwdBack = (wF + wB) * m
      set.walkFwd?.setEffectiveWeight(fwdBack)
    } else {
      set.walkFwd?.setEffectiveWeight(wF * m)
      set.walkBack?.setEffectiveWeight(wB * m)
    }
    set.strafeL?.setEffectiveWeight(wL * m)
    set.strafeR?.setEffectiveWeight(wR * m)
  }

  /**
   * @param velocity — world-space XZ velocity (m/s).
   * @param opts.crouch — Ctrl held: crouch clip set.
   * @param opts.sprint — Shift held: faster gate into full walk (no run clip required).
   */
  update(
    delta: number,
    root: THREE.Object3D,
    velocity: { x: number; z: number },
    opts: { crouch?: boolean; sprint?: boolean } = {},
  ): void {
    if (!this.mixer) return
    this.mixer.update(delta)

    const crouchHeld = opts.crouch ?? false
    const sprintHeld = (opts.sprint ?? false) && !crouchHeld

    const k = 1 - Math.exp(-delta * 10)
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, crouchHeld ? 1 : 0, k)

    const hasStandLoco =
      this.stand.walkFwd ||
      this.stand.walkBack ||
      this.stand.strafeL ||
      this.stand.strafeR
    const hasCrouchLoco =
      this.crouch.walkFwd ||
      this.crouch.walkBack ||
      this.crouch.strafeL ||
      this.crouch.strafeR
    if (!this.stand.idle && !hasStandLoco && !this.crouch.idle) return

    this._vel.set(velocity.x, 0, velocity.z)
    const speed = this._vel.length()

    const walkThreshold = (sprintHeld ? 1.35 : 2.2) * (crouchHeld ? 1.15 : 1)
    const targetBlend = speed < 0.08 ? 0 : THREE.MathUtils.clamp(speed / walkThreshold, 0, 1)
    this.moveBlend = THREE.MathUtils.lerp(this.moveBlend, targetBlend, k)

    let wF = 0
    let wB = 0
    let wL = 0
    let wR = 0

    if (hasStandLoco || hasCrouchLoco) {
      root.getWorldDirection(this._worldFwd)
      this._worldFwd.y = 0
      if (this._worldFwd.lengthSq() < 1e-8) {
        this._worldFwd.set(0, 0, -1)
      } else {
        this._worldFwd.normalize()
      }
      this._worldRight.crossVectors(THREE.Object3D.DEFAULT_UP, this._worldFwd).normalize()

      const forwardSpeed = this._vel.dot(this._worldFwd)
      const strafeSpeed = this._vel.dot(this._worldRight)

      wF = Math.max(0, forwardSpeed)
      wB = Math.max(0, -forwardSpeed)
      wL = Math.max(0, -strafeSpeed)
      wR = Math.max(0, strafeSpeed)
      const denom = wF + wB + wL + wR + 1e-6
      wF /= denom
      wB /= denom
      wL /= denom
      wR /= denom

      let locSum = wF + wB + wL + wR
      if (locSum < 1e-6 && speed > 0.08) {
        if (this.stand.walkFwd || this.crouch.walkFwd) {
          wF = 1
          wB = wL = wR = 0
          locSum = 1
        }
      } else if (locSum > 1e-6) {
        wF /= locSum
        wB /= locSum
        wL /= locSum
        wR /= locSum
      }
    }

    const maskRenorm = (
      f: number,
      b: number,
      l: number,
      r: number,
      has: { hf: boolean; hb: boolean; hl: boolean; hr: boolean },
    ): { f: number; b: number; l: number; r: number } => {
      let a = has.hf ? f : 0
      let bb = has.hb ? b : 0
      let c = has.hl ? l : 0
      let d = has.hr ? r : 0
      let s = a + bb + c + d
      if (s < 1e-6 && f + b + l + r > 1e-6 && has.hf) {
        a = 1
        bb = c = d = 0
        s = 1
      } else if (s > 1e-6) {
        a /= s
        bb /= s
        c /= s
        d /= s
      }
      return { f: a, b: bb, l: c, r: d }
    }

    const standHas = {
      hf: !!this.stand.walkFwd,
      hb: !!this.stand.walkBack,
      hl: !!this.stand.strafeL,
      hr: !!this.stand.strafeR,
    }
    const crouchHas = {
      hf: !!this.crouch.walkFwd,
      hb: !!this.crouch.walkBack,
      hl: !!this.crouch.strafeL,
      hr: !!this.crouch.strafeR,
    }
    const ws = maskRenorm(wF, wB, wL, wR, standHas)
    const wc = maskRenorm(wF, wB, wL, wR, crouchHas)

    const mb = this.moveBlend
    const cb = this.crouchBlend
    const standLayer = 1 - cb
    const crouchLayer = cb

    const idleStandW = (1 - mb) * standLayer
    const idleCrouchW = (1 - mb) * crouchLayer

    this.applyLocoWeights(this.stand, idleStandW, ws.f, ws.b, ws.l, ws.r, mb * standLayer)
    this.applyLocoWeights(this.crouch, idleCrouchW, wc.f, wc.b, wc.l, wc.r, mb * crouchLayer)
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.stand.idle = null
    this.stand.walkFwd = null
    this.stand.walkBack = null
    this.stand.strafeL = null
    this.stand.strafeR = null
    this.crouch.idle = null
    this.crouch.walkFwd = null
    this.crouch.walkBack = null
    this.crouch.strafeL = null
    this.crouch.strafeR = null
  }
}
