/**
 * Mulberry32 — a fast, high-quality 32-bit seeded pseudo-random number generator.
 *
 * Returns a factory function. Each call to the returned function advances the
 * internal state and yields one float in [0, 1).
 *
 * Same seed always produces the same sequence, making scatter layouts
 * fully deterministic across reloads.
 *
 * @example
 * const rng = createSeeder(42)
 * rng() // → 0.something, always the same for seed 42
 * rng() // → next value in sequence
 */
export function createSeeder(seed: number): () => number {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
