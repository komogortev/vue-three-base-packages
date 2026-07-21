import { describe, it, expect } from 'vitest'
import {
  validatePlacement,
  summarizeVerdicts,
  transformPoint,
  pointToAabbDistance,
  hashKey,
  DEFAULT_PIVOT_EPSILON,
  type ValidatePlacementInput,
} from '../gate/attachmentValidator'
import type { Mat4, Aabb } from '../gate/verdict'
import type { PlacedAttachment, SavedPlacedObject } from '../sandboxSceneSchema'

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** Column-major translation matrix (THREE convention: translation in [12..14]). */
function translation(tx: number, ty: number, tz: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
}

function placed(over: Partial<SavedPlacedObject> = {}): SavedPlacedObject {
  return {
    id: 'placed-child',
    assetId: 'asset-1',
    label: 'branch.glb',
    x: 0, y: 0, z: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
    ...over,
  }
}

function attach(over: Partial<PlacedAttachment> = {}): PlacedAttachment {
  return {
    parentId: 'placed-parent',
    localStart: { x: 0, y: 0, z: 0 },
    localEnd: { x: 0, y: 1, z: 0 },
    contactType: 'socket',
    gapTolerance: 0.05,
    ...over,
  }
}

// ─── geometry helpers ─────────────────────────────────────────────────────────

describe('transformPoint', () => {
  it('is identity under the identity matrix', () => {
    expect(transformPoint(IDENTITY, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
  })
  it('applies translation from the column-major slots', () => {
    expect(transformPoint(translation(5, 0, -2), { x: 1, y: 1, z: 1 })).toEqual({ x: 6, y: 1, z: -1 })
  })
})

describe('pointToAabbDistance', () => {
  const box: Aabb = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
  it('is zero inside the box', () => {
    expect(pointToAabbDistance({ x: 0, y: 0, z: 0 }, box)).toBe(0)
  })
  it('is zero on the surface', () => {
    expect(pointToAabbDistance({ x: 1, y: 0, z: 0 }, box)).toBe(0)
  })
  it('measures the shortest gap outside on one axis', () => {
    expect(pointToAabbDistance({ x: 0, y: 3, z: 0 }, box)).toBeCloseTo(2, 6)
  })
})

// ─── validatePlacement ────────────────────────────────────────────────────────

describe('validatePlacement — no attachment', () => {
  it('passes trivially for a free placement', () => {
    const v = validatePlacement({ child: placed(), parentWorldMatrix: IDENTITY })
    expect(v.passed).toBe(true)
    expect(v.severity).toBe('none')
    expect(v.status).toBe('continue')
    expect(v.checks).toEqual([])
  })
})

describe('validatePlacement — pivot-at-start', () => {
  it('passes when the child pivot sits at localStart (identity parent)', () => {
    const child = placed({ x: 0, y: 0, z: 0, attachment: attach({ localStart: { x: 0, y: 0, z: 0 } }) })
    const v = validatePlacement({ child, parentWorldMatrix: IDENTITY })
    const pivot = v.checks.find((c) => c.id === 'pivot-at-start')!
    expect(pivot.passed).toBe(true)
  })

  it('vetoes when the child is dragged away from its declared joint', () => {
    const child = placed({ x: 0, y: 2, z: 0, attachment: attach({ localStart: { x: 0, y: 0, z: 0 } }) })
    const v = validatePlacement({ child, parentWorldMatrix: IDENTITY })
    const pivot = v.checks.find((c) => c.id === 'pivot-at-start')!
    expect(pivot.passed).toBe(false)
    expect(pivot.severity).toBe('veto')
    expect(pivot.measured).toBeCloseTo(2, 6)
    expect(v.passed).toBe(false)
    expect(v.severity).toBe('veto')
    expect(v.status).toBe('refine-code')
  })

  it('resolves localStart through a non-identity parent world matrix', () => {
    // Parent translated to (10,0,0); localStart (0,0,0) → world (10,0,0).
    // Child placed at (10,0,0) is anchored; at origin it floats.
    const anchored = placed({ x: 10, y: 0, z: 0, attachment: attach({ localStart: { x: 0, y: 0, z: 0 } }) })
    const floating = placed({ x: 0, y: 0, z: 0, attachment: attach({ localStart: { x: 0, y: 0, z: 0 } }) })
    const m = translation(10, 0, 0)
    expect(validatePlacement({ child: anchored, parentWorldMatrix: m }).checks.find((c) => c.id === 'pivot-at-start')!.passed).toBe(true)
    expect(validatePlacement({ child: floating, parentWorldMatrix: m }).checks.find((c) => c.id === 'pivot-at-start')!.passed).toBe(false)
  })

  it('honours a custom pivotEpsilon', () => {
    const child = placed({ x: 0, y: 0.02, z: 0, attachment: attach() })
    expect(validatePlacement({ child, parentWorldMatrix: IDENTITY }).passed).toBe(false) // 0.02 > default 0.01
    expect(validatePlacement({ child, parentWorldMatrix: IDENTITY, pivotEpsilon: 0.05 }).passed).toBe(true)
  })
})

describe('validatePlacement — contact-gap', () => {
  const parentBox: Aabb = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

  it('passes when the child root touches the parent surface', () => {
    const child = placed({ x: 1, y: 0, z: 0, attachment: attach({ localStart: { x: 1, y: 0, z: 0 } }) })
    const v = validatePlacement({ child, parentWorldMatrix: IDENTITY, parentWorldBounds: parentBox })
    const gap = v.checks.find((c) => c.id === 'contact-gap')!
    expect(gap.passed).toBe(true)
    expect(gap.measured).toBe(0)
    expect(v.passed).toBe(true)
  })

  it('vetoes a floating contact beyond gapTolerance', () => {
    const child = placed({ x: 0, y: 3, z: 0, attachment: attach({ localStart: { x: 0, y: 3, z: 0 }, gapTolerance: 0.05 }) })
    const v = validatePlacement({ child, parentWorldMatrix: IDENTITY, parentWorldBounds: parentBox })
    const gap = v.checks.find((c) => c.id === 'contact-gap')!
    expect(gap.passed).toBe(false)
    expect(gap.severity).toBe('veto')
    expect(gap.measured).toBeCloseTo(2, 6) // 3 - box.max.y(1)
    expect(v.passed).toBe(false)
    expect(gap.message).toContain('socket') // contactType surfaced
  })

  it('is advisory (never veto) when parent bounds are unavailable', () => {
    const child = placed({ x: 0, y: 5, z: 0, attachment: attach({ localStart: { x: 0, y: 5, z: 0 } }) })
    const v = validatePlacement({ child, parentWorldMatrix: IDENTITY }) // no bounds
    const gap = v.checks.find((c) => c.id === 'contact-gap')!
    expect(gap.passed).toBe(false)
    expect(gap.severity).toBe('advisory')
    expect(v.passed).toBe(true) // advisory does not block
    expect(v.severity).toBe('advisory')
  })
})

describe('validatePlacement — sentinel parents', () => {
  it('treats room-root as identity world origin', () => {
    const child = placed({ x: 0, y: 0, z: 0, attachment: attach({ parentId: 'room-root', localStart: { x: 0, y: 0, z: 0 } }) })
    // Caller passes identity for sentinels; localStart maps to world directly.
    expect(validatePlacement({ child, parentWorldMatrix: IDENTITY }).checks.find((c) => c.id === 'pivot-at-start')!.passed).toBe(true)
  })

  it('treats terrain as identity world origin', () => {
    const child = placed({ x: 4, y: 0, z: -4, attachment: attach({ parentId: 'terrain', localStart: { x: 4, y: 0, z: -4 } }) })
    expect(validatePlacement({ child, parentWorldMatrix: IDENTITY }).passed).toBe(true)
  })
})

// ─── hash idempotence ─────────────────────────────────────────────────────────

describe('hash — no-op re-check stability', () => {
  it('yields the same hash for identical inputs', () => {
    const input: ValidatePlacementInput = { child: placed({ attachment: attach() }), parentWorldMatrix: IDENTITY }
    const a = validatePlacement(input)
    const b = validatePlacement({ child: placed({ attachment: attach() }), parentWorldMatrix: IDENTITY })
    expect(a.hash).toBe(b.hash)
  })

  it('changes the hash when the child transform moves', () => {
    const a = validatePlacement({ child: placed({ x: 0, attachment: attach() }), parentWorldMatrix: IDENTITY })
    const b = validatePlacement({ child: placed({ x: 0.5, attachment: attach() }), parentWorldMatrix: IDENTITY })
    expect(a.hash).not.toBe(b.hash)
  })

  it('is stable under sub-micron jitter (rounding to 1e-6)', () => {
    const a = validatePlacement({ child: placed({ x: 1, attachment: attach() }), parentWorldMatrix: IDENTITY })
    const b = validatePlacement({ child: placed({ x: 1 + 1e-9, attachment: attach() }), parentWorldMatrix: IDENTITY })
    expect(a.hash).toBe(b.hash)
  })

  it('hashKey is deterministic and 8 hex chars', () => {
    expect(hashKey('abc')).toBe(hashKey('abc'))
    expect(hashKey('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(hashKey('abc')).not.toBe(hashKey('abd'))
  })
})

// ─── summarizeVerdicts ────────────────────────────────────────────────────────

describe('summarizeVerdicts', () => {
  it('is unblocked with zero counts for an empty set', () => {
    expect(summarizeVerdicts([])).toEqual({ blocked: false, verdicts: [], vetoCount: 0, advisoryCount: 0 })
  })

  it('blocks and counts vetoes; advisories do not block', () => {
    const veto = validatePlacement({ child: placed({ id: 'p1', y: 2, attachment: attach() }), parentWorldMatrix: IDENTITY })
    const advisory = validatePlacement({ child: placed({ id: 'p2', attachment: attach() }), parentWorldMatrix: IDENTITY }) // no bounds → advisory
    const clean = validatePlacement({ child: placed({ id: 'p3' }), parentWorldMatrix: IDENTITY }) // no attachment
    const s = summarizeVerdicts([veto, advisory, clean])
    expect(s.blocked).toBe(true)
    expect(s.vetoCount).toBe(1)
    expect(s.advisoryCount).toBe(1)
  })

  it('is unblocked when only advisories are present', () => {
    const advisory = validatePlacement({ child: placed({ attachment: attach() }), parentWorldMatrix: IDENTITY })
    const s = summarizeVerdicts([advisory])
    expect(s.blocked).toBe(false)
    expect(s.advisoryCount).toBe(1)
  })
})

// keep DEFAULT_PIVOT_EPSILON referenced as the documented default
describe('defaults', () => {
  it('exposes a 1cm default pivot epsilon', () => {
    expect(DEFAULT_PIVOT_EPSILON).toBe(0.01)
  })
})
