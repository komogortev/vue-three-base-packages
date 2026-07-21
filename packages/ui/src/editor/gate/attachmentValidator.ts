/**
 * Attachment validator — L0 Asset Gate (F-G2).
 *
 * Pure, engine-agnostic geometric preflight for a placed object that declares an
 * {@link PlacedAttachment}. Two deterministic checks, both veto-class:
 *
 *  - **pivot-at-start** — the child's placed origin must sit at the declared
 *    `localStart` joint (parent-local → world). This is the assertion that kills
 *    floating props: a mesh centred on an arbitrary transform fails here.
 *  - **contact-gap** — the child root must touch/embed the parent surface within
 *    `gapTolerance` (bounds-based gap; a raycast gap is a later refinement). When
 *    parent bounds are unavailable the gap cannot be measured → advisory, not veto.
 *
 * No THREE / Vue / Dexie imports: geometry arrives as plain numbers (a column-major
 * `Mat4` and an `Aabb`) so the same code runs in vitest and a future CLI twin. The
 * call site (viewport / exporter) reads `object.matrixWorld.elements` and a computed
 * world AABB from the live scene and passes them in.
 */
import type { PlacedAttachment, SavedPlacedObject } from '../sandboxSceneSchema'
import type {
  Aabb,
  GateCheck,
  Mat4,
  PlacementVerdict,
  Vec3,
  VerdictStatus,
} from './verdict'

/** Default tolerance (m) for the pivot-at-start assertion — tight, authoring-level. */
export const DEFAULT_PIVOT_EPSILON = 0.01

export interface ValidatePlacementInput {
  /** The placed child. Must carry `attachment` — free placements are not gated. */
  child: SavedPlacedObject
  /** Parent world matrix (column-major, THREE `Matrix4.elements`). */
  parentWorldMatrix: Mat4
  /** Parent world-space AABB for the contact-gap check. Omit → gap unmeasured. */
  parentWorldBounds?: Aabb
  /** Override for the pivot assertion tolerance (m). */
  pivotEpsilon?: number
}

// ── geometry helpers (column-major Mat4, THREE convention) ──────────────────

/** Transform a point by a column-major 4x4 matrix. */
export function transformPoint(m: Mat4, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  }
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Shortest distance from a point to an AABB. 0 when the point is inside/on it. */
export function pointToAabbDistance(p: Vec3, box: Aabb): number {
  const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x)
  const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y)
  const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ── idempotence hash (FNV-1a, deterministic, non-crypto) ────────────────────

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function canonicalKey(input: ValidatePlacementInput): string {
  const c = input.child
  const a = c.attachment
  return JSON.stringify([
    c.id,
    [round6(c.x), round6(c.y), round6(c.z)],
    a && [
      a.parentId,
      a.parentSocket ?? null,
      [round6(a.localStart.x), round6(a.localStart.y), round6(a.localStart.z)],
      [round6(a.localEnd.x), round6(a.localEnd.y), round6(a.localEnd.z)],
      a.embedDepth != null ? round6(a.embedDepth) : null,
      a.overlap != null ? round6(a.overlap) : null,
      a.contactType,
      round6(a.gapTolerance),
    ],
    input.parentWorldMatrix.map(round6),
    input.parentWorldBounds && [
      [round6(input.parentWorldBounds.min.x), round6(input.parentWorldBounds.min.y), round6(input.parentWorldBounds.min.z)],
      [round6(input.parentWorldBounds.max.x), round6(input.parentWorldBounds.max.y), round6(input.parentWorldBounds.max.z)],
    ],
    round6(input.pivotEpsilon ?? DEFAULT_PIVOT_EPSILON),
  ])
}

/** Deterministic 32-bit FNV-1a hash as an 8-char hex string. */
export function hashKey(key: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ── validator ───────────────────────────────────────────────────────────────

function statusFor(passed: boolean): VerdictStatus {
  // A geometric veto means the attachment data is present but the placement does
  // not honour it → refine-code per the self-correction root-cause guide.
  return passed ? 'continue' : 'refine-code'
}

/**
 * Validate a single placed object against its declared attachment.
 *
 * A child without `attachment` is free placement — nothing to enforce — and
 * returns a trivially-passing verdict.
 */
export function validatePlacement(input: ValidatePlacementInput): PlacementVerdict {
  const { child } = input
  const hash = hashKey(canonicalKey(input))
  const att: PlacedAttachment | undefined = child.attachment

  if (!att) {
    return {
      placedId: child.id,
      status: 'continue',
      severity: 'none',
      passed: true,
      checks: [],
      hash,
    }
  }

  const eps = input.pivotEpsilon ?? DEFAULT_PIVOT_EPSILON
  const childPivotWorld: Vec3 = { x: child.x, y: child.y, z: child.z }
  const expectedJoint = transformPoint(input.parentWorldMatrix, att.localStart)
  const checks: GateCheck[] = []

  // Check 1 — pivot-at-start (veto).
  const pivotGap = distance(childPivotWorld, expectedJoint)
  checks.push({
    id: 'pivot-at-start',
    passed: pivotGap <= eps,
    severity: 'veto',
    message:
      pivotGap <= eps
        ? 'Child pivot sits at the declared localStart joint.'
        : `Child pivot is ${pivotGap.toFixed(3)} m from its declared localStart joint (max ${eps} m). The mesh is placed as a free transform rather than anchored at the joint.`,
    measured: pivotGap,
    tolerance: eps,
  })

  // Check 2 — contact-gap (veto when measurable, else advisory).
  if (input.parentWorldBounds) {
    const gap = pointToAabbDistance(childPivotWorld, input.parentWorldBounds)
    checks.push({
      id: 'contact-gap',
      passed: gap <= att.gapTolerance,
      severity: 'veto',
      message:
        gap <= att.gapTolerance
          ? `Child root contacts the parent within tolerance (gap ${gap.toFixed(3)} m).`
          : `Air gap of ${gap.toFixed(3)} m between child root and parent (max ${att.gapTolerance} m) — the ${att.contactType} contact is floating.`,
      measured: gap,
      tolerance: att.gapTolerance,
    })
  } else {
    checks.push({
      id: 'contact-gap',
      passed: false,
      severity: 'advisory',
      message: 'Parent bounds unavailable — contact gap could not be measured.',
      tolerance: att.gapTolerance,
    })
  }

  const vetoFailed = checks.some((c) => !c.passed && c.severity === 'veto')
  const advisoryFailed = checks.some((c) => !c.passed && c.severity === 'advisory')
  const passed = !vetoFailed

  return {
    placedId: child.id,
    status: statusFor(passed),
    severity: vetoFailed ? 'veto' : advisoryFailed ? 'advisory' : 'none',
    passed,
    checks,
    hash,
  }
}

export interface GateSummary {
  /** True when any placement failed a veto-class check — export must hard-block. */
  blocked: boolean
  verdicts: PlacementVerdict[]
  vetoCount: number
  advisoryCount: number
}

/** Aggregate verdicts for the two-tier gate (F-G3). */
export function summarizeVerdicts(verdicts: PlacementVerdict[]): GateSummary {
  let vetoCount = 0
  let advisoryCount = 0
  for (const v of verdicts) {
    if (!v.passed) vetoCount++
    else if (v.checks.some((c) => !c.passed && c.severity === 'advisory')) advisoryCount++
  }
  return {
    blocked: vetoCount > 0,
    verdicts,
    vetoCount,
    advisoryCount,
  }
}
