import { describe, it, expect } from 'vitest'
import { sampleHeightmap } from './HeightmapLoader'
import type { HeightmapData } from './HeightmapLoader'

/**
 * Build a synthetic HeightmapData without loading any image.
 * values[] are normalised brightness remapped to [-1, 1]:
 *   mid-grey (128/255) → 0, white → +1, black → -1
 */
function makeHeightmap(
  width: number,
  height: number,
  fill: number | ((x: number, y: number) => number),
  opts: Partial<Omit<HeightmapData, 'width' | 'height' | 'values'>> = {},
): HeightmapData {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = typeof fill === 'function' ? fill(x, y) : fill
    }
  }
  return {
    width,
    height,
    values,
    amplitude: opts.amplitude ?? 1,
    worldWidth: opts.worldWidth ?? 100,
    worldDepth: opts.worldDepth ?? 100,
    offsetX: opts.offsetX ?? 0,
    offsetZ: opts.offsetZ ?? 0,
  }
}

describe('sampleHeightmap', () => {
  describe('out-of-bounds', () => {
    it('returns 0 when x is left of image footprint', () => {
      const hm = makeHeightmap(4, 4, 1)
      expect(sampleHeightmap(hm, -60, 0)).toBe(0)
    })

    it('returns 0 when x is right of image footprint', () => {
      const hm = makeHeightmap(4, 4, 1)
      expect(sampleHeightmap(hm, 60, 0)).toBe(0)
    })

    it('returns 0 when z is above image footprint', () => {
      const hm = makeHeightmap(4, 4, 1)
      expect(sampleHeightmap(hm, 0, -60)).toBe(0)
    })

    it('returns 0 when z is below image footprint', () => {
      const hm = makeHeightmap(4, 4, 1)
      expect(sampleHeightmap(hm, 0, 60)).toBe(0)
    })
  })

  describe('uniform fill', () => {
    it('returns amplitude for all-white image (value = 1)', () => {
      const hm = makeHeightmap(4, 4, 1, { amplitude: 10 })
      expect(sampleHeightmap(hm, 0, 0)).toBeCloseTo(10)
    })

    it('returns -amplitude for all-black image (value = -1)', () => {
      const hm = makeHeightmap(4, 4, -1, { amplitude: 5 })
      expect(sampleHeightmap(hm, 0, 0)).toBeCloseTo(-5)
    })

    it('returns 0 for mid-grey image (value = 0)', () => {
      const hm = makeHeightmap(4, 4, 0, { amplitude: 10 })
      expect(sampleHeightmap(hm, 0, 0)).toBeCloseTo(0)
    })
  })

  describe('bilinear interpolation', () => {
    it('returns exact pixel value at pixel centre (no interpolation)', () => {
      // 2×2 grid: TL=1, TR=0, BL=0, BR=0
      const hm = makeHeightmap(2, 2, 0, { amplitude: 1 })
      hm.values[0] = 1 // top-left pixel
      // Centre of top-left pixel: u=0, v=0
      expect(sampleHeightmap(hm, -50, -50)).toBeCloseTo(1)
    })

    it('interpolates halfway between two pixels', () => {
      // 2×1 grid (width=2, height=1): left=0, right=1
      const hm = makeHeightmap(2, 1, 0, { amplitude: 1 })
      hm.values[1] = 1 // right pixel
      // Midpoint between left and right pixels
      const mid = sampleHeightmap(hm, 0, 0)
      expect(mid).toBeCloseTo(0.5, 5)
    })

    it('scales by amplitude', () => {
      const hm = makeHeightmap(2, 2, 1, { amplitude: 7 })
      expect(sampleHeightmap(hm, 0, 0)).toBeCloseTo(7)
    })
  })

  describe('offsetX / offsetZ', () => {
    it('shifts footprint by offset so world-space origin is at image centre', () => {
      // Offset the image 20 units right; world x=20 should be at the image centre
      const hm = makeHeightmap(4, 4, 1, { amplitude: 3, offsetX: 20, offsetZ: 0 })
      expect(sampleHeightmap(hm, 20, 0)).toBeCloseTo(3)
      // World x=0 is now 20 units left of image centre → left edge; inside at ~u=0.3
      // Just ensure it's non-zero (still inside)
      expect(sampleHeightmap(hm, 0, 0)).toBeCloseTo(3) // all-ones image
    })
  })
})
