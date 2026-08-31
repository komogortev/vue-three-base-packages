/**
 * Character auto-fit rule — the decision half of `fitCharacterScale`.
 *
 * Safety net for grossly mis-scaled character meshes (a Mixamo GLB still
 * authored in centimetres measures ~180 units tall). Kept separate from the
 * THREE code that measures the bounding box and applies the result, so the
 * thresholds are testable and the "correctly-sized models are never touched"
 * property is pinned rather than assumed — double-scaling a good asset is the
 * failure mode this guard exists to avoid.
 */

/** Height a rescued mesh is normalised to (metres). */
export const FIT_TARGET_HEIGHT = 1.7
/** Below this the mesh is assumed mis-scaled (millimetres / unit-scale exports). */
export const FIT_MIN_HEIGHT = 0.3
/** Above this the mesh is assumed mis-scaled (centimetre exports). */
export const FIT_MAX_HEIGHT = 4
/** Heights at or below this are treated as an unmeasurable/degenerate mesh. */
export const FIT_EPSILON = 1e-4

/**
 * Multiplier to apply to a character's scale, or `null` when it should be left
 * alone. Null covers both the healthy case (height already inside the band) and
 * the unmeasurable case (empty or degenerate bounds).
 */
export function fitScaleFor(measuredHeight: number): number | null {
  if (!(measuredHeight > FIT_EPSILON)) return null
  if (measuredHeight >= FIT_MIN_HEIGHT && measuredHeight <= FIT_MAX_HEIGHT) return null
  return FIT_TARGET_HEIGHT / measuredHeight
}
