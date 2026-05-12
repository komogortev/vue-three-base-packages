import { describe, it, expect } from 'vitest'
import { TerrainSampler } from './TerrainSampler'
import type { HillFeature, LakeFeature, RiverFeature } from './SceneDescriptor'

// Numerical tolerance for floating-point comparisons
const CLOSE = 4

describe('TerrainSampler', () => {
  describe('empty (no features)', () => {
    it('returns 0 everywhere', () => {
      const sampler = new TerrainSampler()
      expect(sampler.sample(0, 0)).toBe(0)
      expect(sampler.sample(100, -50)).toBe(0)
    })
  })

  // ─── Hill ──────────────────────────────────────────────────────────────────

  describe('hill feature', () => {
    const hill: HillFeature = { type: 'hill', x: 0, z: 0, radius: 10, height: 5 }

    it('returns peak height at hill centre', () => {
      const s = new TerrainSampler([hill])
      expect(s.sample(0, 0)).toBeCloseTo(5, CLOSE)
    })

    it('returns less than peak away from centre', () => {
      const s = new TerrainSampler([hill])
      expect(s.sample(5, 0)).toBeLessThan(5)
      expect(s.sample(5, 0)).toBeGreaterThan(0)
    })

    it('decays to ~1% of peak at 2× radius', () => {
      // Gaussian: exp(-dist²/r²) at dist=2r → exp(-4) ≈ 0.018
      const s = new TerrainSampler([hill])
      const y = s.sample(20, 0)
      expect(y).toBeLessThan(5 * 0.02)
      expect(y).toBeGreaterThan(0)
    })

    it('two hills at different positions add together at midpoint', () => {
      const hill2: HillFeature = { type: 'hill', x: 20, z: 0, radius: 10, height: 5 }
      const s = new TerrainSampler([hill, hill2])
      const atHill1 = s.sample(0, 0)
      const atHill2 = s.sample(20, 0)
      const mid = s.sample(10, 0)
      // Mid should be lower than peaks but higher than flat baseline
      expect(mid).toBeGreaterThan(0)
      expect(mid).toBeLessThan(atHill1 + atHill2)
    })

    it('is non-negative everywhere for a positive hill', () => {
      const s = new TerrainSampler([hill])
      for (const x of [-30, -10, 0, 10, 30]) {
        for (const z of [-30, 0, 30]) {
          expect(s.sample(x, z)).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })

  // ─── Lake ──────────────────────────────────────────────────────────────────

  describe('lake feature', () => {
    const lake: LakeFeature = { type: 'lake', x: 0, z: 0, radius: 15, depth: 8 }

    it('returns -depth at lake centre', () => {
      const s = new TerrainSampler([lake])
      // cosine bowl: at dist=0, t=0 → -(depth * (cos(0)+1)/2) = -depth
      expect(s.sample(0, 0)).toBeCloseTo(-8, CLOSE)
    })

    it('returns 0 at the lake rim (dist === radius)', () => {
      const s = new TerrainSampler([lake])
      expect(s.sample(15, 0)).toBeCloseTo(0, CLOSE)
      expect(s.sample(0, 15)).toBeCloseTo(0, CLOSE)
    })

    it('returns 0 outside the lake radius', () => {
      const s = new TerrainSampler([lake])
      expect(s.sample(20, 0)).toBeCloseTo(0, CLOSE)
    })

    it('transitions smoothly — midpoint is between 0 and -depth', () => {
      const s = new TerrainSampler([lake])
      const mid = s.sample(7.5, 0)
      expect(mid).toBeLessThan(0)
      expect(mid).toBeGreaterThan(-8)
    })
  })

  // ─── Hill + Lake interaction ────────────────────────────────────────────────

  describe('hill + lake', () => {
    it('hill raises lake floor above pure-lake depth', () => {
      const hill: HillFeature = { type: 'hill', x: 0, z: 0, radius: 20, height: 3 }
      const lake: LakeFeature = { type: 'lake', x: 0, z: 0, radius: 15, depth: 8 }
      const s = new TerrainSampler([hill, lake])
      // hill adds 3 at centre, lake subtracts 8 → net -5
      expect(s.sample(0, 0)).toBeCloseTo(-5, CLOSE)
    })
  })

  // ─── River ─────────────────────────────────────────────────────────────────

  describe('river feature (2D path)', () => {
    const river: RiverFeature = {
      type: 'river',
      path: [[-50, 0], [50, 0]],  // straight line along x-axis at z=0
      width: 10,
      depth: 3,
    }

    it('lowers terrain at the river centreline', () => {
      const s = new TerrainSampler([river])
      const y = s.sample(0, 0)
      // Baseline is 0; river floor = 0 - 3 = -3; at centreline shape=1 → y=-3
      expect(y).toBeCloseTo(-3, 1)
    })

    it('does not affect terrain outside the river width', () => {
      const s = new TerrainSampler([river])
      // dist=6 > halfWidth=5 → no carve
      expect(s.sample(0, 6)).toBeCloseTo(0, CLOSE)
    })

    it('blends back to baseline at the river bank (dist = halfWidth)', () => {
      const s = new TerrainSampler([river])
      // At exactly halfWidth the cosine shape=0, so carved = floor + (0 - floor)*1 = 0
      expect(s.sample(0, 5)).toBeCloseTo(0, CLOSE)
    })

    it('never raises terrain above baseline (min constraint)', () => {
      const s = new TerrainSampler([river])
      for (const z of [-6, -5, -3, 0, 3, 5, 6]) {
        expect(s.sample(0, z)).toBeLessThanOrEqual(0 + 1e-9)
      }
    })
  })

  describe('river feature (3D explicit path)', () => {
    it('uses explicit y for floor when path point is 3D', () => {
      const river: RiverFeature = {
        type: 'river',
        path: [[-10, -5, 0], [10, -5, 0]],  // 3D: x=−10, y=−5, z=0
        width: 6,
        depth: 2,
      }
      const s = new TerrainSampler([river])
      // Floor = explicit y=-5; at centreline shape=1 → carved=-5
      expect(s.sample(0, 0)).toBeCloseTo(-5, 1)
    })
  })
})
