import * as THREE from 'three'
import type { TerrainSurfaceSampler } from '@base/player-three'
import type { TerrainFeature, HillFeature, LakeFeature, RiverFeature, PathPoint } from './SceneDescriptor'
import { type HeightmapData, sampleHeightmap } from './HeightmapLoader'

interface RiverCache {
  /** 200 evenly-spaced points pre-sampled from the CatmullRom curve. */
  points: THREE.Vector3[]
  feature: RiverFeature
}

/**
 * TerrainSampler — the mathematical heart of the terrain system.
 *
 * Builds the heightmap function from a list of TerrainFeatures and exposes
 * it as `sample(x, z) → worldY`. The same function is used:
 *   1. At build time: to displace every vertex in the terrain mesh.
 *   2. At runtime:    to snap the character's Y to the terrain surface.
 *
 * --- Feature math ---
 *
 * Hill:   Gaussian bump      h·exp(−dist²/r²)
 *         Decays to ~1% of peak at dist = 2r.  No hard edge.
 *
 * Lake:   Cosine bowl        −depth·(cos(t·π)+1)/2   where t = dist/radius
 *         Reaches exactly 0 at the rim (t=1). Perfectly seamless.
 *
 * River:  CatmullRom channel carved along a spline.
 *         Cross-section is also cosine. Two path modes:
 *           2D [x,z]     → floor Y = baseTerrainAt(x,z) − depth  (surface river)
 *           3D [x,y,z]   → floor Y = explicit world height        (dive/ocean)
 *         `Math.min` ensures rivers only ever lower the terrain, never raise it.
 *
 * --- Two-pass sampling ---
 *
 * Rivers depend on the "base terrain" (hills + lakes) at their path points
 * to compute floor Y for 2D path segments. So the constructor first resolves
 * all hills and lakes, then pre-bakes river curves with correct floor Y values.
 * At runtime, `sample()` replicates this two-pass logic cheaply.
 */
export class TerrainSampler implements TerrainSurfaceSampler {
  private readonly hills: HillFeature[] = []
  private readonly lakes: LakeFeature[] = []
  private readonly rivers: RiverCache[] = []
  private readonly heightmaps: HeightmapData[] = []

  /**
   * @param features    TerrainFeature array from the descriptor (HeightmapFeature
   *                    entries are ignored here — pass pre-loaded data instead).
   * @param heightmaps  Pre-loaded HeightmapData objects from HeightmapLoader.
   *                    SceneBuilder resolves these before constructing the sampler.
   */
  constructor(features: TerrainFeature[] = [], heightmaps: HeightmapData[] = []) {
    this.heightmaps = heightmaps

    // Pass 1 — collect non-river features first (rivers depend on them)
    for (const f of features) {
      if (f.type === 'hill') this.hills.push(f)
      else if (f.type === 'lake') this.lakes.push(f)
    }

    // Pass 2 — pre-bake river curves with floor Y resolved
    for (const f of features) {
      if (f.type === 'river') this.buildRiverCache(f)
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns the world Y at (x, z).
   * Call for each terrain vertex during mesh build, and each frame for character Y.
   */
  sample(x: number, z: number): number {
    const baseY = this.sampleBase(x, z)
    return this.applyRivers(x, z, baseY)
  }

  // ─── Hill + lake (base terrain) ───────────────────────────────────────────────

  private sampleBase(x: number, z: number): number {
    let y = 0
    for (const hm of this.heightmaps) y += sampleHeightmap(hm, x, z)
    for (const h  of this.hills)      y += this.sampleHill(h, x, z)
    for (const l  of this.lakes)      y += this.sampleLake(l, x, z)
    return y
  }

  private sampleHill(f: HillFeature, x: number, z: number): number {
    const dx = x - f.x
    const dz = z - f.z
    return f.height * Math.exp(-(dx * dx + dz * dz) / (f.radius * f.radius))
  }

  private sampleLake(f: LakeFeature, x: number, z: number): number {
    const dx = x - f.x
    const dz = z - f.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist >= f.radius) return 0
    const t = dist / f.radius
    return -f.depth * (Math.cos(t * Math.PI) + 1) * 0.5
  }

  // ─── River caching ───────────────────────────────────────────────────────────

  private buildRiverCache(f: RiverFeature): void {
    const controlPoints = f.path.map((p) => this.resolvePathPoint(p, f.depth))
    const curve = new THREE.CatmullRomCurve3(controlPoints)
    this.rivers.push({ points: curve.getPoints(200), feature: f })
  }

  /**
   * Convert a PathPoint to a THREE.Vector3 with a resolved floor Y.
   *
   * 2D [x, z]     → floor Y = baseTerrainAt(x, z) − depth
   * 3D [x, y, z]  → floor Y = y  (explicit — no depth subtracted; y IS the floor)
   */
  private resolvePathPoint(p: PathPoint, depth: number): THREE.Vector3 {
    if (p.length === 3) {
      return new THREE.Vector3(p[0], p[1], p[2])
    }
    // 2D: floor sits `depth` below the base terrain at this XZ location
    const floorY = this.sampleBase(p[0], p[1]) - depth
    return new THREE.Vector3(p[0], floorY, p[1])
  }

  // ─── River application ────────────────────────────────────────────────────────

  private applyRivers(x: number, z: number, baseY: number): number {
    let y = baseY
    for (const cache of this.rivers) {
      y = this.applyRiver(cache, x, z, y)
    }
    return y
  }

  /**
   * Carve a single river channel into `currentY`.
   *
   * At centreline (dist=0):  Y snaps to river floor (closest.y)
   * At bank edge (dist=w/2): Y blends back to currentY seamlessly
   * Cosine cross-section:    smooth natural banks, no hard walls
   *
   * `Math.min` guarantees the river only ever lowers terrain — it cannot
   * raise a lake floor or create an underwater mountain.
   */
  private applyRiver(cache: RiverCache, x: number, z: number, currentY: number): number {
    const closest = this.closestPoint(cache.points, x, z)
    const dx = x - closest.x
    const dz = z - closest.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const halfWidth = cache.feature.width * 0.5

    if (dist >= halfWidth) return currentY

    const t = dist / halfWidth
    const shape = (Math.cos(t * Math.PI) + 1) * 0.5  // 1 at centre, 0 at bank

    // Blend: channel floor at centre, smoothly rising to currentY at bank
    const floor = closest.y
    const carved = floor + (currentY - floor) * (1 - shape)

    // min: river carves down only, never raises terrain
    return Math.min(currentY, carved)
  }

  // ─── Closest point on cached curve ───────────────────────────────────────────

  /**
   * Linear scan of pre-baked curve points.
   * 200 points gives sub-unit precision for typical scene scales.
   * Uses squared distance to avoid sqrt in the hot loop.
   */
  private closestPoint(points: THREE.Vector3[], x: number, z: number): THREE.Vector3 {
    let minSq = Infinity
    let best = points[0]
    for (const pt of points) {
      const dx = x - pt.x
      const dz = z - pt.z
      const sq = dx * dx + dz * dz
      if (sq < minSq) { minSq = sq; best = pt }
    }
    return best
  }
}
