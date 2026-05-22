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

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tab cycle order for toggle_camera action. */
const CAMERA_MODE_ORDER: GameplayCameraMode[] = ['third-person', 'first-person', 'free-float']

/** Free-float translation speed in m/s. */
const FF_SPEED = 12

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

  // Free-float camera state — seeded from camera transform on mode entry
  private ffYaw = 0
  private ffPitch = 0
  private readonly ffPosition = new THREE.Vector3()

  // Last camera seen in tick() — used to seed free-float when toggle passes camera=null
  private lastCamera: THREE.PerspectiveCamera | null = null

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
        const idx = CAMERA_MODE_ORDER.indexOf(this.gameplayCam.getMode())
        const next = CAMERA_MODE_ORDER[(idx + 1) % CAMERA_MODE_ORDER.length]
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
    } else if (mode === 'free-float') {
      // Camera detaches from character; player stands still.
      // Seed ff state from current camera transform so the view doesn't jump.
      // Falls back to lastCamera (cached each tick) when caller passes null —
      // the Tab toggle always passes null, so the fallback is the common path.
      this.player.setMovementBasis('facing')
      this.lookYawAcc = 0
      this.lookPitchAcc = 0
      const seedCam = camera ?? this.lastCamera
      if (seedCam) {
        this.ffPosition.copy(seedCam.position)
        const euler = new THREE.Euler().setFromQuaternion(seedCam.quaternion, 'YXZ')
        this.ffYaw = euler.y
        this.ffPitch = euler.x
      }
    } else {
      // first-person
      this.player.setMovementBasis('camera')
    }

    this.gameplayCam.setMode(mode)

    // Snap only for modes that follow the character; free-float stays where the
    // camera already is (seeded from camera.position above).
    if (mode !== 'free-float' && camera && character) {
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
   *
   * In free-float mode the player tick is skipped; look input is routed into
   * the free-float yaw/pitch state instead.
   */
  tickPlayer(delta: number, ctx: CoordinatorTickContext): void {
    const { camera, character, sampler, playableRadius } = ctx
    this.lastCamera = camera
    const mode = this.gameplayCam.getMode()

    // ── Apply look input ────────────────────────────────────────────────────
    if (this.lookYawAcc !== 0 || this.lookPitchAcc !== 0) {
      if (mode === 'free-float') {
        this.ffYaw += this.lookYawAcc
        this.ffPitch = THREE.MathUtils.clamp(
          this.ffPitch + this.lookPitchAcc,
          -this.fpPitchLimit,
          this.fpPitchLimit,
        )
      } else if (mode === 'first-person') {
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

    // ── Free-float: player stands still; WASD drives camera in tickCamera ──
    if (mode === 'free-float') {
      this.locoSprintOr = false
      this.locoCrouchOr = false
      return
    }

    // ── Move intent ─────────────────────────────────────────────────────────
    this.player.setMoveIntent(this.moveX, this.moveY)

    // ── Player tick ─────────────────────────────────────────────────────────
    const sprintHeld = this.locoSprintOr
    const crouchHeld = this.locoCrouchOr
    this.locoSprintOr = false
    this.locoCrouchOr = false

    const isThirdPerson = mode === 'third-person'
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
   *
   * In free-float mode the camera is driven directly (WASD + mouse-look);
   * {@link GameplayCameraController.update} is bypassed.
   */
  tickCamera(delta: number, ctx: CoordinatorTickContext): void {
    const mode = this.gameplayCam.getMode()

    if (mode === 'free-float') {
      // Translate in the full 3D direction the camera is pointing.
      // With YXZ Euler (yaw, pitch):
      //   forward = (−sinYaw·cosPitch,  sinPitch,  −cosYaw·cosPitch)
      //   right   = ( cosYaw,           0,         −sinYaw)          ← stays horizontal
      const sinY = Math.sin(this.ffYaw)
      const cosY = Math.cos(this.ffYaw)
      const sinP = Math.sin(this.ffPitch)
      const cosP = Math.cos(this.ffPitch)
      this.ffPosition.x += (-sinY * cosP * this.moveY + cosY * this.moveX) * FF_SPEED * delta
      this.ffPosition.y +=  sinP * this.moveY * FF_SPEED * delta
      this.ffPosition.z += (-cosY * cosP * this.moveY - sinY * this.moveX) * FF_SPEED * delta

      ctx.camera.position.copy(this.ffPosition)
      ctx.camera.rotation.order = 'YXZ'
      ctx.camera.rotation.y = this.ffYaw
      ctx.camera.rotation.x = this.ffPitch
      ctx.camera.rotation.z = 0
      return
    }

    const isThirdPerson = mode === 'third-person'
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
    this.lastCamera = null
  }
}
