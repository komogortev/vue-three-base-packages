import { describe, it, expect } from 'vitest'
import {
  lintGlb,
  hashKey,
  DEFAULT_LINT_PIVOT_EPSILON,
  DEFAULT_LINT_SCALE_EPSILON,
  type GlbLintInput,
} from '../gate/glbLinter'
import type { Aabb, Vec3 } from '../gate/verdict'

const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 }
const BASE_AT_ORIGIN: Aabb = { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1.8, z: 0.5 } }

function input(over: Partial<GlbLintInput> = {}): GlbLintInput {
  return {
    assetId: 'asset-1',
    rootName: 'crystal_shard',
    rootScale: UNIT_SCALE,
    localBounds: BASE_AT_ORIGIN,
    ...over,
  }
}

// ─── named-root ───────────────────────────────────────────────────────────────

describe('lintGlb — named-root', () => {
  it('passes for a descriptive authored name', () => {
    const v = lintGlb(input({ rootName: 'crystal_shard' }))
    const check = v.checks.find((c) => c.id === 'named-root')!
    expect(check.passed).toBe(true)
  })

  it('vetoes an empty name', () => {
    const v = lintGlb(input({ rootName: '' }))
    const check = v.checks.find((c) => c.id === 'named-root')!
    expect(check.passed).toBe(false)
    expect(check.severity).toBe('veto')
  })

  it.each(['Scene', 'RootNode', 'Object_0', 'Mesh 12', 'cube001', 'AuxScene', 'Sketchfab_model', '  Node  '])(
    'vetoes the exporter placeholder %j',
    (name) => {
      const v = lintGlb(input({ rootName: name }))
      expect(v.checks.find((c) => c.id === 'named-root')!.passed).toBe(false)
    },
  )

  it('is case-insensitive against the generic deny-list', () => {
    const v = lintGlb(input({ rootName: 'SCENE' }))
    expect(v.checks.find((c) => c.id === 'named-root')!.passed).toBe(false)
  })

  it('does not flag a legitimate rig root like "Armature"', () => {
    const v = lintGlb(input({ rootName: 'Armature' }))
    expect(v.checks.find((c) => c.id === 'named-root')!.passed).toBe(true)
  })
})

// ─── base-pivot-sanity ────────────────────────────────────────────────────────

describe('lintGlb — base-pivot-sanity', () => {
  it('passes when the pivot sits at the base of the bounds (min.y ≈ 0)', () => {
    const v = lintGlb(input({ localBounds: BASE_AT_ORIGIN }))
    const check = v.checks.find((c) => c.id === 'base-pivot-sanity')!
    expect(check.passed).toBe(true)
    expect(check.measured).toBe(0)
  })

  it('flags a pivot floating above the base (centred pivot) as advisory, not veto', () => {
    const centred: Aabb = { min: { x: -0.5, y: -0.9, z: -0.5 }, max: { x: 0.5, y: 0.9, z: 0.5 } }
    const v = lintGlb(input({ localBounds: centred }))
    const check = v.checks.find((c) => c.id === 'base-pivot-sanity')!
    expect(check.passed).toBe(false)
    expect(check.severity).toBe('advisory')
    expect(check.measured).toBeCloseTo(0.9, 6)
  })

  it('flags a pivot sunk below the base (mesh embeds on placement)', () => {
    const sunk: Aabb = { min: { x: -0.5, y: 0.3, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }
    const v = lintGlb(input({ localBounds: sunk }))
    const check = v.checks.find((c) => c.id === 'base-pivot-sanity')!
    expect(check.passed).toBe(false)
    expect(check.severity).toBe('advisory')
    expect(check.measured).toBeCloseTo(0.3, 6)
  })

  it('honours a custom pivotEpsilon', () => {
    const nearBase: Aabb = { min: { x: -0.5, y: 0.03, z: -0.5 }, max: { x: 0.5, y: 1.8, z: 0.5 } }
    const check = (b: Aabb, eps?: number) =>
      lintGlb(input({ localBounds: b, pivotEpsilon: eps })).checks.find(
        (c) => c.id === 'base-pivot-sanity',
      )!
    expect(check(nearBase).passed).toBe(false) // 0.03 > default 0.02
    expect(check(nearBase, 0.05).passed).toBe(true)
  })
})

// ─── severity tiers (Q6) ──────────────────────────────────────────────────────

describe('lintGlb — severity tiers', () => {
  const CENTRED: Aabb = { min: { x: -0.5, y: -0.9, z: -0.5 }, max: { x: 0.5, y: 0.9, z: 0.5 } }

  it('an advisory-only failure does not block: passed stays true', () => {
    const v = lintGlb(input({ localBounds: CENTRED }))
    expect(v.checks.find((c) => c.id === 'base-pivot-sanity')!.passed).toBe(false)
    expect(v.passed).toBe(true)
    expect(v.severity).toBe('advisory')
    expect(v.status).toBe('continue')
  })

  it('a veto failure blocks and outranks a concurrent advisory failure', () => {
    const v = lintGlb(input({ rootName: 'Scene', localBounds: CENTRED }))
    expect(v.checks.find((c) => c.id === 'named-root')!.passed).toBe(false)
    expect(v.checks.find((c) => c.id === 'base-pivot-sanity')!.passed).toBe(false)
    expect(v.passed).toBe(false)
    expect(v.severity).toBe('veto')
  })

  it("reports 'none' when every check passes", () => {
    const v = lintGlb(input({}))
    expect(v.passed).toBe(true)
    expect(v.severity).toBe('none')
  })
})

// ─── scale-sanity ─────────────────────────────────────────────────────────────

describe('lintGlb — scale-sanity', () => {
  it('passes for a baked 1,1,1 scale', () => {
    const v = lintGlb(input({ rootScale: { x: 1, y: 1, z: 1 } }))
    expect(v.checks.find((c) => c.id === 'scale-sanity')!.passed).toBe(true)
  })

  it('vetoes an unbaked non-uniform scale', () => {
    const v = lintGlb(input({ rootScale: { x: 1, y: 1, z: 2 } }))
    const check = v.checks.find((c) => c.id === 'scale-sanity')!
    expect(check.passed).toBe(false)
    expect(check.measured).toBeCloseTo(1, 6)
  })

  it('honours a custom scaleEpsilon', () => {
    const nearUnit: Vec3 = { x: 1.015, y: 1, z: 1 }
    expect(lintGlb(input({ rootScale: nearUnit })).passed).toBe(false) // 0.015 > default 0.01
    expect(lintGlb(input({ rootScale: nearUnit, scaleEpsilon: 0.05 })).passed).toBe(true)
  })
})

// ─── aggregation ──────────────────────────────────────────────────────────────

describe('lintGlb — aggregation', () => {
  it('passes with status continue when every check passes', () => {
    const v = lintGlb(input())
    expect(v.passed).toBe(true)
    expect(v.status).toBe('continue')
    expect(v.severity).toBe('none')
  })

  it('fails with status refine-code when any check vetoes', () => {
    const v = lintGlb(input({ rootName: 'Scene' }))
    expect(v.passed).toBe(false)
    expect(v.status).toBe('refine-code')
    expect(v.severity).toBe('veto')
  })

  it('always emits exactly the three required checks', () => {
    const v = lintGlb(input())
    expect(v.checks.map((c) => c.id).sort()).toEqual(['base-pivot-sanity', 'named-root', 'scale-sanity'])
  })
})

// ─── hash idempotence ─────────────────────────────────────────────────────────

describe('lintGlb — hash no-op re-check stability', () => {
  it('yields the same hash for identical inputs', () => {
    const a = lintGlb(input())
    const b = lintGlb(input())
    expect(a.hash).toBe(b.hash)
  })

  it('changes the hash when the root name changes', () => {
    const a = lintGlb(input({ rootName: 'crystal_shard' }))
    const b = lintGlb(input({ rootName: 'crystal_shard_v2' }))
    expect(a.hash).not.toBe(b.hash)
  })

  it('is stable under sub-micron jitter (rounding to 1e-6)', () => {
    const a = lintGlb(input({ rootScale: { x: 1, y: 1, z: 1 } }))
    const b = lintGlb(input({ rootScale: { x: 1 + 1e-9, y: 1, z: 1 } }))
    expect(a.hash).toBe(b.hash)
  })

  it('hashKey is deterministic and 8 hex chars', () => {
    expect(hashKey('abc')).toBe(hashKey('abc'))
    expect(hashKey('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(hashKey('abc')).not.toBe(hashKey('abd'))
  })
})

// keep defaults referenced as the documented tolerances
describe('defaults', () => {
  it('exposes a 2cm default pivot epsilon and 1% default scale epsilon', () => {
    expect(DEFAULT_LINT_PIVOT_EPSILON).toBe(0.02)
    expect(DEFAULT_LINT_SCALE_EPSILON).toBe(0.01)
  })
})
