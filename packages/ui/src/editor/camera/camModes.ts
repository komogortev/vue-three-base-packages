/**
 * Editor camera-mode cycle order — the pure half of the camera-mode section.
 *
 * `setEditorCamMode` is all THREE side effects (controls, visibility, pointer
 * lock); the ordering it cycles through is not, and an off-by-one in the wrap
 * is silent. Split out so the cycle is testable on its own.
 */
import type { EditorCamMode } from '../sceneEditorTypes'

/** Tab cycles through the modes in this order, wrapping at the end. */
export const CAM_MODE_ORDER: readonly EditorCamMode[] = [
  'orbit',
  'first-person',
  'follow-3p',
  'free-float',
]

/**
 * Next mode in the cycle. An unknown current mode restarts the cycle at its
 * head rather than throwing — `indexOf` returning -1 would otherwise wrap to
 * the *last* entry, which reads as cycling backwards.
 */
export function nextCamMode(current: EditorCamMode): EditorCamMode {
  const i = CAM_MODE_ORDER.indexOf(current)
  if (i === -1) return CAM_MODE_ORDER[0]!
  return CAM_MODE_ORDER[(i + 1) % CAM_MODE_ORDER.length]!
}
