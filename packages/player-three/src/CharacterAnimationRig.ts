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

function normalizeClipName(name: string): string {
  return name.toLowerCase().replace(/\s*\(\d+\)\s*$/, '').trim()
}

function dedupeClipsByName(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const seen = new Set<string>()
  const out: THREE.AnimationClip[] = []
  for (const clip of clips) {
    const key = normalizeClipName(clip.name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clip)
  }
  return out
}

type LocoActions = {
  idle: THREE.AnimationAction | null
  walkFwd: THREE.AnimationAction | null
  runSlowFwd: THREE.AnimationAction | null
  runSprintFwd: THREE.AnimationAction | null
  walkBack: THREE.AnimationAction | null
  strafeL: THREE.AnimationAction | null
  strafeR: THREE.AnimationAction | null
}

/**
 * Third-person locomotion: stand + crouch; jog vs sprint run clips; jump rise / fall overlays.
 * Clips in `root.userData.gltfAnimations` (from `SceneBuilder`).
 */
export class CharacterAnimationRig {
  private readonly mixer: THREE.AnimationMixer | null = null
  private readonly stand: LocoActions
  private readonly crouch: LocoActions
  private jumpRise: THREE.AnimationAction | null = null
  private jumpFall: THREE.AnimationAction | null = null
  private jumpSecond: THREE.AnimationAction | null = null
  private reaction: THREE.AnimationAction | null = null
  private secondJumpBurstSeconds = 0
  private reactionBurstSeconds = 0

  /** 0 = idle, 1 = full locomotion layer */
  private moveBlend = 0
  /** 0 = stand poses, 1 = crouch poses */
  private crouchBlend = 0
  /** Smoothed jog / slow-run (explicit input only, not speed-based). */
  private jogGate = 0
  /** Forward sprint run clip blend. */
  private sprintRunGate = 0
  private lastGrounded = true

  private readonly _worldFwd = new THREE.Vector3()
  private readonly _worldRight = new THREE.Vector3()
  private readonly _vel = new THREE.Vector3()

  constructor(root: THREE.Object3D) {
    const allClips = (root.userData['gltfAnimations'] as THREE.AnimationClip[] | undefined) ?? []
    const clips = dedupeClipsByName(allClips)
    const rigRoot = animationRigRoot(root)
    const skinned = largestSkinnedMesh(rigRoot)
    if (!skinned || clips.length === 0) {
      this.mixer = null
      this.stand = this.emptyLoco()
      this.crouch = this.emptyLoco()
      return
    }

    // Drive the whole imported rig so every SkinnedMesh that shares these bones animates.
    // Mixer on a single mesh leaves extra skinned parts (when pruneExtraSkinnedMeshes is false) in T-pose.
    this.mixer = new THREE.AnimationMixer(rigRoot)

    const idleStand =
      pickClip(clips, /neutral idle/i) ??
      pickClip(clips, /idle|stand|wait|rest|breath|t[-_]?pose|idle-action-ready/i) ??
      clips[0]
    const walkFwdStand =
      pickClip(clips, /^walking$/i) ??
      pickClip(clips, /^walking \(\d+\)$/i) ??
      pickClip(clips, /start walking/i)

    let runSlowStand = pickClip(clips, /running slow/i)
    let runSprintStand = pickClip(clips, /running sprint/i)
    if (!runSlowStand && runSprintStand) runSlowStand = runSprintStand
    if (!runSprintStand && runSlowStand) runSprintStand = runSlowStand
    if (!runSlowStand) {
      runSlowStand =
        pickClip(clips, /^running$/i) ??
        pickClip(clips, /^running \(\d+\)$/i) ??
        pickClip(clips, /\bjog\b/i) ??
        pickClip(clips, /^sprint/i)
    }
    if (!runSprintStand) runSprintStand = runSlowStand
    if (runSprintStand && walkFwdStand && runSprintStand === walkFwdStand) {
      runSprintStand = undefined
      if (runSlowStand === walkFwdStand) runSlowStand = undefined
    } else if (runSlowStand && walkFwdStand && runSlowStand === walkFwdStand) {
      runSlowStand = undefined
    }

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

    const jumpClip =
      pickClip(clips, /^jumping$/i) ??
      pickClip(clips, /^jumping \(\d+\)$/i)
    const jumpSecondClip =
      pickClip(clips, /double jump|second jump/i) ??
      jumpClip
    let jumpDownClip = pickClip(clips, /jumping down/i)
    if (!jumpDownClip) jumpDownClip = pickClip(clips, /\bfall/i)
    const reactionClip = pickClip(clips, /\breaction\b/i)

    const playLoop = (clip: THREE.AnimationClip | undefined, w: number): THREE.AnimationAction | null => {
      if (!clip || !this.mixer) return null
      const a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.clampWhenFinished = false
      a.play()
      a.setEffectiveWeight(w)
      return a
    }

    const playOnce = (clip: THREE.AnimationClip | undefined, w: number): THREE.AnimationAction | null => {
      if (!clip || !this.mixer) return null
      const a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
      a.play()
      a.setEffectiveWeight(w)
      return a
    }

    this.stand = {
      idle: playLoop(idleStand, 1),
      walkFwd: playLoop(walkFwdStand, 0),
      runSlowFwd: playLoop(runSlowStand, 0),
      runSprintFwd: playLoop(runSprintStand, 0),
      walkBack: playLoop(walkBackStand, 0),
      strafeL: playLoop(strafeLStand, 0),
      strafeR: playLoop(strafeRStand, 0),
    }
    this.crouch = {
      idle: playLoop(idleCrouch, 0),
      walkFwd: playLoop(walkCrouch, 0),
      runSlowFwd: null,
      runSprintFwd: null,
      walkBack: null,
      strafeL: playLoop(strafeLCrouch, 0),
      strafeR: playLoop(strafeRCrouch, 0),
    }

    this.jumpRise = playOnce(jumpClip, 0)
    this.jumpFall = playOnce(jumpDownClip, 0)
    this.jumpSecond = playOnce(jumpSecondClip, 0)
    this.reaction = playOnce(reactionClip, 0)
  }

  private emptyLoco(): LocoActions {
    return {
      idle: null,
      walkFwd: null,
      runSlowFwd: null,
      runSprintFwd: null,
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
    jogMix: number,
    sprintMix: number,
    locoSuppress: number,
  ): void {
    const m = moveLayer * locoSuppress
    set.idle?.setEffectiveWeight(idleW)
    const j = THREE.MathUtils.clamp(jogMix, 0, 1)
    const sp = THREE.MathUtils.clamp(sprintMix, 0, 1)
    let wfWalk = wF
    let wfSlow = 0
    let wfSprint = 0
    if (sp > 1e-4 && set.runSprintFwd) {
      wfSprint = wF * sp
      wfWalk = wF * (1 - sp)
    } else if (j > 1e-4 && set.runSlowFwd) {
      wfSlow = wF * j
      wfWalk = wF * (1 - j)
    }
    if (!set.runSprintFwd && wfSprint > 0) {
      wfWalk += wfSprint
      wfSprint = 0
    }
    if (!set.runSlowFwd && wfSlow > 0) {
      wfWalk += wfSlow
      wfSlow = 0
    }
    if (!set.walkFwd) {
      wfSlow += wfWalk
      wfWalk = 0
    }
    const crouchWalkBack =
      !set.walkBack && set.walkFwd && !set.runSlowFwd && !set.runSprintFwd
    if (crouchWalkBack) {
      const fwdBack = (wfWalk + wfSlow + wfSprint + wB) * m
      set.walkFwd?.setEffectiveWeight(fwdBack)
      set.runSlowFwd?.setEffectiveWeight(0)
      set.runSprintFwd?.setEffectiveWeight(0)
    } else {
      set.walkFwd?.setEffectiveWeight(wfWalk * m)
      set.runSlowFwd?.setEffectiveWeight(wfSlow * m)
      set.runSprintFwd?.setEffectiveWeight(wfSprint * m)
      set.walkBack?.setEffectiveWeight(wB * m)
    }
    set.strafeL?.setEffectiveWeight(wL * m)
    set.strafeR?.setEffectiveWeight(wR * m)
  }

  /**
   * @param velocity — world-space velocity (m/s); **y** used for jump rise vs fall blend.
   * @param opts.grounded — false while airborne (jump arc).
   * @param opts.jog — hold jog / slow-run input (`locomotion` axis `z`); does not replace walk unless held.
   */
  update(
    delta: number,
    root: THREE.Object3D,
    velocity: { x: number; y: number; z: number },
    opts: {
      crouch?: boolean
      sprint?: boolean
      grounded?: boolean
      jog?: boolean
      /** Set true for the frame where a second jump is triggered. */
      secondJumpTrigger?: boolean
      /** Set true for the frame where ledge catch blocks movement. */
      edgeCatchTrigger?: boolean
    } = {},
  ): void {
    if (!this.mixer) return
    this.mixer.update(delta)

    const grounded = opts.grounded !== false
    const crouchHeld = opts.crouch ?? false
    const sprintHeld = (opts.sprint ?? false) && !crouchHeld

    const takeoff = grounded === false && this.lastGrounded
    const land = grounded === true && !this.lastGrounded
    this.lastGrounded = grounded

    if (takeoff) {
      this.jumpRise?.reset().play()
      this.jumpFall?.reset().play()
      this.jumpSecond?.reset().play()
    }
    if (land) {
      this.jumpRise?.stop()
      this.jumpFall?.stop()
      this.jumpSecond?.stop()
      this.reaction?.stop()
      this.secondJumpBurstSeconds = 0
      this.reactionBurstSeconds = 0
    }
    if (opts.secondJumpTrigger) {
      this.secondJumpBurstSeconds = 0.2
      this.jumpSecond?.reset().play()
    }
    if (opts.edgeCatchTrigger) {
      this.reactionBurstSeconds = 0.28
      this.reaction?.reset().play()
    }

    const k = 1 - Math.exp(-delta * 10)
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, crouchHeld ? 1 : 0, k)

    const hasStandLoco =
      this.stand.walkFwd ||
      this.stand.runSlowFwd ||
      this.stand.runSprintFwd ||
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
    const vy = velocity.y

    const walkThreshold = (sprintHeld ? 1.35 : 2.2) * (crouchHeld ? 1.15 : 1)
    const targetBlend = speed < 0.08 ? 0 : THREE.MathUtils.clamp(speed / walkThreshold, 0, 1)
    this.moveBlend = THREE.MathUtils.lerp(this.moveBlend, targetBlend, k)

    let wF = 0
    let wB = 0
    let wL = 0
    let wR = 0
    let forwardSpeed = 0

    if (hasStandLoco || hasCrouchLoco) {
      root.getWorldDirection(this._worldFwd).negate()
      this._worldFwd.y = 0
      if (this._worldFwd.lengthSq() < 1e-8) {
        this._worldFwd.set(0, 0, -1)
      } else {
        this._worldFwd.normalize()
      }
      this._worldRight.crossVectors(this._worldFwd, THREE.Object3D.DEFAULT_UP).normalize()

      forwardSpeed = this._vel.dot(this._worldFwd)
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
        if (this.stand.walkFwd || this.stand.runSlowFwd || this.stand.runSprintFwd || this.crouch.walkFwd) {
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

    const wantJogAnim =
      (opts.jog ?? false) &&
      !!this.stand.runSlowFwd &&
      !crouchHeld &&
      grounded &&
      speed > 0.08 &&
      forwardSpeed > 0.02 &&
      this.moveBlend > 0.12
    this.jogGate = THREE.MathUtils.lerp(this.jogGate, wantJogAnim ? 1 : 0, k)

    const wantSprintRun =
      !!this.stand.runSprintFwd &&
      sprintHeld &&
      speed > 0.12 &&
      forwardSpeed > 0.04 &&
      this.moveBlend > 0.2
    this.sprintRunGate = THREE.MathUtils.lerp(this.sprintRunGate, wantSprintRun ? 1 : 0, k)

    let riseW = 0
    let fallW = 0
    let secondW = 0
    if (!grounded && (this.jumpRise || this.jumpFall)) {
      if (vy > 0.35) {
        riseW = Math.min(1, vy / 3.5)
        fallW = 1 - riseW
      } else if (vy < -0.4) {
        fallW = Math.min(1, -vy / 6)
        riseW = 1 - fallW
      } else {
        riseW = fallW = 0.5
      }
      const s = riseW + fallW
      if (s > 1e-6) {
        riseW /= s
        fallW /= s
      }
      const airMag = Math.min(1, Math.abs(vy) / 1.2 + 0.35)
      riseW *= airMag
      fallW *= airMag
      if (this.secondJumpBurstSeconds > 0) {
        this.secondJumpBurstSeconds = Math.max(0, this.secondJumpBurstSeconds - delta)
        secondW = Math.min(1, this.secondJumpBurstSeconds / 0.2)
      }
    }
    let reactionW = 0
    if (this.reactionBurstSeconds > 0) {
      this.reactionBurstSeconds = Math.max(0, this.reactionBurstSeconds - delta)
      reactionW = Math.min(1, this.reactionBurstSeconds / 0.28)
    }

    const jumpMax = Math.max(riseW, fallW, secondW)
    const motionOverlay = Math.max(jumpMax, reactionW)
    const locoSuppress = 1 - 0.82 * motionOverlay

    this.jumpRise?.setEffectiveWeight(riseW)
    this.jumpFall?.setEffectiveWeight(fallW)
    this.jumpSecond?.setEffectiveWeight(secondW)
    this.reaction?.setEffectiveWeight(reactionW)

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
      hf: !!(this.stand.walkFwd || this.stand.runSlowFwd || this.stand.runSprintFwd),
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

    const dStand = ws.f + ws.b + ws.l + ws.r
    const dCrouch = wc.f + wc.b + wc.l + wc.r
    const idleStandW = standLayer * (1 - mb * dStand * locoSuppress)
    const idleCrouchW = crouchLayer * (1 - mb * dCrouch * locoSuppress)

    this.applyLocoWeights(
      this.stand,
      idleStandW,
      ws.f,
      ws.b,
      ws.l,
      ws.r,
      mb * standLayer,
      this.jogGate,
      this.sprintRunGate,
      locoSuppress,
    )
    this.applyLocoWeights(
      this.crouch,
      idleCrouchW,
      wc.f,
      wc.b,
      wc.l,
      wc.r,
      mb * crouchLayer,
      0,
      0,
      locoSuppress,
    )
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.stand.idle = null
    this.stand.walkFwd = null
    this.stand.runSlowFwd = null
    this.stand.runSprintFwd = null
    this.stand.walkBack = null
    this.stand.strafeL = null
    this.stand.strafeR = null
    this.crouch.idle = null
    this.crouch.walkFwd = null
    this.crouch.runSlowFwd = null
    this.crouch.runSprintFwd = null
    this.crouch.walkBack = null
    this.crouch.strafeL = null
    this.crouch.strafeR = null
    this.jumpRise = null
    this.jumpFall = null
    this.jumpSecond = null
    this.reaction = null
  }
}
