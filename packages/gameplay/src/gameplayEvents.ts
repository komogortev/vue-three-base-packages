/**
 * EventBus keys emitted by the gameplay coordination layer.
 * Subscribe on the shell EventBus to react to camera mode changes.
 */

/** Payload `{ mode: GameplayCameraMode }` — emitted whenever {@link PlayerCameraCoordinator.setCameraMode} runs. */
export const EV_GAMEPLAY_CAMERA_MODE = 'gameplay:camera-mode' as const
