import * as THREE from 'three'
import type { TerrainSurfaceSampler } from './terrainSurface'
import {
  resolveConsequence,
  type ConsequenceAction,
  type ConsequenceHazardType,
  type ConsequenceLocomotionClass,
  type ConsequenceSeverity,
} from './consequencePolicy'

/** Pivot-centre-to-ground distance for the default CapsuleGeometry(0.35, 1.0). Keep in sync with SceneBuilder. */
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.85

/**
 * Default extra world Y on the locomotion root when fully crouched (scaled by a smoothed 0–1 blend).
 * Negative values lower the root so Mixamo-style crouch clips stay foot-grounded; stand pose was used for feet alignment.
 */
export const DEFAULT_SKINNED_CROUCH_TERRAIN_Y_DELTA = -0.45

/**
 * Serializable snapshot for HUD, editor tooling, replays, or debug overlays.
 * Not updated by reference — call `getSnapshot()` each time you need fresh data.
 */
export interface PlayerControllerState {
  position: { x: number; y: number; z: number }
  /** Y-axis rotation in radians (character forward). */
  facing: number
  /** World-space velocity this frame (m/s), before terrain snap. Y reserved for jump / gravity later. */
  velocity: { x: number; y: number; z: number }
  /** Whether the controller considers the character supported by ground this frame. */
  grounded: boolean
  /** Last raw move axis from input (typically -1..1). */
  moveIntent: { x: number; y: number }
  /** Crouch binding held this frame (after tick); default keyboard bind is **C** (`@base/input`). */
  crouching: boolean
  /** Shift / sprint binding held and not crouching (after tick). */
  sprinting: boolean
  /** True while a jump press is still inside the buffer window (see {@link notifyJumpPressed}). */
  jumpBuffered: boolean
  /** Non-null when `PlayerMode === 'water'` — sub-state within the water mode. */
  waterMode: WaterMode | null
}

export type PlayerControllerEvent =
  | { type: 'jump_started'; jumpIndex: number }
  | { type: 'extra_jump_used'; jumpIndex: number; remainingExtraJumps: number }
  | { type: 'edge_catch' }
  | { type: 'wall_stumble' }
  | { type: 'jump_failed_high_ledge' }
  | {
      type: 'hazard_consequence_debug'
      hazardType: ConsequenceHazardType
      locomotionClass: ConsequenceLocomotionClass
      bypassActive: boolean
      action: ConsequenceAction
      severity: ConsequenceSeverity
    }
  | { type: 'landed'; airTimeSeconds: number; fallDistance: number }
  | { type: 'water_entered' }
  | { type: 'water_exited' }

export type PlayerMode = 'grounded' | 'airborne' | 'recovery_locked' | 'water'
export type HazardMode = 'none' | 'pit_warning' | 'pit_bypass_window' | 'wall_stumble'
export type AirMode = 'jump_rise' | 'jump_fall' | 'failed_high_ledge'
export type RecoveryMode = 'from_failed_jump' | 'from_wall_stumble'
/** Sub-mode while `PlayerMode === 'water'`. */
export type WaterMode = 'tread' | 'swim'

interface PlayerControllerInternalState {
  mode: PlayerMode
  hazardMode: HazardMode
  airMode: AirMode | null
  recoveryMode: RecoveryMode | null
  waterMode: WaterMode | null
  pitWarningRepeatTimer: number
  pitBypassRemaining: number
  recoveryLockRemaining: number
  takeoffGroundY: number
  airborneTimeSeconds: number
  airApexY: number
}

interface HazardSample {
  stepUp: number
  dropAhead: number
  pitAhead: boolean
  wallAhead: boolean
}

interface GroundedHazardTransitionContext {
  inputActive: boolean
  sprintHeld: boolean
  crouchHeld: boolean
  sampler: TerrainSurfaceSampler | undefined
  character: THREE.Object3D
  moveDir: THREE.Vector3
  delta: number
}

interface AirborneTransitionContext {
  sampler: TerrainSurfaceSampler
  character: THREE.Object3D
  crouchHeld: boolean
  playableRadius: number
  edgeMargin: number
  baseYOffset: number
  groundY: number
  targetGroundY: number
  gravity: number
  jumpV: number
  delta: number
}

interface PlayerTransitionSnapshot {
  mode: PlayerMode
  hazardMode: HazardMode
  airMode: AirMode | null
  recoveryMode: RecoveryMode | null
  waterMode: WaterMode | null
}

interface TransitionEventMeta {
  jumpStarted?: { jumpIndex: number }
  extraJumpUsed?: { jumpIndex: number; remainingExtraJumps: number }
  pitWarningPulse?: boolean
  wallStumblePulse?: boolean
  landed?: { airTimeSeconds: number; fallDistance: number }
  waterEntered?: boolean
  waterExited?: boolean
  consequenceDebug?: {
    hazardType: ConsequenceHazardType
    locomotionClass: ConsequenceLocomotionClass
    bypassActive: boolean
    action: ConsequenceAction
    severity: ConsequenceSeverity
  }
}

export interface PlayerControllerConfig {
  characterSpeed: number
  /** Multiplier while sprint key held (not while crouching). */
  runSpeedMultiplier: number
  /** Multiplier while crouch key held. */
  crouchSpeedMultiplier: number
  facingLerp: number
  /** Distance inside playable radius before edge clamp (matches previous 1.5 m margin). */
  edgeMargin: number
  /**
   * Initial world Y offset from sampled terrain to character **root** when grounded.
   * Capsule (centre pivot): use {@link PLAYER_CAPSULE_HALF_HEIGHT}. GLTF (feet pivot): usually 0 — override via {@link setTerrainYOffset} after `SceneBuilder` if needed.
   */
  terrainYOffset: number
  /**
   * When greater than 0, ground Y is the **minimum** of `sample` at (x,z) and four points ±radius on X/Z.
   * Stops the avatar from looking like it stands on a flat “carpet” while terrain dips under the feet.
   */
  terrainFootprintRadius?: number
  /**
   * When true (default), camera-relative move intent with **negative Y** (back on the stick / S) only
   * translates the character; body facing is not rotated toward that direction. Velocity still opposes
   * facing so walk-back plays, and third-person cameras keyed off {@link getFacing} stay stable.
   * Set false to always rotate toward the full move vector (legacy “moonwalk the camera” feel).
   */
  backwardWithoutBodyTurn?: boolean
  /**
   * When movement opposes body forward (walk-back / retreat), locomotion speed is lerped toward this
   * fraction of the current speed, weighted by how much the move vector faces backward (0 = full speed, 1 = full multiplier).
   * Typical Mixamo walk-back cycles are shorter per meter than forward walk — default 0.25 (25% of forward when straight back).
   */
  backwardSpeedMultiplier?: number
  /**
   * World-space Y added to the grounded root each frame, scaled by a smoothed crouch factor (0 = stand, 1 = full crouch).
   * Use a **negative** value so skinned crouch poses (aligned in bind/stand) stay visually on the terrain.
   * Default **0**; harnesses with Mixamo GLTF often set {@link DEFAULT_SKINNED_CROUCH_TERRAIN_Y_DELTA} after load.
   */
  crouchTerrainYOffsetDelta?: number
  /**
   * Camera-relative strafe (move intent X) scale vs forward/back (intent Y) at the same `speed`.
   * When omitted, uses {@link backwardSpeedMultiplier} so A/D matches straight retreat speed.
   */
  strafeSpeedMultiplier?: number
  /**
   * Camera-basis (first-person style) strafe scale vs forward/back at the same `speed`.
   * Default 0.5 so side-step remains responsive but slower than forward motion.
   */
  cameraStrafeSpeedMultiplier?: number
  /**
   * Max rise in sampled ground height allowed for one movement step while grounded.
   * Overrides {@link maxWalkableSlopeDeg} when set explicitly.
   */
  maxStepUpHeight?: number
  /**
   * Steepest slope (degrees) the character can walk up without triggering a wall stumble.
   * Converted to a height-delta limit against the forward probe horizon
   * (`feetToHips × cliffProbeDistanceMultiplier`). Default **35°** — allows gentle hills
   * while still blocking near-vertical ledge faces (≥ 45° will feel very steep).
   * Ignored when {@link maxStepUpHeight} is set explicitly.
   */
  maxWalkableSlopeDeg?: number
  /**
   * Drop threshold that triggers cliff-edge behavior while grounded.
   * - walk/jog: movement is rejected ("catch at edge")
   * - sprint: movement is allowed and controller immediately leaves ground
   */
  cliffDropCatchThreshold?: number
  /**
   * Multiplier for forward hazard probe distance while grounded.
   * Higher values look farther ahead for delayed drop-offs on gentle approach slopes.
   */
  cliffProbeDistanceMultiplier?: number
  /**
   * Seconds of pit bypass granted after the player releases movement following an edge-catch warning.
   * During this window, pushing back toward the pit is allowed and transitions into a fall.
   */
  cliffEdgeReleaseBypassSeconds?: number
  /** Horizontal retreat distance applied when high-ledge jump fails. */
  failedJumpBackstepDistance?: number
  /** Input lockout after failed high-ledge jump while recovery plays. */
  failedJumpRecoverySeconds?: number
  /** Horizontal retreat distance applied when walking into a too-high wall. */
  wallStumbleBackstepDistance?: number
  /** Initial upward velocity when jump triggers (m/s). Only with a terrain `sampler`. */
  jumpVelocity?: number
  /** Gravity while airborne (m/s²). */
  gravity?: number
  /**
   * When true, throttled `console.log` logs camera basis, intent, move vector, and facing
   * (use to trace circling / drift: camera vs body, backward scale, lerp).
   */
  debugMovement?: boolean
  /**
   * When true, `console.log` logs jump arc metrics on each landing:
   * peak height, fall distance, air time, and effective gravity / velocity config.
   * Use to calibrate `jumpVelocity` and `gravity`.
   */
  debugJumpArc?: boolean
  /** Min seconds between debug lines; default 0.12. */
  debugMovementLogIntervalSec?: number
  /**
   * XZ basis for locomotion intent:
   * - **`facing`** (default): body forward/right from {@link getFacing}. Use with follow cams placed
   *   **behind** the character (same frame as `placeCamera` back/right offsets). Hold W walks straight;
   *   camera world yaw no longer feeds a spiral.
   * - **`camera`**: leveled camera yaw + fallbacks — for detached / orbit-mouse / cinematic cameras.
   */
  movementBasis?: 'facing' | 'camera'
  /** How many extra airborne jumps are allowed after the initial grounded jump. Default: 0 (disabled). */
  extraJumps?: number
  /**
   * Optional gate called when attempting an airborne extra jump.
   * Return false to reject the buffered jump attempt.
   */
  canUseExtraJump?: () => boolean
  /**
   * Opt-in consequence resolver for grounded wall/pit reactions.
   * Default false to preserve legacy branching semantics unless explicitly enabled.
   */
  useConsequenceResolver?: boolean

  // ── Water mode ─────────────────────────────────────────────────────────────

  /**
   * Explicit swimmable volumes — XZ rectangles each with their own surface Y.
   * When set, takes priority over {@link waterSurfaceY} for water entry/exit.
   * Source: `SceneDescriptor.swimmableVolumes` (pass directly from descriptor).
   * @see {@link setSwimmableVolumes}
   */
  swimmableVolumes?: Array<{ bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; surfaceY: number }>
  /**
   * Fallback global water surface Y when no {@link swimmableVolumes} are configured.
   * Activates water physics across the entire playable disc at this Y.
   * Source: `SceneDescriptor.terrain.seaLevel` for simple flat-ocean scenes.
   */
  waterSurfaceY?: number
  /**
   * Depth (m) below the water surface at which the controller switches from grounded walking
   * to full swim mode.  Default **1.5 m** — roughly shoulder height for a 1.78 m character,
   * so the character wades naturally through shallow water before starting to swim.
   *
   * Replaces the old `waterAnkleDepth` (0.1 m) which triggered too eagerly.
   */
  waterSwimDepth?: number
  /**
   * @deprecated Use {@link waterSwimDepth} instead.
   * Kept for backwards-compat; ignored when `waterSwimDepth` is set.
   */
  waterAnkleDepth?: number
  /**
   * How far above the water surface (m) the sampled terrain must rise before the controller
   * exits water mode and returns to `grounded`. Default **0.3** m.
   */
  waterShoreThreshold?: number
  /**
   * Per-frame horizontal velocity multiplier while in water (applied every tick).
   * Values < 1 create drag; default **0.88** gives a smooth deceleration feel.
   */
  waterDragFactor?: number
  /**
   * Swim speed as a fraction of `characterSpeed`. Default **0.4**.
   */
  waterSwimSpeedFactor?: number
  /**
   * Upward spring force (m/s²) applied when the character is below the water surface target Y.
   * Also used as the downward spring force when above target. Default **12**.
   */
  waterBuoyancy?: number
}

const DEFAULT_CFG: PlayerControllerConfig = {
  characterSpeed: 7,
  runSpeedMultiplier: 1.65,
  crouchSpeedMultiplier: 0.42,
  facingLerp: 12,
  edgeMargin: 1.5,
  terrainYOffset: PLAYER_CAPSULE_HALF_HEIGHT,
  terrainFootprintRadius: 0,
  backwardWithoutBodyTurn: true,
  backwardSpeedMultiplier: 0.25,
  crouchTerrainYOffsetDelta: 0,
  cameraStrafeSpeedMultiplier: 0.5,
  cliffProbeDistanceMultiplier: 2,
  cliffEdgeReleaseBypassSeconds: 2,
  failedJumpBackstepDistance: 0.9,
  failedJumpRecoverySeconds: 1.1,
  wallStumbleBackstepDistance: 0.9,
  jumpVelocity: 6.75,
  gravity: 30,
  movementBasis: 'facing',
  extraJumps: 0,
  useConsequenceResolver: false,
}

export interface PlayerControllerTickContext {
  camera: THREE.PerspectiveCamera
  character: THREE.Object3D
  sampler: TerrainSurfaceSampler | undefined
  /** Outer limit of playable disc (world XZ). */
  playableRadius: number
  /** Locomotion axis: sprint (Shift / gamepad bind). */
  sprintHeld: boolean
  /** Locomotion axis: crouch (keyboard default **C** via `@base/input`; gamepad if mapped). */
  crouchHeld: boolean
  /**
   * Per-tick override for {@link PlayerControllerConfig.facingLerp}.
   * Used by the scene module to apply a slower turn rate in third-person camera mode.
   */
  facingLerpOverride?: number
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return current + diff * Math.min(1, t)
}

function shortestAngleDiffRad(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Lowest terrain Y under a small + footprint (centre + ±radius on X/Z). */
export function sampleTerrainFootprintY(
  sampler: TerrainSurfaceSampler,
  x: number,
  z: number,
  footprintR: number,
): number {
  if (footprintR <= 0) return sampler.sample(x, z)
  const y0 = sampler.sample(x, z)
  const y1 = sampler.sample(x + footprintR, z)
  const y2 = sampler.sample(x - footprintR, z)
  const y3 = sampler.sample(x, z + footprintR)
  const y4 = sampler.sample(x, z - footprintR)
  return Math.min(y0, y1, y2, y3, y4)
}

/**
 * Owns locomotion state for a single controllable character: intent, facing, horizontal velocity, grounded.
 * Camera-relative walk on XZ; optional terrain height snap and jump via {@link TerrainSurfaceSampler}.
 *
 * Camera rig and environment live outside this class (e.g. scene modules).
 */
export class PlayerController {
  private readonly cfg: PlayerControllerConfig

  /** Ground contact offset in world Y; updated when swapping capsule ↔ GLTF. */
  private terrainYOffset: number

  /** Min-height footprint radius for terrain sampling (0 = centre sample only). */
  private terrainFootprintRadius: number

  private facing = 0
  private readonly moveIntent = { x: 0, y: 0 }
  private readonly velocity = new THREE.Vector3()
  private grounded = true
  private jumpBufferTime = 0
  private availableExtraJumps = 0
  private verticalVelocity = 0
  private crouchHeld = false
  private sprintHeld = false
  /** Smoothed 0–1 from crouch input; matches locomotion clip cross-fade rate. */
  private crouchGroundBlend = 0
  /** Mutable; see {@link PlayerControllerConfig.crouchTerrainYOffsetDelta} and {@link setCrouchTerrainYOffsetDelta}. */
  private crouchTerrainYOffsetDelta: number

  private debugMovementLogAcc = 0
  private readonly pendingEvents: PlayerControllerEvent[] = []
  private readonly state: PlayerControllerInternalState = {
    mode: 'grounded',
    hazardMode: 'none',
    airMode: null,
    recoveryMode: null,
    waterMode: null,
    pitWarningRepeatTimer: 0,
    pitBypassRemaining: 0,
    recoveryLockRemaining: 0,
    takeoffGroundY: 0,
    airborneTimeSeconds: 0,
    airApexY: 0,
  }
  private wallStumbleCooldownSeconds = 0

  private readonly _camDir = new THREE.Vector3()
  private readonly _camRight = new THREE.Vector3()
  private readonly _moveDir = new THREE.Vector3()
  private readonly _camWorldQuat = new THREE.Quaternion()
  private readonly _eulerYaw = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly _levelCamQuat = new THREE.Quaternion()
  private readonly _dbgCamLook = new THREE.Vector3()

  constructor(cfg: Partial<PlayerControllerConfig> = {}) {
    this.cfg = { ...DEFAULT_CFG, ...cfg }
    this.terrainYOffset = this.cfg.terrainYOffset
    this.terrainFootprintRadius = this.cfg.terrainFootprintRadius ?? 0
    this.crouchTerrainYOffsetDelta = this.cfg.crouchTerrainYOffsetDelta ?? 0
    this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
    if (this.cfg.debugMovement) {
      console.log(
        '[PlayerController] debugMovement on — throttled [PlayerController.move] while locomotion input active',
      )
    }
  }

  private getFeetToHipsLengthEstimate(): number {
    return Math.max(0.6, Math.abs(this.terrainYOffset))
  }

  private isInputActive(intent: { x: number; y: number }): boolean {
    return Math.abs(intent.x) > 0.01 || Math.abs(intent.y) > 0.01
  }

  private isPitAhead(dropAhead: number, feetToHips: number): boolean {
    const cliffDropCatch = this.cfg.cliffDropCatchThreshold ?? feetToHips * (2 / 3)
    return dropAhead > cliffDropCatch
  }

  private isWallAhead(stepUp: number, feetToHips: number): boolean {
    const maxStepUp = this.cfg.maxStepUpHeight ?? this.slopeMaxStepUp(feetToHips)
    return stepUp > maxStepUp
  }

  /**
   * Convert `maxWalkableSlopeDeg` (default 35°) to a height-delta limit over the probe horizon.
   * The probe looks `feetToHips × probeMul` ahead, so max allowable rise = horizon × tan(angleDeg).
   */
  private slopeMaxStepUp(feetToHips: number): number {
    const probeMul = this.cfg.cliffProbeDistanceMultiplier ?? 2
    const probeHorizon = feetToHips * probeMul
    const deg = this.cfg.maxWalkableSlopeDeg ?? 35
    return probeHorizon * Math.tan((deg * Math.PI) / 180)
  }

  private canBypassPit(): boolean {
    return this.state.pitBypassRemaining > 0
  }

  private canStartJump(crouchHeld: boolean): boolean {
    return this.jumpBufferTime > 0 && !crouchHeld
  }

  private canUseExtraJump(crouchHeld: boolean): boolean {
    return (
      this.jumpBufferTime > 0 &&
      this.availableExtraJumps > 0 &&
      !crouchHeld &&
      (this.cfg.canUseExtraJump?.() ?? true)
    )
  }

  private isLandingTooHigh(landingGroundY: number, feetToHips: number): boolean {
    const maxLandingGroundY = this.state.takeoffGroundY + feetToHips
    return landingGroundY > maxLandingGroundY + 1e-4
  }

  private isRecoveryLocked(): boolean {
    return this.state.recoveryLockRemaining > 0
  }

  private sampleGroundDropAhead(
    sampler: TerrainSurfaceSampler,
    x: number,
    z: number,
    moveDirX: number,
    moveDirZ: number,
    stepDistance: number,
  ): { stepUp: number; dropAhead: number } {
    const currentGroundY = sampleTerrainFootprintY(
      sampler,
      x,
      z,
      this.terrainFootprintRadius,
    )
    const feetToHips = this.getFeetToHipsLengthEstimate()
    const probeMul = this.cfg.cliffProbeDistanceMultiplier ?? 2
    const horizon = Math.max(stepDistance, feetToHips * probeMul)
    const samples = 3
    let maxRiseAhead = Number.NEGATIVE_INFINITY
    let minGroundAhead = Number.POSITIVE_INFINITY
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples
      const px = x + moveDirX * horizon * t
      const pz = z + moveDirZ * horizon * t
      const gy = sampleTerrainFootprintY(sampler, px, pz, this.terrainFootprintRadius)
      if (gy > maxRiseAhead) maxRiseAhead = gy
      if (gy < minGroundAhead) minGroundAhead = gy
    }
    return {
      stepUp: maxRiseAhead - currentGroundY,
      dropAhead: currentGroundY - minGroundAhead,
    }
  }

  private computeHazards(
    sampler: TerrainSurfaceSampler,
    character: THREE.Object3D,
    moveDirX: number,
    moveDirZ: number,
    delta: number,
  ): HazardSample {
    const feetToHips = this.getFeetToHipsLengthEstimate()
    const speed = Math.hypot(moveDirX, moveDirZ)
    const stepDistance = speed * delta
    const dirLen = speed
    const dirX = dirLen > 1e-8 ? moveDirX / dirLen : 0
    const dirZ = dirLen > 1e-8 ? moveDirZ / dirLen : 0
    const { stepUp, dropAhead } = this.sampleGroundDropAhead(
      sampler,
      character.position.x,
      character.position.z,
      dirX,
      dirZ,
      stepDistance,
    )
    const cliffDropCatch = this.cfg.cliffDropCatchThreshold ?? feetToHips * (2 / 3)
    return {
      stepUp,
      dropAhead,
      pitAhead: this.isPitAhead(dropAhead, feetToHips),
      wallAhead: this.isWallAhead(stepUp, feetToHips),
    }
  }

  private resolveGroundedHazardTransition(ctx: GroundedHazardTransitionContext): {
    forceLeaveGround: boolean
  } {
    const prev = this.captureTransitionSnapshot()
    const {
      inputActive,
      sprintHeld,
      crouchHeld,
      sampler,
      character,
      moveDir,
      delta,
    } = ctx

    // pit_warning -> pit_bypass_window on release.
    if (!inputActive && this.state.hazardMode === 'pit_warning') {
      this.state.hazardMode = 'pit_bypass_window'
      this.state.pitBypassRemaining = Math.max(0, this.cfg.cliffEdgeReleaseBypassSeconds ?? 2)
    }

    // pit_bypass_window -> none on timer expiry.
    if (this.state.hazardMode === 'pit_bypass_window' && this.state.pitBypassRemaining <= 0) {
      this.state.hazardMode = 'none'
    }

    if (!inputActive || !sampler || !this.grounded) {
      return { forceLeaveGround: false }
    }

    const dirLen = Math.hypot(moveDir.x, moveDir.z)
    const dirX = dirLen > 1e-8 ? moveDir.x / dirLen : 0
    const dirZ = dirLen > 1e-8 ? moveDir.z / dirLen : 0
    const hazards = this.computeHazards(sampler, character, moveDir.x, moveDir.z, delta)
    if (this.cfg.debugMovement && hazards.wallAhead) {
      const fth = this.getFeetToHipsLengthEstimate()
      const maxStep = this.cfg.maxStepUpHeight ?? this.slopeMaxStepUp(fth)
      const deg = this.cfg.maxWalkableSlopeDeg ?? 35
      console.log(
        `[PlayerController] wall rejection stepUp=${hazards.stepUp.toFixed(3)}m` +
        ` maxStep=${maxStep.toFixed(3)}m (${deg}°)`,
      )
    }
    const locomotionClass: ConsequenceLocomotionClass =
      sprintHeld && !crouchHeld ? 'sprint' : 'walk_like'

    if (hazards.wallAhead) {
      if (this.cfg.useConsequenceResolver) {
        const resolution = resolveConsequence({
          hazardType: 'wall',
          locomotionClass,
          bypassActive: this.canBypassPit(),
        })
        if (resolution.action !== 'wall_stumble') return { forceLeaveGround: false }
      }
      this.state.hazardMode = 'wall_stumble'
      const backstep = Math.max(0.4, this.cfg.wallStumbleBackstepDistance ?? 0.9)
      character.position.x -= dirX * backstep
      character.position.z -= dirZ * backstep
      moveDir.set(0, 0, 0)
      if (this.wallStumbleCooldownSeconds <= 0) {
        this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
          wallStumblePulse: true,
          consequenceDebug: this.cfg.useConsequenceResolver
            ? {
                hazardType: 'wall',
                locomotionClass,
                bypassActive: this.canBypassPit(),
                action: 'wall_stumble',
                severity: 'L1',
              }
            : undefined,
        })
        this.wallStumbleCooldownSeconds = 0.25
      }
      return { forceLeaveGround: false }
    }

    if (hazards.pitAhead) {
      if (this.cfg.useConsequenceResolver) {
        const resolution = resolveConsequence({
          hazardType: 'pit',
          locomotionClass,
          bypassActive: this.canBypassPit(),
        })
        if (resolution.action === 'pit_fall' || resolution.action === 'pit_bypass_fall') {
          if (resolution.action === 'pit_bypass_fall') this.state.hazardMode = 'pit_bypass_window'
          this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
            consequenceDebug: {
              hazardType: 'pit',
              locomotionClass,
              bypassActive: this.canBypassPit(),
              action: resolution.action,
              severity: resolution.severity,
            },
          })
          return { forceLeaveGround: true }
        }
        this.state.hazardMode = 'pit_warning'
        moveDir.set(0, 0, 0)
        if (this.state.pitWarningRepeatTimer <= 0) {
          this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
            pitWarningPulse: true,
            consequenceDebug: {
              hazardType: 'pit',
              locomotionClass,
              bypassActive: this.canBypassPit(),
              action: resolution.action,
              severity: resolution.severity,
            },
          })
          this.state.pitWarningRepeatTimer = 0.18
        }
        return { forceLeaveGround: false }
      }
      if (sprintHeld && !crouchHeld) {
        return { forceLeaveGround: true }
      }
      const bypassActive = this.canBypassPit()
      if (bypassActive) {
        this.state.hazardMode = 'pit_bypass_window'
        return { forceLeaveGround: true }
      }
      this.state.hazardMode = 'pit_warning'
      moveDir.set(0, 0, 0)
      if (this.state.pitWarningRepeatTimer <= 0) {
        this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), { pitWarningPulse: true })
        this.state.pitWarningRepeatTimer = 0.18
      }
      return { forceLeaveGround: false }
    }

    this.state.hazardMode = 'none'
    return { forceLeaveGround: false }
  }

  private beginAirborne(airMode: AirMode, character: THREE.Object3D): void {
    this.grounded = false
    this.state.mode = 'airborne'
    this.state.airMode = airMode
    this.state.airborneTimeSeconds = 0
    this.state.takeoffGroundY = character.position.y - this.terrainYOffset
    this.state.airApexY = character.position.y
  }

  // ── Water helpers ──────────────────────────────────────────────────────────

  /**
   * Find the surface Y of the first swimmable volume whose XZ bounds contain (x, z).
   * Falls back to the global `waterSurfaceY` when no volumes are configured.
   * Returns `null` when water is not configured or the position is outside all volumes.
   */
  private findWaterSurfaceAt(x: number, z: number): number | null {
    const vols = this.cfg.swimmableVolumes
    if (vols && vols.length > 0) {
      for (const vol of vols) {
        const { minX, maxX, minZ, maxZ } = vol.bounds
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return vol.surfaceY
      }
      return null
    }
    return this.cfg.waterSurfaceY ?? null
  }

  private isWaterConfigured(): boolean {
    return (this.cfg.swimmableVolumes?.length ?? 0) > 0 || this.cfg.waterSurfaceY !== undefined
  }

  private feetY(character: THREE.Object3D): number {
    return character.position.y - this.terrainYOffset
  }

  private shouldEnterWater(character: THREE.Object3D): boolean {
    const surfaceY = this.findWaterSurfaceAt(character.position.x, character.position.z)
    if (surfaceY === null) return false
    // Shoulder-height trigger: character wades in shallow water while grounded.
    // Water mode only activates when the surface is ~1.5 m above the feet.
    const swimDepth = this.cfg.waterSwimDepth ?? this.cfg.waterAnkleDepth ?? 1.5
    const entering = this.feetY(character) < (surfaceY - swimDepth)
    if (entering) this._activeWaterSurfaceY = surfaceY
    return entering
  }

  private shouldExitWater(character: THREE.Object3D, sampler: TerrainSurfaceSampler | undefined): boolean {
    // Exit if no longer inside any swimmable volume.
    const surfaceY = this.findWaterSurfaceAt(character.position.x, character.position.z)
    if (surfaceY === null) return true
    // Also exit if terrain has risen above the water surface (walked up shore).
    if (!sampler) return false
    const shoreThreshold = this.cfg.waterShoreThreshold ?? 0.3
    const terrainY = sampleTerrainFootprintY(sampler, character.position.x, character.position.z, this.terrainFootprintRadius)
    return terrainY > (surfaceY + shoreThreshold)
  }

  private tickWater(
    character: THREE.Object3D,
    sampler: TerrainSurfaceSampler | undefined,
    inputActive: boolean,
    moveDirX: number,
    moveDirZ: number,
    delta: number,
  ): void {
    const drag = this.cfg.waterDragFactor ?? 0.88
    const buoyancy = this.cfg.waterBuoyancy ?? 12
    const swimFactor = this.cfg.waterSwimSpeedFactor ?? 0.4
    const waterSurfaceY = this._activeWaterSurfaceY ?? this.cfg.waterSurfaceY ?? 0
    const waterTargetY = waterSurfaceY + this.terrainYOffset

    // Shore exit check — terrain has risen out of water.
    if (this.shouldExitWater(character, sampler)) {
      const prev = this.captureTransitionSnapshot()
      this.exitWater(character, sampler)
      this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), { waterExited: true })
      return
    }

    // Buoyancy: spring toward water surface target Y.
    const yError = waterTargetY - character.position.y
    this.verticalVelocity += yError * buoyancy * delta
    // Dampen vertical oscillation.
    this.verticalVelocity *= (1 - 0.85 * delta * 8)
    character.position.y += this.verticalVelocity * delta
    // Clamp: don't rise above surface.
    if (character.position.y > waterTargetY) {
      character.position.y = waterTargetY
      this.verticalVelocity = Math.min(0, this.verticalVelocity)
    }

    // Horizontal drag.
    const hx = (this.velocity.x || 0) * drag
    const hz = (this.velocity.z || 0) * drag

    // Swim input.
    const swimSpeed = (this.cfg.characterSpeed ?? 7) * swimFactor
    let vx = hx
    let vz = hz
    if (inputActive) {
      vx += moveDirX * swimSpeed
      vz += moveDirZ * swimSpeed
      this.state.waterMode = 'swim'
    } else {
      this.state.waterMode = 'tread'
    }

    // Clamp to playable radius (reuse existing logic — done in outer tick after this).
    this.velocity.set(vx, this.verticalVelocity, vz)
    character.position.x += vx * delta
    character.position.z += vz * delta
  }

  private enterWater(character: THREE.Object3D): void {
    this.state.mode = 'water'
    this.state.waterMode = 'tread'
    this.state.hazardMode = 'none'
    this.state.airMode = null
    this.grounded = false
    // Bleed off vertical velocity on water entry.
    this.verticalVelocity = Math.min(0, this.verticalVelocity * 0.15)
    this.jumpBufferTime = 0
  }

  private exitWater(character: THREE.Object3D, sampler: TerrainSurfaceSampler | undefined): void {
    this.state.mode = 'grounded'
    this.state.waterMode = null
    this._activeWaterSurfaceY = null
    this.grounded = true
    this.verticalVelocity = 0
    if (sampler) {
      const groundY = sampleTerrainFootprintY(sampler, character.position.x, character.position.z, this.terrainFootprintRadius)
      character.position.y = groundY + this.terrainYOffset
    }
  }

  /**
   * Replace swimmable volumes at runtime (e.g. after a scene transition).
   * Pass an empty array to disable volume-based water detection (falls back to {@link setWaterSurfaceY}).
   */
  setSwimmableVolumes(volumes: Array<{ bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; surfaceY: number }>): void {
    this.cfg.swimmableVolumes = volumes
  }

  private resolveAirborneTransition(ctx: AirborneTransitionContext): void {
    const prev = this.captureTransitionSnapshot()
    const {
      sampler,
      character,
      crouchHeld,
      playableRadius,
      edgeMargin,
      baseYOffset,
      groundY,
      targetGroundY,
      gravity,
      jumpV,
      delta,
    } = ctx

    if (this.canUseExtraJump(crouchHeld)) {
      this.verticalVelocity = jumpV
      this.jumpBufferTime = 0
      this.availableExtraJumps -= 1
      this.state.airMode = 'jump_rise'
      const totalJumpIndex = (this.cfg.extraJumps ?? 0) - this.availableExtraJumps + 1
      this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
        extraJumpUsed: {
          jumpIndex: totalJumpIndex,
          remainingExtraJumps: this.availableExtraJumps,
        },
      })
    }

    this.verticalVelocity -= gravity * delta
    if (this.verticalVelocity <= 0) this.state.airMode = 'jump_fall'
    character.position.y += this.verticalVelocity * delta
    this.state.airborneTimeSeconds += Math.max(0, delta)
    if (character.position.y > this.state.airApexY) this.state.airApexY = character.position.y

    if (this.verticalVelocity > 0 || character.position.y > targetGroundY) return

    const feetToHips = this.getFeetToHipsLengthEstimate()
    if (this.isLandingTooHigh(groundY, feetToHips)) {
      this.state.airMode = 'failed_high_ledge'
      this.triggerFailedJumpHighLedge(
        character,
        sampler,
        playableRadius,
        edgeMargin,
        baseYOffset,
        prev,
      )
      return
    }

    character.position.y = targetGroundY
    this.verticalVelocity = 0
    this.grounded = true
    this.state.mode = 'grounded'
    this.state.airMode = null
  }

  private triggerFailedJumpHighLedge(
    character: THREE.Object3D,
    sampler: TerrainSurfaceSampler,
    playableRadius: number,
    edgeMargin: number,
    baseYOffset: number,
    prev: PlayerTransitionSnapshot,
  ): void {
    const backstep = Math.max(0.4, this.cfg.failedJumpBackstepDistance ?? 0.9)
    const hVel = Math.hypot(this.velocity.x, this.velocity.z)
    let retreatX = 0
    let retreatZ = 1
    if (hVel > 1e-5) {
      retreatX = -this.velocity.x / hVel
      retreatZ = -this.velocity.z / hVel
    }
    character.position.x += retreatX * backstep
    character.position.z += retreatZ * backstep
    const limit = playableRadius - edgeMargin
    const distSq = character.position.x ** 2 + character.position.z ** 2
    if (distSq > limit * limit) {
      const d = Math.sqrt(distSq)
      character.position.x *= limit / d
      character.position.z *= limit / d
    }
    const retreatGroundY = sampleTerrainFootprintY(
      sampler,
      character.position.x,
      character.position.z,
      this.terrainFootprintRadius,
    )
    character.position.y = retreatGroundY + baseYOffset
    this.grounded = true
    this.verticalVelocity = 0
    this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
    this.state.recoveryLockRemaining = Math.max(0, this.cfg.failedJumpRecoverySeconds ?? 1.1)
    this.state.recoveryMode = 'from_failed_jump'
    this.state.mode = 'recovery_locked'
    this.state.airMode = 'failed_high_ledge'
    this.jumpBufferTime = 0
    this.state.hazardMode = 'none'
    this.state.pitBypassRemaining = 0
    this.emitTransitionEvents(prev, this.captureTransitionSnapshot())
  }

  private captureTransitionSnapshot(): PlayerTransitionSnapshot {
    return {
      mode: this.state.mode,
      hazardMode: this.state.hazardMode,
      airMode: this.state.airMode,
      recoveryMode: this.state.recoveryMode,
      waterMode: this.state.waterMode,
    }
  }

  private emitTransitionEvents(
    prev: PlayerTransitionSnapshot,
    next: PlayerTransitionSnapshot,
    meta: TransitionEventMeta = {},
  ): void {
    if (meta.jumpStarted) {
      this.pendingEvents.push({ type: 'jump_started', jumpIndex: meta.jumpStarted.jumpIndex })
    }
    if (meta.extraJumpUsed) {
      this.pendingEvents.push({
        type: 'extra_jump_used',
        jumpIndex: meta.extraJumpUsed.jumpIndex,
        remainingExtraJumps: meta.extraJumpUsed.remainingExtraJumps,
      })
    }
    if (
      next.hazardMode === 'pit_warning' &&
      (prev.hazardMode !== 'pit_warning' || meta.pitWarningPulse === true)
    ) {
      this.pendingEvents.push({ type: 'edge_catch' })
    }
    if (
      next.hazardMode === 'wall_stumble' &&
      (prev.hazardMode !== 'wall_stumble' || meta.wallStumblePulse === true)
    ) {
      this.pendingEvents.push({ type: 'wall_stumble' })
    }
    if (prev.airMode !== 'failed_high_ledge' && next.airMode === 'failed_high_ledge') {
      this.pendingEvents.push({ type: 'jump_failed_high_ledge' })
    }
    if (prev.mode === 'airborne' && next.mode === 'grounded' && meta.landed) {
      this.pendingEvents.push({
        type: 'landed',
        airTimeSeconds: meta.landed.airTimeSeconds,
        fallDistance: meta.landed.fallDistance,
      })
    }
    if (meta.waterEntered) this.pendingEvents.push({ type: 'water_entered' })
    if (meta.waterExited) this.pendingEvents.push({ type: 'water_exited' })
    if (meta.consequenceDebug && this.cfg.debugMovement) {
      this.pendingEvents.push({
        type: 'hazard_consequence_debug',
        ...meta.consequenceDebug,
      })
    }
  }

  /** Drain pending semantic movement events since the previous call. */
  consumeEvents(): PlayerControllerEvent[] {
    if (this.pendingEvents.length === 0) return []
    return this.pendingEvents.splice(0, this.pendingEvents.length)
  }

  /** Call after `SceneBuilder` when character pivot height differs (e.g. GLTF feet vs capsule centre). */
  setTerrainYOffset(worldOffset: number): void {
    this.terrainYOffset = worldOffset
  }

  setTerrainFootprintRadius(radius: number): void {
    this.terrainFootprintRadius = Math.max(0, radius)
  }

  /** Override crouch vertical correction (e.g. after loading a skinned character). */
  setCrouchTerrainYOffsetDelta(worldY: number): void {
    this.crouchTerrainYOffsetDelta = worldY
  }

  /**
   * Switch XZ move basis: **`facing`** with follow cams behind the body; **`camera`** with orbit / free cam
   * (e.g. editor author views).
   */
  setMovementBasis(basis: 'facing' | 'camera'): void {
    this.cfg.movementBasis = basis
  }

  /** Smoothed crouch amount; safe to use for camera rig after {@link tick}. */
  getCrouchGroundBlend(): number {
    return this.crouchGroundBlend
  }

  setMoveIntent(x: number, y: number): void {
    this.moveIntent.x = x
    this.moveIntent.y = y
  }

  /** Call on `input:action` `jump` `pressed` — consumed on next grounded tick within the buffer. */
  notifyJumpPressed(bufferSeconds = 0.14): void {
    if (this.state.recoveryLockRemaining > 0) return
    this.jumpBufferTime = Math.max(this.jumpBufferTime, bufferSeconds)
  }

  getSnapshot(): PlayerControllerState {
    return {
      position: {
        x: this.lastCharacterPos.x,
        y: this.lastCharacterPos.y,
        z: this.lastCharacterPos.z,
      },
      facing: this.facing,
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      grounded: this.grounded,
      moveIntent: { x: this.moveIntent.x, y: this.moveIntent.y },
      crouching: this.crouchHeld,
      sprinting: this.sprintHeld && !this.crouchHeld,
      jumpBuffered: this.jumpBufferTime > 0,
      waterMode: this.state.waterMode,
    }
  }

  /** Last known mesh position after the most recent `tick` (for snapshot before character ref exists). */
  private lastCharacterPos = new THREE.Vector3()
  /** XZ position at jump takeoff — used for `debugJumpArc` horizontal distance measurement. */
  private jumpTakeoffXZ = new THREE.Vector2()
  /** Surface Y of the currently active swimmable volume; set on water entry, cleared on exit. */
  private _activeWaterSurfaceY: number | null = null

  tick(delta: number, ctx: PlayerControllerTickContext): void {
    const { camera, character, sampler, playableRadius, sprintHeld, crouchHeld } = ctx
    const { characterSpeed, runSpeedMultiplier, crouchSpeedMultiplier, edgeMargin } = this.cfg
    const facingLerp = ctx.facingLerpOverride ?? this.cfg.facingLerp

    this.crouchHeld = crouchHeld
    this.sprintHeld = sprintHeld

    const kCrouch = 1 - Math.exp(-delta * 10)
    this.crouchGroundBlend = THREE.MathUtils.lerp(
      this.crouchGroundBlend,
      crouchHeld ? 1 : 0,
      kCrouch,
    )

    let speed = characterSpeed
    if (crouchHeld) speed *= crouchSpeedMultiplier
    else if (sprintHeld) speed *= runSpeedMultiplier

    if (this.jumpBufferTime > 0) {
      this.jumpBufferTime = Math.max(0, this.jumpBufferTime - delta)
    }
    this.state.pitWarningRepeatTimer = Math.max(0, this.state.pitWarningRepeatTimer - delta)
    this.wallStumbleCooldownSeconds = Math.max(0, this.wallStumbleCooldownSeconds - delta)
    this.state.pitBypassRemaining = Math.max(0, this.state.pitBypassRemaining - delta)
    this.state.recoveryLockRemaining = Math.max(0, this.state.recoveryLockRemaining - delta)

    const { x, y } = this.moveIntent
    const recoveryLocked = this.isRecoveryLocked()
    if (recoveryLocked) {
      this.state.mode = 'recovery_locked'
      this.state.recoveryMode = this.state.recoveryMode ?? 'from_failed_jump'
    } else {
      this.state.recoveryMode = null
    }
    const inputX = recoveryLocked ? 0 : x
    const inputY = recoveryLocked ? 0 : y
    const inputActive = this.isInputActive({ x: inputX, y: inputY })
    if (!inputActive && this.state.mode !== 'water') {
      this.resolveGroundedHazardTransition({
        inputActive,
        sprintHeld,
        crouchHeld,
        sampler,
        character,
        moveDir: this._moveDir,
        delta,
      })
    }
    let vx = 0
    let vz = 0
    let forceLeaveGround = false

    if (inputActive) {
      const facingBefore = this.facing

      const basisMode = this.cfg.movementBasis ?? 'facing'
      let camBasis: 'facingXZ' | 'yawXZ' | 'camOffsetFallback' | 'degenerateXZ' = 'facingXZ'
      let camDirFull = { x: 0, y: 0, z: 0 }

      if (basisMode === 'facing') {
        // Same XZ frame as typical “behind + lateral” rigs: forward = opposite of camera back offset
        // (sin/cos facing), right = (cos, −sin) — matches `@base/camera-three` chase rig math.
        const f = this.facing
        this._camDir.set(-Math.sin(f), 0, -Math.cos(f))
        this._camRight.crossVectors(this._camDir, THREE.Object3D.DEFAULT_UP).normalize()
        camBasis = 'facingXZ'
      } else {
        // Leveled camera yaw (local −Z on XZ). Orbits with lookAt + chase offset → drift if used with
        // a facing-locked follow cam; prefer `movementBasis: 'facing'` there.
        camera.getWorldDirection(this._camDir)
        camDirFull = {
          x: this._camDir.x,
          y: this._camDir.y,
          z: this._camDir.z,
        }
        camera.getWorldQuaternion(this._camWorldQuat)
        this._eulerYaw.setFromQuaternion(this._camWorldQuat, 'YXZ')
        this._eulerYaw.x = 0
        this._eulerYaw.z = 0
        this._levelCamQuat.setFromEuler(this._eulerYaw)
        this._camDir.set(0, 0, -1).applyQuaternion(this._levelCamQuat)
        this._camDir.y = 0

        camBasis = 'yawXZ'
        if (this._camDir.lengthSq() < 1e-6) {
          const cx = character.position.x
          const cz = character.position.z
          const dx = camera.position.x - cx
          const dz = camera.position.z - cz
          const lenH = Math.hypot(dx, dz)
          if (lenH > 1e-4) {
            camBasis = 'camOffsetFallback'
            const tcx = dx / lenH
            const tcz = dz / lenH
            this._camDir.set(-tcx, 0, -tcz)
            this._camRight.set(tcz, 0, -tcx)
          } else {
            camBasis = 'degenerateXZ'
            this._camDir.set(0, 0, -1)
            this._camRight.crossVectors(this._camDir, THREE.Object3D.DEFAULT_UP).normalize()
          }
        } else {
          this._camDir.normalize()
          this._camRight.crossVectors(this._camDir, THREE.Object3D.DEFAULT_UP).normalize()
        }
      }

      if (this.cfg.debugMovement) {
        camera.getWorldDirection(this._dbgCamLook)
        camDirFull = {
          x: this._dbgCamLook.x,
          y: this._dbgCamLook.y,
          z: this._dbgCamLook.z,
        }
      }

      const backMul = this.cfg.backwardSpeedMultiplier ?? 0.25
      const strMult =
        basisMode === 'camera'
          ? (this.cfg.cameraStrafeSpeedMultiplier ?? 0.5)
          : (this.cfg.strafeSpeedMultiplier ?? backMul)
      this._moveDir
        .copy(this._camDir)
        .multiplyScalar(inputY * speed)
        .addScaledVector(this._camRight, inputX * speed * strMult)

      const moveBeforeBack = {
        x: this._moveDir.x,
        z: this._moveDir.z,
      }
      let alongBody = 0
      let backScaleApplied = 1

      const hLenPlanar = Math.hypot(this._moveDir.x, this._moveDir.z)
      if (hLenPlanar > 1e-8) {
        const nx = this._moveDir.x / hLenPlanar
        const nz = this._moveDir.z / hLenPlanar
        alongBody = -nx * Math.sin(this.facing) - nz * Math.cos(this.facing)
        if (alongBody < 0) {
          const backT = Math.min(1, -alongBody)
          backScaleApplied = THREE.MathUtils.lerp(1, backMul, backT)
          this._moveDir.x *= backScaleApplied
          this._moveDir.z *= backScaleApplied
        }
      }

      if (this.state.mode !== 'water') {
        const groundedHazardTransition = this.resolveGroundedHazardTransition({
          inputActive,
          sprintHeld,
          crouchHeld,
          sampler,
          character,
          moveDir: this._moveDir,
          delta,
        })
        forceLeaveGround = groundedHazardTransition.forceLeaveGround
        character.position.x += this._moveDir.x * delta
        character.position.z += this._moveDir.z * delta
      }

      const limit = playableRadius - edgeMargin
      const distSq = character.position.x ** 2 + character.position.z ** 2
      let edgeClamp = false
      if (distSq > limit * limit) {
        edgeClamp = true
        const d = Math.sqrt(distSq)
        character.position.x *= limit / d
        character.position.z *= limit / d
      }

      const cfg = this.cfg
      const rotateTowardMove =
        cfg.backwardWithoutBodyTurn !== false ? inputY >= 0 : true
      const hFace = Math.hypot(this._moveDir.x, this._moveDir.z)
      let targetFacing: number | null = null
      // Camera-relative FPS: do not swing the body toward the strafe vector — only mouse/gamepad look changes facing.
      if (rotateTowardMove && hFace > 1e-8 && basisMode === 'facing') {
        const nx = this._moveDir.x / hFace
        const nz = this._moveDir.z / hFace
        targetFacing = Math.atan2(-nx, -nz)
        this.facing = lerpAngle(this.facing, targetFacing, facingLerp * delta)
      }

      if (this.state.mode !== 'water') {
        vx = this._moveDir.x
        vz = this._moveDir.z
      }

      if (cfg.debugMovement) {
        const interval = cfg.debugMovementLogIntervalSec ?? 0.12
        this.debugMovementLogAcc += delta
        if (this.debugMovementLogAcc >= interval) {
          this.debugMovementLogAcc = 0
          const fd = (r: number) => Number(THREE.MathUtils.radToDeg(r).toFixed(3))
          const facingDeltaDeg = THREE.MathUtils.radToDeg(
            shortestAngleDiffRad(facingBefore, this.facing),
          )
          const lx = camDirFull.x
          const lz = camDirFull.z
          const lookLen = Math.hypot(lx, lz)
          const camLookFlatXz =
            lookLen > 1e-8
              ? { x: Number((lx / lookLen).toFixed(4)), z: Number((lz / lookLen).toFixed(4)) }
              : null
          const payload = {
            intent: { x: inputX, y: inputY },
            speed,
            delta,
            sprintHeld,
            crouchHeld,
            camBasis,
            camPos: {
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            },
            charPos: {
              x: character.position.x,
              y: character.position.y,
              z: character.position.z,
            },
            camDirFull,
            camLookFlatXz,
            movementBasis: basisMode,
            basisXZ: { x: this._camDir.x, z: this._camDir.z },
            camRightXZ: { x: this._camRight.x, z: this._camRight.z },
            moveXZ_beforeBack: moveBeforeBack,
            alongBody: Number(alongBody.toFixed(4)),
            backScaleApplied: Number(backScaleApplied.toFixed(4)),
            moveXZ: { x: this._moveDir.x, z: this._moveDir.z },
            edgeClamp,
            rotateTowardMove,
            facingLerp,
            facingBeforeDeg: fd(facingBefore),
            targetFacingDeg: targetFacing == null ? null : fd(targetFacing),
            facingAfterDeg: fd(this.facing),
            facingDeltaThisTickDeg: Number(facingDeltaDeg.toFixed(4)),
          }
          console.log('[PlayerController.move]', payload)
          console.log(
            `[PlayerController.move] ix=${inputX.toFixed(3)} iy=${inputY.toFixed(3)} mode=${basisMode} ${camBasis}=(${this._camDir.x.toFixed(3)},${this._camDir.z.toFixed(3)}) alongBody=${alongBody.toFixed(3)} backSc=${backScaleApplied.toFixed(3)} dFace=${facingDeltaDeg.toFixed(3)}° tgt=${targetFacing == null ? '—' : fd(targetFacing)}°`,
          )
        }
      }
    } else if (this.cfg.debugMovement) {
      const interval = this.cfg.debugMovementLogIntervalSec ?? 0.12
      this.debugMovementLogAcc += delta
      if (this.debugMovementLogAcc >= interval) {
        this.debugMovementLogAcc = 0
        console.log('[PlayerController.move] (idle)', {
          intent: { x: this.moveIntent.x, y: this.moveIntent.y },
          inputActive: false,
          facingDeg: Number(THREE.MathUtils.radToDeg(this.facing).toFixed(3)),
        })
      }
    }

    const baseYOffset =
      this.terrainYOffset + this.crouchGroundBlend * this.crouchTerrainYOffsetDelta

    // ── Water entry check (grounded → water; airborne → water on surface crossing) ──
    if (this.isWaterConfigured() && this.state.mode !== 'water') {
      if (this.shouldEnterWater(character)) {
        const prev = this.captureTransitionSnapshot()
        this.enterWater(character)
        this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), { waterEntered: true })
      }
    }

    // ── Water tick — replaces terrain snap and gravity ─────────────────────────
    if (this.state.mode === 'water') {
      this.tickWater(character, sampler, inputActive, this._moveDir.x, this._moveDir.z, delta)
      // Edge clamp for water-mode XZ (tickWater moves position).
      const limit = playableRadius - edgeMargin
      const wDistSq = character.position.x ** 2 + character.position.z ** 2
      if (wDistSq > limit * limit) {
        const d = Math.sqrt(wDistSq)
        character.position.x *= limit / d
        character.position.z *= limit / d
      }
      // Facing rotation while swimming (same logic as grounded).
      const hFaceW = Math.hypot(this._moveDir.x, this._moveDir.z)
      if (inputActive && hFaceW > 1e-8) {
        const nx = this._moveDir.x / hFaceW
        const nz = this._moveDir.z / hFaceW
        const tgtFacing = Math.atan2(-nx, -nz)
        this.facing = lerpAngle(this.facing, tgtFacing, facingLerp * delta)
      }
      this.velocity.set(this.velocity.x, this.verticalVelocity, this.velocity.z)
      this.lastCharacterPos.copy(character.position)
      character.rotation.y = this.facing
      return
    }

    const wasGrounded = this.grounded
    if (sampler) {
      const groundY = sampleTerrainFootprintY(
        sampler,
        character.position.x,
        character.position.z,
        this.terrainFootprintRadius,
      )
      const targetGroundY = groundY + baseYOffset
      const gravity = this.cfg.gravity ?? 30
      const jumpV = this.cfg.jumpVelocity ?? 6.75

      if (this.grounded) {
        if (forceLeaveGround) {
          this.beginAirborne('jump_fall', character)
          this.verticalVelocity = Math.min(this.verticalVelocity, 0)
        } else {
          character.position.y = targetGroundY
          this.verticalVelocity = 0
          this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
          if (this.canStartJump(crouchHeld)) {
            const prev = this.captureTransitionSnapshot()
            this.verticalVelocity = jumpV
            this.beginAirborne('jump_rise', character)
            this.jumpBufferTime = 0
            this.jumpTakeoffXZ.set(character.position.x, character.position.z)
            this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
              jumpStarted: { jumpIndex: 1 },
            })
          }
        }
      } else {
        this.resolveAirborneTransition({
          sampler,
          character,
          crouchHeld,
          playableRadius,
          edgeMargin,
          baseYOffset,
          groundY,
          targetGroundY,
          gravity,
          jumpV,
          delta,
        })
      }
    } else {
      this.grounded = true
      this.verticalVelocity = 0
      this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
    }

    if (!wasGrounded && this.grounded) {
      const fallDistance = Math.max(0, this.state.airApexY - character.position.y)
      if (this.cfg.debugJumpArc) {
        const hDist = Math.hypot(
          character.position.x - this.jumpTakeoffXZ.x,
          character.position.z - this.jumpTakeoffXZ.y,
        )
        const peakHeight = this.state.airApexY - this.state.takeoffGroundY
        console.log(
          `[PlayerController] jump arc — ` +
          `peakHeight=${peakHeight.toFixed(2)}m ` +
          `fallDist=${fallDistance.toFixed(2)}m ` +
          `hDist=${hDist.toFixed(2)}m ` +
          `airTime=${this.state.airborneTimeSeconds.toFixed(3)}s ` +
          `(jumpV=${this.cfg.jumpVelocity ?? 6.75} gravity=${this.cfg.gravity ?? 30})`,
        )
      }
      const prev = {
        ...this.captureTransitionSnapshot(),
        mode: 'airborne' as PlayerMode,
      }
      this.emitTransitionEvents(prev, this.captureTransitionSnapshot(), {
        landed: {
          airTimeSeconds: this.state.airborneTimeSeconds,
          fallDistance,
        },
      })
      this.state.airborneTimeSeconds = 0
      this.state.takeoffGroundY = character.position.y - this.terrainYOffset
      this.state.airApexY = character.position.y
      this.state.mode = 'grounded'
      this.state.airMode = null
    }
    if (!this.grounded && this.state.mode !== 'recovery_locked') this.state.mode = 'airborne'
    if (this.grounded && this.state.mode !== 'recovery_locked') this.state.mode = 'grounded'

    this.velocity.set(vx, this.verticalVelocity, vz)

    this.lastCharacterPos.copy(character.position)
    character.rotation.y = this.facing
  }

  /** Facing used by camera rig (radians, Y). */
  getFacing(): number {
    return this.facing
  }

  /** Add yaw (radians) for first-person mouse/gamepad look; angle is wrapped to (−π, π]. */
  addFacingDelta(radianDelta: number): void {
    if (radianDelta === 0) return
    this.facing += radianDelta
    while (this.facing > Math.PI) this.facing -= 2 * Math.PI
    while (this.facing <= -Math.PI) this.facing += 2 * Math.PI
  }

  /** Reset facing and intent (e.g. when swapping character mesh). */
  resetFacing(facingRadians = 0): void {
    this.facing = facingRadians
    this.moveIntent.x = 0
    this.moveIntent.y = 0
    this.velocity.set(0, 0, 0)
    this.crouchHeld = false
    this.sprintHeld = false
    this.crouchGroundBlend = 0
    this.verticalVelocity = 0
    this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
    this.state.mode = 'grounded'
    this.state.hazardMode = 'none'
    this.state.airMode = null
    this.state.recoveryMode = null
    this.state.waterMode = null
    this.state.pitWarningRepeatTimer = 0
    this.state.pitBypassRemaining = 0
    this.state.recoveryLockRemaining = 0
    this.state.takeoffGroundY = 0
    this.state.airborneTimeSeconds = 0
    this.state.airApexY = 0
    this.wallStumbleCooldownSeconds = 0
    this.pendingEvents.length = 0
  }

  /** Current water sub-mode; `null` when not in `water` PlayerMode. */
  getWaterMode(): WaterMode | null {
    return this.state.waterMode
  }

  /** True when the controller is currently in water mode (buoyancy + drag physics active). */
  isSwimming(): boolean {
    return this.state.mode === 'water'
  }

  /**
   * Override the water surface Y at runtime (e.g. animated tides or scene transitions).
   * Pass `undefined` to disable water mode entirely.
   */
  setWaterSurfaceY(y: number | undefined): void {
    this.cfg.waterSurfaceY = y
  }
}
