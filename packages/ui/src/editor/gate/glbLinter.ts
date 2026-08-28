/**
 * GLB linter — L0 Asset Gate (F-G5).
 *
 * Pure, engine-agnostic "action-ready" preflight for an uploaded GLB's root node.
 * Three deterministic checks, all veto-class (Q3 "required/error" tier):
 *
 *  - **named-root** — the scene root must carry a stable, human-authored name.
 *    Auto-generated exporter placeholders ("Scene", "RootNode", "Object_0", ...)
 *    give sockets/collider metadata nothing stable to reference once the file is
 *    re-exported.
 *  - **base-pivot-sanity** — the root's local origin must sit at (or within
 *    tolerance of) the base of its own bounding box, not floating at the
 *    geometric centre. This is the placement convention the editor's click-to-place
 *    Y-snap already assumes; a centred pivot makes props embed into or hover above
 *    the floor.
 *  - **scale-sanity** — the root's local scale must be (approximately) baked to
 *    1,1,1. Unbaked scale (common from some DCC exports) silently corrupts the
 *    attachment validator's (F-G2) world-matrix math downstream.
 *
 * Deferred to a later slice (Q3 "deferred/warn" tier): named sockets, collider
 * intent metadata, hinge pivots, destruction groups.
 *
 * No THREE / Vue / Dexie imports: geometry arrives as plain numbers (a `Vec3`
 * scale and an `Aabb`) so the same code can run in vitest and a future node CLI
 * twin. The call site (asset upload pipeline) reads `gltf.scene.name`,
 * `gltf.scene.scale`, and a computed local-space AABB from the parsed GLB and
 * passes them in.
 */
import { hashKey } from './verdict'
import type { Aabb, CheckSeverity, GateCheck, Vec3, VerdictStatus } from './verdict'

export { hashKey } from './verdict'

export const DEFAULT_LINT_PIVOT_EPSILON = 0.02
export const DEFAULT_LINT_SCALE_EPSILON = 0.01

export interface GlbLintInput {
  /** Asset registry id this lint is about. */
  assetId: string
  /** Scene root node name as parsed from the GLB. */
  rootName: string
  /** Root node local scale. */
  rootScale: Vec3
  /** Bounding box of the geometry under the root, in the root's own local frame (origin at the root's pivot). */
  localBounds: Aabb
  /** Override for the base-pivot assertion tolerance (m). */
  pivotEpsilon?: number
  /** Override for the scale-bake assertion tolerance (fractional deviation from 1.0). */
  scaleEpsilon?: number
}

export interface GlbLintVerdict {
  assetId: string
  status: VerdictStatus
  /** Worst failing severity, or 'none' when every check passed. */
  severity: CheckSeverity | 'none'
  passed: boolean
  checks: GateCheck[]
  /** Binds to the lint inputs so a no-op re-check over an unchanged GLB is idempotent. */
  hash: string
}

// ── generic root-name detection ──────────────────────────────────────────────

const GENERIC_ROOT_NAMES = new Set([
  '',
  'scene',
  'scene0',
  'rootnode',
  'root',
  'auxscene',
  'untitled',
  'group',
  'node',
  'object',
  'mesh',
  'gltf_scene',
  'sketchfab_model',
])

/** Matches exporter placeholders like "Object_3", "Mesh 12", "cube001". */
const GENERIC_ROOT_PATTERN = /^(object|mesh|node|group|scene|cube|empty)[_\s-]?\d*$/i

function isGenericRootName(name: string): boolean {
  const trimmed = name.trim()
  if (GENERIC_ROOT_NAMES.has(trimmed.toLowerCase())) return true
  return GENERIC_ROOT_PATTERN.test(trimmed)
}

// ── idempotence hash (FNV-1a, deterministic, non-crypto — mirrors attachmentValidator) ──

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function canonicalKey(input: GlbLintInput): string {
  return JSON.stringify([
    input.assetId,
    input.rootName,
    [round6(input.rootScale.x), round6(input.rootScale.y), round6(input.rootScale.z)],
    [
      [round6(input.localBounds.min.x), round6(input.localBounds.min.y), round6(input.localBounds.min.z)],
      [round6(input.localBounds.max.x), round6(input.localBounds.max.y), round6(input.localBounds.max.z)],
    ],
    round6(input.pivotEpsilon ?? DEFAULT_LINT_PIVOT_EPSILON),
    round6(input.scaleEpsilon ?? DEFAULT_LINT_SCALE_EPSILON),
  ])
}

// ── linter ────────────────────────────────────────────────────────────────────

/**
 * Lint a single uploaded GLB's root node against the L0 action-ready contract.
 */
export function lintGlb(input: GlbLintInput): GlbLintVerdict {
  const hash = hashKey(canonicalKey(input))
  const pivotEps = input.pivotEpsilon ?? DEFAULT_LINT_PIVOT_EPSILON
  const scaleEps = input.scaleEpsilon ?? DEFAULT_LINT_SCALE_EPSILON
  const checks: GateCheck[] = []

  // Check 1 — named-root (veto).
  const generic = isGenericRootName(input.rootName)
  checks.push({
    id: 'named-root',
    passed: !generic,
    severity: 'veto',
    message: generic
      ? `Root node name "${input.rootName || '(empty)'}" is an exporter placeholder, not a stable authored name — re-export with a distinct root name before it can carry socket/collider references.`
      : `Root node carries a stable name ("${input.rootName}").`,
  })

  // Check 2 — base-pivot-sanity (veto).
  const pivotGap = Math.abs(input.localBounds.min.y)
  checks.push({
    id: 'base-pivot-sanity',
    passed: pivotGap <= pivotEps,
    severity: 'veto',
    message:
      pivotGap <= pivotEps
        ? 'Root pivot sits at the base of its bounding box.'
        : `Root pivot is ${pivotGap.toFixed(3)} m from the base of its own bounding box (max ${pivotEps} m) — the mesh will embed into or hover above the floor when placed with the editor's Y-snap.`,
    measured: pivotGap,
    tolerance: pivotEps,
  })

  // Check 3 — scale-sanity (veto).
  const scaleDeviation = Math.max(
    Math.abs(input.rootScale.x - 1),
    Math.abs(input.rootScale.y - 1),
    Math.abs(input.rootScale.z - 1),
  )
  checks.push({
    id: 'scale-sanity',
    passed: scaleDeviation <= scaleEps,
    severity: 'veto',
    message:
      scaleDeviation <= scaleEps
        ? 'Root scale is baked to 1,1,1.'
        : `Root scale (${input.rootScale.x.toFixed(3)}, ${input.rootScale.y.toFixed(3)}, ${input.rootScale.z.toFixed(3)}) deviates ${scaleDeviation.toFixed(3)} from baked 1,1,1 (max ${scaleEps}) — bake the scale before export, or downstream placement/attachment math will be off.`,
    measured: scaleDeviation,
    tolerance: scaleEps,
  })

  const vetoFailed = checks.some((c) => !c.passed && c.severity === 'veto')
  const passed = !vetoFailed

  return {
    assetId: input.assetId,
    status: passed ? 'continue' : 'refine-code',
    severity: vetoFailed ? 'veto' : 'none',
    passed,
    checks,
    hash,
  }
}
