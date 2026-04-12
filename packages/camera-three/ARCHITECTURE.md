# @base/camera-three — Architecture

_Reviewed: 2026-04-12_

## Package overview

Drives a `THREE.PerspectiveCamera` for third-person chase or first-person eye-height placement.
Six source files; no game imports.

| File | Role |
|---|---|
| `GameplayCameraController.ts` | Controller class — owns mode, preset, lerp, snap/update API |
| `computeThirdPersonRig.ts` | Pure math — world camera + lookAt from character pos, facing, rig params |
| `thirdPersonPresets.ts` | 4 named presets + `ThirdPersonViewCam` type + `resolveThirdPersonViewCam` |
| `firstPersonConfig.ts` | `FirstPersonViewConfig` type + default (eyeOffsetY, crouchEyeDrop, eyePullback) |
| `index.ts` | Package re-exports |
| `computeThirdPersonRig.test.ts` | Unit tests for rig math |

---

## GameplayCameraController

```ts
type GameplayCameraMode = 'third-person' | 'first-person'
```

### Construction

```ts
new GameplayCameraController({
  cameraLerp,           // lerp speed for third-person position (higher = snappier)
  cameraPreset?,        // 'close-follow' | 'shoulder' | 'high' | 'tactical'
  thirdPersonOverrides?,// Partial<ThirdPersonViewCam> applied on top of preset
  firstPerson?,         // Partial<FirstPersonViewConfig>
  mode?,                // initial mode (default 'third-person')
})
```

### API

| Method | Description |
|---|---|
| `setMode(mode)` | Switch between third-person / first-person |
| `getMode()` | Returns current mode |
| `setCameraPreset(preset)` | Swap named rig; overrides are re-applied |
| `getCameraPreset()` | Returns current preset name |
| `setThirdPersonOverrides(overrides)` | Replace partial rig fields; reapplies preset |
| `getThirdPersonViewCam()` | Returns resolved rig copy |
| `snapToCharacter(camera, character, facing, crouchBlend)` | Instant camera placement (no lerp) |
| `update(camera, delta, character, facing, crouchBlend, fpPitch?)` | Per-frame lerped update |

### Third-person update

Position lerps to the computed chase target each frame (`Math.min(1, cameraLerp * delta)`).
Look-at is set directly to the character pivot — no lerp on look-at.

### First-person update

Instant placement: eye = `character.position.y + eyeOffsetY − crouchEyeDrop * crouchBlend`.
Optional `eyePullback` shifts the camera forward in XZ (prevents clipping into skull geometry).
Camera rotation uses `YXZ` Euler order: yaw = `facing`, pitch = `fpPitch`, roll = 0.

---

## computeThirdPersonCamera

```ts
computeThirdPersonCamera(
  character: Vec3,          // world position of locomotion root
  facing: number,           // Y-axis radians (same frame as PlayerController)
  rig: ThirdPersonViewCam,  // { distance, height, lateral, pivotY }
  crouchGroundBlend: number // 0–1; scales height and pivotY
): { camera: Vec3; lookAt: Vec3 }
```

Camera sits **behind** the character along the facing back-vector (`+sin(f), +cos(f)` in XZ).
`lateral` offsets along the character's right (positive = camera right of spine, negative = left).
Crouch scaling: `height *= (1 − 0.2 * cb)`, `pivotY *= (1 − 0.35 * cb)`.

---

## Third-person presets

| Preset | distance | height | lateral | pivotY | Use |
|---|---|---|---|---|---|
| `close-follow` | 5.4 | 2.35 | −0.72 | 1.38 | Default gameplay — OTS left bias |
| `shoulder` | 6.8 | 3.0 | +0.42 | 1.05 | Adventure / exploration |
| `high` | 11 | 7.5 | 0 | 0.35 | Overview / wider framing |
| `tactical` | 16 | 42 | 0 | 0.2 | Top-down / strategy |

`resolveThirdPersonViewCam(preset, overrides)` merges per-field overrides on top of the named preset.
Scene descriptors use `thirdPersonOverrides` to tune per-scene without creating new presets.

---

## FirstPersonViewConfig

```ts
interface FirstPersonViewConfig {
  eyeOffsetY: number      // vertical offset above locomotion root (default 0.75)
  crouchEyeDrop: number   // eye lowers by this amount at crouchBlend=1 (default 0.28)
  eyePullback: number     // forward XZ shift to avoid skull clipping (default 0)
}
```

---

## Integration with PlayerCameraCoordinator (`@base/gameplay`)

`PlayerCameraCoordinator` wires input → player → camera in a single coordinator:

- Subscribes `input:axis` (move / locomotion / look) on `mount(eventBus)`
- Subscribes `input:action` for `toggle_camera` (third ↔ first, pointer-lock, movementBasis)
- `tickPlayer(delta, ctx)` → flushes look input, sets move intent, calls `PlayerController.tick()`
- `tickCamera(delta, ctx)` → calls `GameplayCameraController.update()`
- `tick(delta, ctx)` — convenience wrapper for tickPlayer + tickCamera back-to-back
- `setCameraMode(mode, camera, character, eventBus)` — public API for programmatic mode changes
- Emits `gameplay:camera-mode` event on every mode change

The split `tickPlayer` / `tickCamera` lets the host module inject game logic (consumeEvents, animRig, exit zones) between player and camera ticks.

### Editor play-sim usage (threejs-engine-dev)

In the harness editor, the same `GameplayCameraController` is used in gameplay simulation mode:
- `B` toggles mode (third-person ↔ first-person) via `toggle_camera` action
- `[` / `]` cycles presets via `setCameraPreset` + `THIRD_PERSON_CAMERA_PRESET_ORDER`
- Editor orbit (OrbitControls) replaces the coordinator while not in play-sim

---

## Phase 4C readiness — cinematic camera

**Finding: no blockers. Phase 4C is purely additive.**

### What Phase 4C needs

1. **Camera rails** — a new `'cinematic'` mode or a parallel `CinematicCameraRig` class using CatmullRom splines for world-space rail paths.
2. **Blend / transition** — a `CameraTransitionManager` that lerps between gameplay position and a rail target over a configurable duration.
3. **Input freeze** — `PlayerCameraCoordinator` needs a `suspend()` / `resume()` method (or a `'cinematic'` guard in `tickPlayer`) to freeze player input during cutscenes.

### What does NOT need to change

- `GameplayCameraController` — extend `GameplayCameraMode` union or bypass entirely; no existing method needs modification.
- `computeThirdPersonCamera` — pure function, no changes.
- `PlayerCameraCoordinator` — additive: `suspend()` + `resume()` methods, or a `'cinematic'` early-return in `tickPlayer`.
- Presets / overrides / first-person config — untouched.

### Recommended addition surface

```ts
// New file: @base/camera-three/src/CinematicCameraRig.ts
// - CatmullRomCurve3 rail from authored waypoints
// - evaluate(t): { position, lookAt }
// - play(duration) / pause / seek

// New file: @base/camera-three/src/CameraTransitionManager.ts
// - blend(from: CameraState, to: CameraState, duration)
// - tick(delta, camera)

// Extension in PlayerCameraCoordinator:
// - suspend(): void  — halts input accumulation + player tick
// - resume(): void   — re-enables
```

No existing `@base/camera-three` API surface changes required for Phase 4C.
