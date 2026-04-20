import { describe, it, expect } from 'vitest'
import { createSeeder } from './Seeder'

describe('createSeeder', () => {
  it('always produces the same first value for a given seed', () => {
    const a = createSeeder(42)
    const b = createSeeder(42)
    expect(a()).toBe(b())
  })

  it('produces the same full sequence for identical seeds', () => {
    const seqA = Array.from({ length: 10 }, createSeeder(99))
    const seqB = Array.from({ length: 10 }, createSeeder(99))
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = createSeeder(1)
    const b = createSeeder(2)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).not.toEqual(seqB)
  })

  it('every value is in [0, 1)', () => {
    const rng = createSeeder(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('advances state — consecutive calls yield different values', () => {
    const rng = createSeeder(123)
    const v1 = rng()
    const v2 = rng()
    expect(v1).not.toBe(v2)
  })

  it('seed 0 is valid and deterministic', () => {
    const a = createSeeder(0)
    const b = createSeeder(0)
    expect(a()).toBe(b())
  })

  it('non-integer seed is truncated to uint32 (deterministic)', () => {
    // 3.7 >>> 0 = 3; seeder(3.7) must equal seeder(3)
    const a = createSeeder(3.7)
    const b = createSeeder(3)
    expect(a()).toBe(b())
  })
})
