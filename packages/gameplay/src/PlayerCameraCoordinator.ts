import * as THREE from 'three'
import type { EventBus } from '@base/engine-core'
import type { InputActionEvent, InputAxisEvent } from '@base/input'
import type { GameplayCameraMode } from '@base/camera-three'
import { GameplayCameraController } from '@base/camera-three'
import type { TerrainSurfaceSampler } from '@base/player-three'
import { PlayerController } from '@base/player-three'
import { EV_GAMEPLAY_CAMERA_MODE } from './gameplayEvents'

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Camera and locomotion params consumed by {@link PlayerCameraCoordinator}.
 * A superset of this lives in the per-game `GameplaySceneConfig`; the game
 * module passes the relevant slice when constructing the coordinator.
 */
export interface PlayerCameraCoordinatorConfig {
  /** Facing rotation lerp speed (rad/s). Used in first-person and as fallback for third-person. */
  facingLerp: number
  /**
   * Facing lerp speed when camera is in third-person mode.
   * Lower values give smoother body turns. Falls back to {@link facingLerp} when not set.
   */
  facingLerpThirdPerson?: number
  /** Maximum first-person pitch in radians. Default π/2 (90°). */
  fpPitchLimit?: number
}

// ─── Tick context ─────────────────────────────────────────────────────────────

/**
 * Per-frame inputs required by {@link PlayerCameraCoordinator.tick}.
 * Typically sourced from the host module's ThreeContext.
 */
export interface CoordinatorTickContext {
  camera: THREE.PerspectiveCamera
  character: THREE.Object3D
  /** Terrain height sampler — may be undefined until scene is fully loaded. */
  sampler: TerrainSurfaceSampler | undefined
  /** Outer playable disc radius (m) in XZ from scene origin. */
  playableRadius: number
}

// ─── Coordinator ─────────────────────────────────────────────────────────────

/**
 * Coordinates per-frame input routing, player ticking, and camera update for
 * a standard gameplay scene. Extracted from the per-project `GameplaySceneModule`
 * so both `threejs-engine-dev` and `three-dreams` share one implementation.
 *
 * Responsibilities:
 * - Subscribe `input:axis` → accumulate move/loco/look intent
 * - Subscribe `input:action` → handle `toggle_camera` (mode switch + pointer-lock)
 * - Each {@link tick}: flush accumulated input, drive `PlayerController.tick()`,
 *   update `GameplayCameraController`
 * - Emit `gameplay:camera-mode` on every mode change
 *
 * NOT responsible for:
 * - `CharacterAnimationRig` updates (host module calls those after tick)
 * - `PlayerController.consumeEvents()` (host module handles jump/land animation triggers)
 * - Scene loading, exit zones, NPC logic — all game-specific
 */
export class PlayerCameraCoordinator {
  private offInputAxis: (() => void) | null = null
  private offInputAction: (() => void) | null = null

  // Accumulated each frame from eventBus; consumed at the start of tick()
  private moveX = 0
  private moveY = 0
  private locoSprintOr = false
  private locoCrouchOr = false
  private lookYawAcc = 0
  private lookPitchAcc = 0

  // First-person pitch state (radians, YXZ order)
  private fpPitch = 0
  private readonly fpPitchLimit: number

  constructor(
    private readonly player: PlayerController,
    private readonly gameplayCam: GameplayCameraController,
    private readonly cfg: PlayerCameraCoordinatorConfig,
    /**
     * Called after every camera mode change.
     * Use to emit eventBus events or update HUD state in the host module.
     */
    private readonly onModeChange?: (mode: GameplayCameraMode) => void,
  ) {
    this.fpPitchLimit = cfg.fpPitchLimit ?? Math.PI / 2
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to eventBus input events. Call once at scene mount, before the
   * first tick.
   */
  mount(eventBus: EventBus): void {
    this.offInputAxis = eventBus.on('input:axis', (raw) => {
      const e = raw as InputAxisEvent
      if (e.axis === 'move') {
        this.moveX = e.value.x
        this.moveY = e.value.y
      }
      if (e.axis === 'locomotion') {
        this.locoSprintOr ||= e.value.x > 0.5
        this.locoCrouchOr ||= e.value.y > 0.5
      }
      if (e.axis === 'look') {
        this.lookYawAcc += e.value.x
        this.lookPitchAcc += e.value.y
      }
    })

    this.offInputAction = eventBus.on('input:action', (raw) => {
      const e = raw as InputActionEvent
      if (e.action === 'toggle_camera' && e.type === 'pressed') {
        const next: GameplayCameraMode =
          this.gameplayCam.getMode() === 'third-person' ? 'first-person' : 'third-person'
        this.setCameraMode(next, null, null, eventBus)
      }
    })
  }

  /** Unsubscribe from eventBus. Call at scene unmount. */
  unmount(): void {
    this.offInputAxis?.()
    this.offInputAction?.()
    this.offInputAxis = null
    this.offInputAction = null
    this.resetAccumulators()
  }

  // ─── Camera mode ────────────────────────────────────────────────────────────

  getCameraMode(): GameplayCameraMode {
    return this.gameplayCam.getMode()
  }

  /**
   * Switch camera mode. Handles pointer-lock exit for TPV, movement-basis
   * update, and camera snap.
   *
   * @param camera - Pass the THREE camera for instant snap; null skips snap.
   * @param character - Pass the character Object3D for snap; null skips snap.
   * @param eventBus - Pass to emit `gameplay:camera-mode`; null skips emit.
   */
  setCameraMode(
    mode: GameplayCameraMode,
    camera: THREE.PerspectiveCamera | null,
    character: THREE.Object3D | null,
    eventBus: EventBus | null,
  ): void {
    if (mode === 'third-person') {
      if (typeof document !== 'undefined' && document.exitPointerLock) {
        document.exitPointerLock()
      }
      this.fpPitch = 0
      this.lookYawAcc = 0
      this.lookPitchAcc = 0
      this.player.setMovementBasis('facing')
    } else {
      this.player.setMovementBasis('camera')
    }

    this.gameplayCam.setMode(mode)

    if (camera && character) {
      this.gameplayCam.snapToCharacter(
        camera,
        character,
        this.player.getFacing(),
        this.player.getCrouchGroundBlend(),
      )
    }

    if (eventBus) {
      eventBus.emit(EV_GAMEPLAY_CAMERA_MODE, { mode })
    }
    this.onModeChange?.(mode)
  }

  // ─── Camera init ────────────────────────────────────────────────────────────

  /**
   * Snap camera to character immediately at scene mount.
   * Call after {@link mount} and after the character Object3D is available.
   */
  initCamera(camera: THREE.PerspectiveCamera, character: THREE.Object3D): void {
    this.gameplayCam.snapToCharacter(
      camera,
      character,
      this.player.getFacing(),
      this.player.getCrouchGroundBlend(),
    )
  }

  // ─── Per-frame tick ─────────────────────────────────────────────────────────

  /**
   * Drive player + camera for one frame. Convenience wrapper that calls
   * {@link tickPlayer} then {@link tickCamera} back-to-back.
   *
   * When the host module needs to run game logic between the player tick and
   * the camera update (e.g. `consumeEvents`, `animRig.update`, exit zones),
   * call `tickPlayer` and `tickCamera` separately instead.
   *
   * Does NOT call `player.consumeEvents()` — the host module does that so it
   * can act on jump/land events for animation triggers.
   */
  tick(delta: number, ctx: CoordinatorTickContext): void {
    this.tickPlayer(delta, ctx)
    this.tickCamera(delta, ctx)
  }

  /**
   * Drive look input, move intent, and {@link PlayerController.tick} for one frame.
   * Call before host game logic (consumeEvents, animRig, exit zones, etc.).
   */
  tickPlayer(delta: number, ctx: CoordinatorTickContext): void {
    const { camera, character, sampler, playableRadius } = ctx

    // ── Apply look input ────────────────────────────────────────────────────
    if (this.lookYawAcc !== 0 || this.lookPitchAcc !== 0) {
      if (this.gameplayCam.getMode() === 'first-person') {
        this.player.addFacingDelta(this.lookYawAcc)
        this.fpPitch = THREE.MathUtils.clamp(
          this.fpPitch + this.lookPitchAcc,
          -this.fpPitchLimit,
          this.fpPitchLimit,
        )
      } else {
        // Third-person orbit: cap per-frame yaw so camera orbit speed matches
        // natural character turning rate.
        const tpRate = this.cfg.facingLerpThirdPerson ?? this.cfg.facingLerp
        const maxYaw = tpRate * delta
        this.player.addFacingDelta(
          Math.max(-maxYaw, Math.min(maxYaw, this.lookYawAcc)),
        )
      }
      this.lookYawAcc = 0
      this.lookPitchAcc = 0
    }

    // ── Move intent ─────────────────────────────────────────────────────────
    this.player.setMoveIntent(this.moveX, this.moveY)

    // ── Player tick ─────────────────────────────────────────────────────────
    const sprintHeld = this.locoSprintOr
    const crouchHeld = this.locoCrouchOr
    this.locoSprintOr = false
    this.locoCrouchOr = false

    const isThirdPerson = this.gameplayCam.getMode() === 'third-person'
    this.player.tick(delta, {
      camera,
      character,
      sampler,
      playableRadius,
      facingLerpOverride: isThirdPerson
        ? (this.cfg.facingLerpThirdPerson ?? this.cfg.facingLerp)
        : undefined,
      sprintHeld,
      crouchHeld,
    })
  }

  /**
   * Drive {@link GameplayCameraController.update} for one frame.
   * Call after host game logic has run (animRig, consumeEvents, etc.).
   */
  tickCamera(delta: number, ctx: CoordinatorTickContext): void {
    const isThirdPerson = this.gameplayCam.getMode() === 'third-person'
    this.gameplayCam.update(
      ctx.camera,
      delta,
      ctx.character,
      this.player.getFacing(),
      this.player.getCrouchGroundBlend(),
      isThirdPerson ? 0 : this.fpPitch,
    )
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private resetAccumulators(): void {
    this.moveX = 0
    this.moveY = 0
    this.locoSprintOr = false
    this.locoCrouchOr = false
    this.lookYawAcc = 0
    this.lookPitchAcc = 0
    this.fpPitch = 0
  }
}
