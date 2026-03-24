/**
 * Minimal surface height query for grounding locomotion (terrain, nav mesh heightfield, etc.).
 */
export interface TerrainSurfaceSampler {
  sample(x: number, z: number): number
}
