/**
 * Verdict contract for the L0 Asset Gate (F-G2 / F-G6).
 *
 * This is the deterministic, geometry-only subset of the Object Sculptor
 * self-correction verdict (`docs/reference/object-sculptor/ref-self-correction-loop.md`).
 * At L0 the deterministic metrics **veto but never approve** — the approver is the
 * owner's real-rAF glance. The same JSON shape is the seam a local-VLM reviewer
 * fills later (F-G7) with no architecture change.
 *
 * **Contents:** the shared types, plus the small pure constructors/helpers that
 * belong to them and would otherwise be duplicated across the validators
 * ({@link toMat4}). Deliberately no domain logic — validation lives in
 * `attachmentValidator.ts` / `glbLinter.ts`.
 *
 * **Constraint (unchanged):** engine-agnostic and dependency-free — no Vue /
 * Dexie / THREE imports — so the validators can back both the in-editor gate and
 * a future node CLI twin.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Column-major 4x4 matrix (THREE `Matrix4.elements` convention).
 *
 * A fixed-length 16-tuple rather than `readonly number[]`: every consumer
 * ({@link transformPoint}, the canonical idempotence hash key) indexes all 16
 * slots, so a wrong-length array must fail to typecheck instead of silently
 * producing `NaN` at runtime. Build one from a THREE `Matrix4.elements` — or
 * from a hand-written array in the CLI twin — with {@link toMat4}.
 */
export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

/**
 * Narrow a loose numeric array (e.g. THREE's `Matrix4.elements`, typed
 * `number[]`) to {@link Mat4}, throwing when it is not exactly 16 long.
 *
 * The runtime guard is the half a cast cannot give: the CLI twin hand-builds
 * matrices, and a short array there would otherwise reach {@link transformPoint}
 * and yield `NaN` coordinates.
 */
export function toMat4(elements: ArrayLike<number>): Mat4 {
  if (elements.length !== 16) {
    throw new RangeError(`Mat4 requires exactly 16 elements, received ${elements.length}`)
  }
  return Array.from(elements) as unknown as Mat4
}

/** Axis-aligned bounding box in a shared (world) frame. */
export interface Aabb {
  min: Vec3
  max: Vec3
}

/**
 * Reviewer action set, carried verbatim from the self-correction loop so a later
 * VLM reviewer can widen usage without changing the type. At L0 only `continue`
 * (all checks pass) and `refine-code` (a geometric veto — attachment data is
 * present but the placement does not honour it) are emitted.
 */
export type VerdictStatus =
  | 'continue'
  | 'refine-spec'
  | 'refine-code'
  | 'refine-batch'
  | 'strategy-reset'
  | 'request-input'
  | 'stop'

/**
 * `veto` blocks export; `advisory` warns only. Mirrors the two-tier gate (Q2):
 * deterministic metrics veto but never approve.
 */
export type CheckSeverity = 'veto' | 'advisory'

export interface GateCheck {
  /** Stable check id, e.g. 'pivot-at-start', 'contact-gap'. */
  id: string
  passed: boolean
  severity: CheckSeverity
  /** Human-readable explanation, safe to surface in the editor. */
  message: string
  /** Measured value (metres) when the check is quantitative. */
  measured?: number
  /** Threshold the measurement was compared against (metres). */
  tolerance?: number
}

export interface PlacementVerdict {
  /** SavedPlacedObject.id this verdict is about. */
  placedId: string
  status: VerdictStatus
  /** Worst failing severity, or 'none' when every check passed. */
  severity: CheckSeverity | 'none'
  /** True unless a veto-class check failed. Advisory failures do not flip this. */
  passed: boolean
  checks: GateCheck[]
  /**
   * Binds to the placement descriptor + geometry so a no-op re-check is
   * idempotent (a re-run over unchanged inputs yields the same hash). L0 uses a
   * fast non-cryptographic hash; the VLM socket (F-G7) upgrades this to sha256.
   */
  hash: string
}
