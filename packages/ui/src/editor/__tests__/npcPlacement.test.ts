import { describe, it, expect } from 'vitest'
import {
  baseScaleFor,
  entryScale,
  npcTransform,
  totalScale,
} from '../pose/npcPlacement'
import { FIT_MAX_HEIGHT, FIT_MIN_HEIGHT, FIT_TARGET_HEIGHT } from '../pose/characterFit'

describe('entryScale', () => {
  it('passes a positive finite scale through', () => {
    expect(entryScale(2.5)).toBe(2.5)
  })
  // Each of these must fall back to 1, or an NPC can vanish (0) or mirror (<0).
  it.each([undefined, 0, -1, NaN, Infinity])('treats %s as unscaled', v => {
    expect(entryScale(v as number | undefined)).toBe(1)
  })
})

describe('baseScaleFor', () => {
  it('leaves a sane-sized model alone', () => {
    expect(baseScaleFor(1.8)).toBe(1)
    expect(baseScaleFor(FIT_MIN_HEIGHT)).toBe(1)
    expect(baseScaleFor(FIT_MAX_HEIGHT)).toBe(1)
  })
  it('rescues a centimetre export to the target height', () => {
    expect(baseScaleFor(180) * 180).toBeCloseTo(FIT_TARGET_HEIGHT)
  })
  it('rescues a millimetre-scale model upward', () => {
    expect(baseScaleFor(0.01) * 0.01).toBeCloseTo(FIT_TARGET_HEIGHT)
  })
  it('leaves an unmeasurable model alone', () => {
    expect(baseScaleFor(0)).toBe(1)
    expect(baseScaleFor(NaN)).toBe(1)
  })
})

describe('npcTransform', () => {
  it('uses y, rotationY (degrees → radians) and scale from the entry', () => {
    const t = npcTransform(1.8, { x: 1, y: 2, z: 3, rotationY: 90, scale: 2 })
    expect(t.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(t.rotationY).toBeCloseTo(Math.PI / 2)
    expect(t.scale).toBe(2)
    expect(t.baseScale).toBe(1)
  })

  it('defaults y to 0, rotation to 0 and scale to 1', () => {
    const t = npcTransform(1.8, { x: 4, z: 5 })
    expect(t.position).toEqual({ x: 4, y: 0, z: 5 })
    expect(t.rotationY).toBe(0)
    expect(t.scale).toBe(1)
  })

  it('does not ground: an authored y is kept exactly', () => {
    // Negative control for the "never snap to the floor" rule.
    expect(npcTransform(180, { x: 0, y: 1.25, z: 0 }).position.y).toBe(1.25)
  })

  it('composes fit-rescue with the entry scale', () => {
    const t = npcTransform(180, { x: 0, z: 0, scale: 2 })
    expect(t.baseScale).toBeCloseTo(FIT_TARGET_HEIGHT / 180)
    expect(t.scale).toBeCloseTo((FIT_TARGET_HEIGHT / 180) * 2)
    // The resulting model is twice the target height, not 360 m.
    expect(180 * t.scale).toBeCloseTo(FIT_TARGET_HEIGHT * 2)
  })

  it('a zero entry scale does not make the NPC vanish', () => {
    expect(npcTransform(1.8, { x: 0, z: 0, scale: 0 }).scale).toBe(1)
  })
})

describe('totalScale', () => {
  it('multiplies a known base by the entry scale, defaulting to 1', () => {
    expect(totalScale(0.5, 4)).toBe(2)
    expect(totalScale(0.5, undefined)).toBe(0.5)
  })
})
