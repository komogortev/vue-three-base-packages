import * as THREE from 'three'
import {
  computeLandImpactTier,
  resolveCharacterOverlayClips,
  resolveWaterClips,
} from './animationOverlayAssignments'
import { resolveCharacterLocomotionClips } from './locomotionClipAssignments'
import { primarySkinnedMeshForRig } from './mixamoSkinnedMeshUtils'
import type { WaterMode } from './PlayerController'

const LAND_BURST_SECONDS = 0.42
const EDGE_CATCH_BURST_SECONDS = 0.28

export type CharacterAnimationRigConfig = {
  /** One-shot `console.info` of resolved clip names at construction. */
  debugClipResolution?: boolean
  /** Log land tier + metrics when a landing overlay fires. */
  debugAnimationTriggers?: boolean
  /**
   * One-line `console.info` when hazard / fail-jump / recovery overlays start (semantic slot + clip name).
   * Match harness `debugMovement` / `?debugMove=1` so DevTools show controller + rig together.
   */
  debugHazardEdges?: boolean
}

/**
 * FBX rigs place bones under the loaded group; `SkinnedMesh` is often a sibling.
 * Use the rig group as the mixer root when clips target named bones in the subtree
 * (e.g. remap-only `mixamorigHips.quaternion`). Use the primary `SkinnedMesh` when
 * tracks use `.bones[name]…` (e.g. `SkeletonUtils.retargetClip`).
 */
function animationRigRoot(locomotionRoot: THREE.Object3D): THREE.Object3D {
  if (locomotionRoot.children.length === 1) return locomotionRoot.children[0]!
  return locomotionRoot
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

function clipsUseSkinnedMeshMixerRoot(clips: readonly THREE.AnimationClip[]): boolean {
  for (const clip of clips) {
    for (const t of clip.tracks) {
      if (t.name.includes('.bones[')) return true
    }
  }
  return false
}

type LocoActions = {
  idle: THREE.AnimationAction | null
  walkFwd: THREE.AnimationAction | null
  runFwd: THREE.AnimationAction | null
  walkBack: THREE.AnimationAction | null
  strafeL: THREE.AnimationAction | null
  strafeR: THREE.AnimationAction | null
}

/**
 * Third-person locomotion: stand walk / single run + crouch; air + hazard + landing overlays.
 * Run forward uses **sprint** input to blend from walk. Clips in `root.userData.gltfAnimations`.
 * Steady: `locomotionClipAssignments.ts`. Overlays: `animationOverlayAssignments.ts`.
 */
export class CharacterAnimationRig {
  private readonly mixer: THREE.AnimationMixer | null = null
  private readonly config: CharacterAnimationRigConfig
  private readonly stand: LocoActions
  private readonly crouch: LocoActions
  private jumpRise: THREE.AnimationAction | null = null
  private jumpFall: THREE.AnimationAction | null = null
  private jumpSecond: THREE.AnimationAction | null = null
  private landSoft: THREE.AnimationAction | null = null
  private landMedium: THREE.AnimationAction | null = null
  private landHeavy: THREE.AnimationAction | null = null
  private landCritical: THREE.AnimationAction | null = null
  private landFatal: THREE.AnimationAction | null = null
  private landBurstSeconds = 0
  private landKind: 'soft' | 'medium' | 'heavy' | 'critical' | 'fatal' | null = null
  private edgeCatch: THREE.AnimationAction | null = null
  private wallStumble: THREE.AnimationAction | null = null
  private failJump: THREE.AnimationAction | null = null
  private recoverFromFail: THREE.AnimationAction | null = null
  private waterTread: THREE.AnimationAction | null = null
  private waterSwimFwd: THREE.AnimationAction | null = null
  /** Smoothed 0→1 blend toward swim (1) vs tread (0). */
  private waterSwimBlend = 0
  private secondJumpBurstSeconds = 0
  private edgeCatchBurstSeconds = 0
  private wallStumbleBurstSeconds = 0
  private failJumpBurstSeconds = 0
  private recoverBurstSeconds = 0
  private recoverDelaySeconds = 0

  /** 0 = idle, 1 = full locomotion layer */
  private moveBlend = 0
  /** 0 = stand poses, 1 = crouch poses */
  private crouchBlend = 0
  /** Forward run layer (0 = walk, 1 = run) while sprint held; not used when crouching. */
  private runGate = 0
  private lastGrounded = true

  private readonly _worldFwd = new THREE.Vector3()
  private readonly _worldRight = new THREE.Vector3()
  private readonly _vel = new THREE.Vector3()

  constructor(root: THREE.Object3D, config?: CharacterAnimationRigConfig) {
    this.config = config ?? {}
    const allClips = (root.userData['gltfAnimations'] as THREE.AnimationClip[] | undefined) ?? []
    const clips = dedupeClipsByName(allClips)
    const rigRoot = animationRigRoot(root)
    const skinned = primarySkinnedMeshForRig(rigRoot)
    if (!skinned || clips.length === 0) {
      this.mixer = null
      this.stand = this.emptyLoco()
      this.crouch = this.emptyLoco()
      return
    }

    // Retargeted clips bind to `.bones[…]` on the SkinnedMesh; remap-only clips bind by bone name under rigRoot.
    // Multi-mesh / wrong-primary / mixer-root hardening: see docs/threejs-engine-dev/game-systems-roadmap.md § "character animation rig".
    const mixerRoot = clipsUseSkinnedMeshMixerRoot(clips) ? skinned : rigRoot
    this.mixer = new THREE.AnimationMixer(mixerRoot)

    const {
      idleStand,
      walkFwdStand,
      walkBackStand,
      strafeLStand,
      strafeRStand,
      idleCrouch,
      walkCrouch,
      strafeLCrouch,
      strafeRCrouch,
      runFwdStand,
    } = resolveCharacterLocomotionClips(clips)

    const overlayClips = resolveCharacterOverlayClips(clips)
    const {
      jumpRise: jumpClip,
      jumpSecond: jumpSecondClip,
      jumpFall: jumpDownClip,
      landSoft: landSoftClip,
      landMedium: landMediumClip,
      landHeavy: landHeavyClip,
      landCritical: landCriticalClip,
      landFatal: landFatalClip,
      edgeCatch: edgeCatchClip,
      wallStumble: wallStumbleClip,
      failJump: failJumpClip,
      recoverFromFail: recoverClip,
    } = overlayClips

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
      runFwd: playLoop(runFwdStand, 0),
      walkBack: playLoop(walkBackStand, 0),
      strafeL: playLoop(strafeLStand, 0),
      strafeR: playLoop(strafeRStand, 0),
    }
    this.crouch = {
      idle: playLoop(idleCrouch, 0),
      walkFwd: playLoop(walkCrouch, 0),
      runFwd: null,
      walkBack: null,
      strafeL: playLoop(strafeLCrouch, 0),
      strafeR: playLoop(strafeRCrouch, 0),
    }

    this.jumpRise = playOnce(jumpClip, 0)
    this.jumpFall = playOnce(jumpDownClip, 0)
    this.jumpSecond = playOnce(jumpSecondClip, 0)
    this.landSoft = playOnce(landSoftClip, 0)
    this.landMedium = playOnce(landMediumClip, 0)
    this.landHeavy = playOnce(landHeavyClip, 0)
    this.landCritical = playOnce(landCriticalClip, 0)
    this.landFatal = playOnce(landFatalClip, 0)
    this.edgeCatch = playOnce(edgeCatchClip, 0)
    this.wallStumble = playOnce(wallStumbleClip, 0)
    this.failJump = playOnce(failJumpClip, 0)
    this.recoverFromFail = playOnce(recoverClip, 0)

    const waterClips = resolveWaterClips(clips)
    this.waterTread = playLoop(waterClips.tread, 0)
    this.waterSwimFwd = playLoop(waterClips.swimForward, 0)

    if (this.config.debugClipResolution) {
      console.info('[CharacterAnimationRig] locomotion clips', {
        idleStand: idleStand?.name,
        walkFwd: walkFwdStand?.name,
        runFwd: runFwdStand?.name,
        crouchIdle: idleCrouch?.name,
        crouchWalk: walkCrouch?.name,
      })
      console.info('[CharacterAnimationRig] overlay clips', {
        jumpRise: overlayClips.jumpRise?.name,
        jumpFall: overlayClips.jumpFall?.name,
        landSoft: overlayClips.landSoft?.name,
        landMedium: overlayClips.landMedium?.name,
        landHeavy: overlayClips.landHeavy?.name,
        landCritical: overlayClips.landCritical?.name ?? '(slot empty)',
        landFatal: overlayClips.landFatal?.name ?? '(slot empty)',
        edgeCatch: overlayClips.edgeCatch?.name,
        wallStumble: overlayClips.wallStumble?.name,
        failJump: overlayClips.failJump?.name,
        recover: overlayClips.recoverFromFail?.name,
      })
      console.info('[CharacterAnimationRig] water clips', {
        tread: waterClips.tread?.name,
        swimForward: waterClips.swimForward?.name,
        entryFall: waterClips.entryFall?.name,
      })
    }
  }

  private logHazardOverlay(slot: string, action: THREE.AnimationAction | null | undefined): void {
    if (!this.config.debugHazardEdges) return
    const clip = action?.getClip()
    console.info(
      `[CharacterAnimationRig] hazard_overlay slot=${slot} clip=${clip?.name ?? '(none)'}`,
    )
  }

  private stopLandActions(): void {
    this.landSoft?.stop()
    this.landMedium?.stop()
    this.landHeavy?.stop()
    this.landCritical?.stop()
    this.landFatal?.stop()
    this.landBurstSeconds = 0
    this.landKind = null
  }

  private playLandImpactForTier(tier: ReturnType<typeof computeLandImpactTier>): void {
    if (tier === 'none') return
    const play = (kind: 'soft' | 'medium' | 'heavy' | 'critical' | 'fatal', a: THREE.AnimationAction | null): boolean => {
      if (!a) return false
      this.landKind = kind
      this.landBurstSeconds = LAND_BURST_SECONDS
      a.reset().play()
      return true
    }
    if (tier === 'fatal') {
      if (play('fatal', this.landFatal)) return
      if (play('critical', this.landCritical)) return
      if (play('heavy', this.landHeavy)) return
      if (play('medium', this.landMedium)) return
      play('soft', this.landSoft)
      return
    }
    if (tier === 'critical') {
      if (play('critical', this.landCritical)) return
      if (play('heavy', this.landHeavy)) return
      if (play('medium', this.landMedium)) return
      play('soft', this.landSoft)
      return
    }
    if (tier === 'hard') {
      if (play('heavy', this.landHeavy)) return
      if (play('medium', this.landMedium)) return
      play('soft', this.landSoft)
      return
    }
    if (tier === 'medium') {
      if (play('medium', this.landMedium)) return
      play('soft', this.landSoft)
      return
    }
    play('soft', this.landSoft)
  }

  private emptyLoco(): LocoActions {
    return {
      idle: null,
      walkFwd: null,
      runFwd: null,
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
    runMix: number,
    locoSuppress: number,
  ): void {
    const m = moveLayer * locoSuppress
    set.idle?.setEffectiveWeight(idleW)
    const r = THREE.MathUtils.clamp(runMix, 0, 1)
    let wfWalk = wF * (1 - r)
    let wfRun = wF * r
    if (!set.runFwd && wfRun > 0) {
      wfWalk += wfRun
      wfRun = 0
    }
    if (!set.walkFwd) {
      wfRun += wfWalk
      wfWalk = 0
    }
    const crouchWalkBack = !set.walkBack && set.walkFwd && !set.runFwd
    if (crouchWalkBack) {
      const fwdBack = (wfWalk + wfRun + wB) * m
      set.walkFwd?.setEffectiveWeight(fwdBack)
      set.runFwd?.setEffectiveWeight(0)
    } else {
      set.walkFwd?.setEffectiveWeight(wfWalk * m)
      set.runFwd?.setEffectiveWeight(wfRun * m)
      set.walkBack?.setEffectiveWeight(wB * m)
    }
    set.strafeL?.setEffectiveWeight(wL * m)
    set.strafeR?.setEffectiveWeight(wR * m)
  }

  /**
   * @param velocity — world-space velocity (m/s); **y** used for jump rise vs fall blend.
   * @param opts.grounded — false while airborne (jump arc).
   * @param opts.sprint — forward run clip vs walk when held (stand layer only).
   * @param opts.landFallDistance — from `PlayerController` `landed` event (meters); landing overlay tier.
   * @param opts.landAirTimeSeconds — from `landed` event; combined with fall for tier when present.
   */
  update(
    delta: number,
    root: THREE.Object3D,
    velocity: { x: number; y: number; z: number },
    opts: {
      crouch?: boolean
      sprint?: boolean
      /** Jogging gait (between walk and sprint). Reserved for future locomotion blend. */
      jog?: boolean
      grounded?: boolean
      /** Fall distance (m) on the frame ground contact is detected; see `consumeEvents` `landed`. */
      landFallDistance?: number
      /** Air time (s) on landing; optional if `landFallDistance` alone is enough. */
      landAirTimeSeconds?: number
      /** Set true for the frame where a second jump is triggered. */
      secondJumpTrigger?: boolean
      /** Set true for the frame where ledge catch blocks movement. */
      edgeCatchTrigger?: boolean
      /** Set true for the frame where walk into wall stumbles back. */
      wallStumbleTrigger?: boolean
      /** Set true for failed jump into too-high ledge. */
      failedJumpTrigger?: boolean
      /**
       * Current water sub-mode from `PlayerController.getWaterMode()`.
       * When non-null, ground locomotion + air overlays are suppressed and water clips play.
       */
      waterMode?: WaterMode | null
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
      this.stopLandActions()
      this.jumpRise?.reset().play()
      this.jumpFall?.reset().play()
      this.jumpSecond?.reset().play()
    }
    if (land) {
      this.jumpRise?.stop()
      this.jumpFall?.stop()
      this.jumpSecond?.stop()
      this.edgeCatch?.stop()
      this.wallStumble?.stop()
      this.failJump?.stop()
      this.recoverFromFail?.stop()
      this.landCritical?.stop()
      this.landFatal?.stop()
      this.secondJumpBurstSeconds = 0
      this.edgeCatchBurstSeconds = 0
      this.wallStumbleBurstSeconds = 0
      this.failJumpBurstSeconds = 0
      this.recoverBurstSeconds = 0
      this.recoverDelaySeconds = 0
      this.stopLandActions()
      const landTier = computeLandImpactTier(opts.landFallDistance, opts.landAirTimeSeconds)
      if (this.config.debugAnimationTriggers && landTier !== 'none') {
        console.info('[CharacterAnimationRig] land impact', {
          tier: landTier,
          fallM: opts.landFallDistance,
          airS: opts.landAirTimeSeconds,
        })
      }
      this.playLandImpactForTier(landTier)
    }
    if (opts.secondJumpTrigger) {
      this.secondJumpBurstSeconds = 0.2
      this.jumpSecond?.reset().play()
    }
    if (opts.edgeCatchTrigger) {
      this.edgeCatchBurstSeconds = EDGE_CATCH_BURST_SECONDS
      this.edgeCatch?.reset().play()
      this.logHazardOverlay('hazard.pit.edge_catch', this.edgeCatch)
    }
    if (opts.wallStumbleTrigger) {
      this.wallStumbleBurstSeconds = 0.42
      this.wallStumble?.reset().play()
      this.logHazardOverlay('hazard.wall.stumble', this.wallStumble)
    }
    if (opts.failedJumpTrigger) {
      this.failJumpBurstSeconds = 0.58
      this.recoverDelaySeconds = 0.34
      this.recoverBurstSeconds = 0
      this.failJump?.reset().play()
      this.logHazardOverlay('air.fail.high_ledge', this.failJump)
    }

    const k = 1 - Math.exp(-delta * 10)
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, crouchHeld ? 1 : 0, k)

    const hasStandLoco =
      this.stand.walkFwd ||
      this.stand.runFwd ||
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
        if (this.stand.walkFwd || this.stand.runFwd || this.crouch.walkFwd) {
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

    const wantRunAnim =
      !!this.stand.runFwd &&
      sprintHeld &&
      !crouchHeld &&
      grounded &&
      speed > 0.12 &&
      forwardSpeed > 0.04 &&
      this.moveBlend > 0.2
    this.runGate = THREE.MathUtils.lerp(this.runGate, wantRunAnim ? 1 : 0, k)

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
    let edgeCatchW = 0
    if (this.edgeCatchBurstSeconds > 0) {
      this.edgeCatchBurstSeconds = Math.max(0, this.edgeCatchBurstSeconds - delta)
      edgeCatchW = Math.min(1, this.edgeCatchBurstSeconds / EDGE_CATCH_BURST_SECONDS)
    }

    let landW = 0
    if (this.landBurstSeconds > 0) {
      this.landBurstSeconds = Math.max(0, this.landBurstSeconds - delta)
      landW = Math.min(1, this.landBurstSeconds / LAND_BURST_SECONDS)
      if (this.landBurstSeconds <= 1e-6) this.landKind = null
    }
    let wallStumbleW = 0
    if (this.wallStumbleBurstSeconds > 0) {
      this.wallStumbleBurstSeconds = Math.max(0, this.wallStumbleBurstSeconds - delta)
      wallStumbleW = Math.min(1, this.wallStumbleBurstSeconds / 0.42)
    }
    let failJumpW = 0
    if (this.failJumpBurstSeconds > 0) {
      this.failJumpBurstSeconds = Math.max(0, this.failJumpBurstSeconds - delta)
      failJumpW = Math.min(1, this.failJumpBurstSeconds / 0.58)
    }
    let recoverW = 0
    if (this.recoverDelaySeconds > 0) {
      this.recoverDelaySeconds = Math.max(0, this.recoverDelaySeconds - delta)
      if (this.recoverDelaySeconds <= 0) {
        this.recoverBurstSeconds = 0.56
        this.recoverFromFail?.reset().play()
        this.logHazardOverlay('recovery.failed_jump.exit', this.recoverFromFail)
      }
    }
    if (this.recoverBurstSeconds > 0) {
      this.recoverBurstSeconds = Math.max(0, this.recoverBurstSeconds - delta)
      recoverW = Math.min(1, this.recoverBurstSeconds / 0.56)
    }

    const jumpMax = Math.max(riseW, fallW, secondW)
    const motionOverlay = Math.max(
      jumpMax,
      edgeCatchW,
      wallStumbleW,
      failJumpW,
      recoverW,
      landW,
    )

    // ── Water mode — suppress all ground/air layers; blend tread ↔ swim ──────
    const inWater = opts.waterMode != null
    const kWater = 1 - Math.exp(-delta * 6)
    this.waterSwimBlend = THREE.MathUtils.lerp(
      this.waterSwimBlend,
      inWater && opts.waterMode === 'swim' ? 1 : 0,
      kWater,
    )
    const waterTotal = inWater ? 1 : 0
    this.waterTread?.setEffectiveWeight(waterTotal * (1 - this.waterSwimBlend))
    this.waterSwimFwd?.setEffectiveWeight(waterTotal * this.waterSwimBlend)

    if (inWater) {
      // Zero out all non-water clips to avoid bleed.
      this.jumpRise?.setEffectiveWeight(0)
      this.jumpFall?.setEffectiveWeight(0)
      this.jumpSecond?.setEffectiveWeight(0)
      this.landSoft?.setEffectiveWeight(0)
      this.landMedium?.setEffectiveWeight(0)
      this.landHeavy?.setEffectiveWeight(0)
      this.landCritical?.setEffectiveWeight(0)
      this.landFatal?.setEffectiveWeight(0)
      this.edgeCatch?.setEffectiveWeight(0)
      this.wallStumble?.setEffectiveWeight(0)
      this.failJump?.setEffectiveWeight(0)
      this.recoverFromFail?.setEffectiveWeight(0)
      this.applyLocoWeights(this.stand, 0, 0, 0, 0, 0, 0, 0, 0)
      this.applyLocoWeights(this.crouch, 0, 0, 0, 0, 0, 0, 0, 0)
      return
    }

    // Non-water: zero water clips.
    this.waterTread?.setEffectiveWeight(0)
    this.waterSwimFwd?.setEffectiveWeight(0)

    const locoSuppress = 1 - 0.82 * motionOverlay

    this.jumpRise?.setEffectiveWeight(riseW)
    this.jumpFall?.setEffectiveWeight(fallW)
    this.jumpSecond?.setEffectiveWeight(secondW)
    this.landSoft?.setEffectiveWeight(this.landKind === 'soft' ? landW : 0)
    this.landMedium?.setEffectiveWeight(this.landKind === 'medium' ? landW : 0)
    this.landHeavy?.setEffectiveWeight(this.landKind === 'heavy' ? landW : 0)
    this.landCritical?.setEffectiveWeight(this.landKind === 'critical' ? landW : 0)
    this.landFatal?.setEffectiveWeight(this.landKind === 'fatal' ? landW : 0)
    this.edgeCatch?.setEffectiveWeight(edgeCatchW)
    this.wallStumble?.setEffectiveWeight(wallStumbleW)
    this.failJump?.setEffectiveWeight(failJumpW)
    this.recoverFromFail?.setEffectiveWeight(recoverW)

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
      hf: !!(this.stand.walkFwd || this.stand.runFwd),
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
      this.runGate,
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
      locoSuppress,
    )
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.stand.idle = null
    this.stand.walkFwd = null
    this.stand.runFwd = null
    this.stand.walkBack = null
    this.stand.strafeL = null
    this.stand.strafeR = null
    this.crouch.idle = null
    this.crouch.walkFwd = null
    this.crouch.runFwd = null
    this.crouch.walkBack = null
    this.crouch.strafeL = null
    this.crouch.strafeR = null
    this.jumpRise = null
    this.jumpFall = null
    this.jumpSecond = null
    this.landSoft = null
    this.landMedium = null
    this.landHeavy = null
    this.landCritical = null
    this.landFatal = null
    this.edgeCatch = null
    this.wallStumble = null
    this.failJump = null
    this.recoverFromFail = null
  }
}
