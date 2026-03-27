import * as THREE from 'three'
import type { TerrainSurfaceSampler } from './terrainSurface'

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
}

export type PlayerControllerEvent =
  | { type: 'jump_started'; jumpIndex: number }
  | { type: 'extra_jump_used'; jumpIndex: number; remainingExtraJumps: number }
  | { type: 'edge_catch' }
  | { type: 'landed'; airTimeSeconds: number; fallDistance: number }

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
   * Higher deltas are treated as a wall and horizontal movement is rejected for that frame.
   */
  maxStepUpHeight?: number
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
  /** Initial upward velocity when jump triggers (m/s). Only with a terrain `sampler`. */
  jumpVelocity?: number
  /** Gravity while airborne (m/s²). */
  gravity?: number
  /**
   * When true, throttled `console.log` logs camera basis, intent, move vector, and facing
   * (use to trace circling / drift: camera vs body, backward scale, lerp).
   */
  debugMovement?: boolean
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
  jumpVelocity: 6.75,
  gravity: 30,
  movementBasis: 'facing',
  extraJumps: 0,
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
  private airborneTimeSeconds = 0
  private airStartY = 0
  private airApexY = 0
  private edgeCatchCooldownSeconds = 0

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
    }
  }

  /** Last known mesh position after the most recent `tick` (for snapshot before character ref exists). */
  private lastCharacterPos = new THREE.Vector3()

  tick(delta: number, ctx: PlayerControllerTickContext): void {
    const { camera, character, sampler, playableRadius, sprintHeld, crouchHeld } = ctx
    const { characterSpeed, runSpeedMultiplier, crouchSpeedMultiplier, facingLerp, edgeMargin } =
      this.cfg

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
    this.edgeCatchCooldownSeconds = Math.max(0, this.edgeCatchCooldownSeconds - delta)

    const { x, y } = this.moveIntent
    const inputActive = Math.abs(x) > 0.01 || Math.abs(y) > 0.01
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
        .multiplyScalar(y * speed)
        .addScaledVector(this._camRight, x * speed * strMult)

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

      if (sampler && this.grounded) {
        const feetToHips = this.getFeetToHipsLengthEstimate()
        const maxStepUp = this.cfg.maxStepUpHeight ?? feetToHips * 0.55
        const cliffDropCatch = this.cfg.cliffDropCatchThreshold ?? feetToHips * (2 / 3)
        const stepDistance = Math.hypot(this._moveDir.x, this._moveDir.z) * delta
        const dirLen = Math.hypot(this._moveDir.x, this._moveDir.z)
        const dirX = dirLen > 1e-8 ? this._moveDir.x / dirLen : 0
        const dirZ = dirLen > 1e-8 ? this._moveDir.z / dirLen : 0
        const { stepUp, dropAhead } = this.sampleGroundDropAhead(
          sampler,
          character.position.x,
          character.position.z,
          dirX,
          dirZ,
          stepDistance,
        )

        if (stepUp > maxStepUp) {
          this._moveDir.set(0, 0, 0)
        } else if (dropAhead > cliffDropCatch) {
          if (sprintHeld && !crouchHeld) {
            forceLeaveGround = true
          } else {
            this._moveDir.set(0, 0, 0)
            if (this.edgeCatchCooldownSeconds <= 0) {
              this.pendingEvents.push({ type: 'edge_catch' })
              this.edgeCatchCooldownSeconds = 0.24
            }
          }
        }
      }

      character.position.x += this._moveDir.x * delta
      character.position.z += this._moveDir.z * delta

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
        cfg.backwardWithoutBodyTurn !== false ? y >= 0 : true
      const hFace = Math.hypot(this._moveDir.x, this._moveDir.z)
      let targetFacing: number | null = null
      // Camera-relative FPS: do not swing the body toward the strafe vector — only mouse/gamepad look changes facing.
      if (rotateTowardMove && hFace > 1e-8 && basisMode === 'facing') {
        const nx = this._moveDir.x / hFace
        const nz = this._moveDir.z / hFace
        targetFacing = Math.atan2(-nx, -nz)
        this.facing = lerpAngle(this.facing, targetFacing, facingLerp * delta)
      }

      vx = this._moveDir.x
      vz = this._moveDir.z

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
            intent: { x, y },
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
            `[PlayerController.move] ix=${x.toFixed(3)} iy=${y.toFixed(3)} mode=${basisMode} ${camBasis}=(${this._camDir.x.toFixed(3)},${this._camDir.z.toFixed(3)}) alongBody=${alongBody.toFixed(3)} backSc=${backScaleApplied.toFixed(3)} dFace=${facingDeltaDeg.toFixed(3)}° tgt=${targetFacing == null ? '—' : fd(targetFacing)}°`,
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
          this.grounded = false
          this.airborneTimeSeconds = 0
          this.airStartY = character.position.y
          this.airApexY = character.position.y
          this.verticalVelocity = Math.min(this.verticalVelocity, 0)
        } else {
          character.position.y = targetGroundY
          this.verticalVelocity = 0
          this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
          if (this.jumpBufferTime > 0 && !crouchHeld) {
            this.verticalVelocity = jumpV
            this.grounded = false
            this.jumpBufferTime = 0
            this.pendingEvents.push({ type: 'jump_started', jumpIndex: 1 })
            this.airborneTimeSeconds = 0
            this.airStartY = character.position.y
            this.airApexY = character.position.y
          }
        }
      } else {
        if (
          this.jumpBufferTime > 0 &&
          this.availableExtraJumps > 0 &&
          !crouchHeld &&
          (this.cfg.canUseExtraJump?.() ?? true)
        ) {
          this.verticalVelocity = jumpV
          this.jumpBufferTime = 0
          this.availableExtraJumps -= 1
          const totalJumpIndex = (this.cfg.extraJumps ?? 0) - this.availableExtraJumps + 1
          this.pendingEvents.push({ type: 'extra_jump_used', jumpIndex: totalJumpIndex, remainingExtraJumps: this.availableExtraJumps })
        }
        this.verticalVelocity -= gravity * delta
        character.position.y += this.verticalVelocity * delta
        this.airborneTimeSeconds += Math.max(0, delta)
        if (character.position.y > this.airApexY) this.airApexY = character.position.y
        if (this.verticalVelocity <= 0 && character.position.y <= targetGroundY) {
          character.position.y = targetGroundY
          this.verticalVelocity = 0
          this.grounded = true
        }
      }
    } else {
      this.grounded = true
      this.verticalVelocity = 0
      this.availableExtraJumps = Math.max(0, this.cfg.extraJumps ?? 0)
    }

    if (!wasGrounded && this.grounded) {
      const fallDistance = Math.max(0, this.airApexY - character.position.y)
      this.pendingEvents.push({
        type: 'landed',
        airTimeSeconds: this.airborneTimeSeconds,
        fallDistance,
      })
      this.airborneTimeSeconds = 0
      this.airStartY = character.position.y
      this.airApexY = character.position.y
    }

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
    this.airborneTimeSeconds = 0
    this.airStartY = 0
    this.airApexY = 0
    this.edgeCatchCooldownSeconds = 0
    this.pendingEvents.length = 0
  }
}
