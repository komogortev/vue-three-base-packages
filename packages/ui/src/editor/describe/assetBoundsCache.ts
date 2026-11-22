/**
 * Asset bounds cache — each model asset's own bounds, for `listAssets` (PP-2).
 *
 * **L1.** Owns one slice of state (the measured-bounds map) and the transient THREE
 * objects a measurement loads, which it disposes at once. Takes its loader at
 * construction, so it is testable without WebGL, and imports no other L1 module.
 *
 * The bounds are the GLB's own: its scene's box in the pivot frame, at scale 1 with no
 * turn — what a placement at the origin would occupy. Nothing else stores them: an
 * `AssetRow` has no bounds field, and the placed registry measures only what is placed.
 *
 * Keyed by id **and** size, so an animation pack that `appendToPack` grew (same id,
 * new blob) is measured again; a slower measurement of an older blob never overwrites
 * a newer one, and `clear()` discards measurements still loading. Audio and animation
 * packs are never loaded (a pack's value is its clips, not its mesh); at most
 * {@link MEASURE_CONCURRENCY} GLBs load at once. A load failure is cached as null
 * (unmeasured) rather than retried on every listing.
 */
import * as THREE from 'three'
import type { Aabb } from '../gate/verdict'
import type { AssetKind } from '../assetDb'

/** GLBs parsed at the same time during one listing. */
export const MEASURE_CONCURRENCY = 4

/** The asset fields a measurement needs (an `AssetRow` fits). */
export interface MeasurableAsset {
  id: string
  kind: AssetKind
  size: number
  blob?: Blob
}

export interface AssetBoundsCacheOptions {
  /** Load and parse a GLB. */
  loadGltf: (url: string) => Promise<{ scene: THREE.Object3D }>
  /** URL to load an asset from. Default: an object URL over its blob, revoked after the load. */
  urlFor?: (asset: MeasurableAsset) => string
}

export interface AssetBoundsCache {
  /** Bounds measured so far: undefined = not measured yet, null = could not be measured. */
  get(id: string): Aabb | null | undefined
  /** Measure every model asset not yet measured at its current size. Never rejects. */
  measureAll(assets: readonly MeasurableAsset[]): Promise<void>
  /** Forget everything. */
  clear(): void
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!m) continue
      // Free decoded images too: a measurement never renders, so nothing else will.
      for (const v of Object.values(m)) {
        if (v instanceof THREE.Texture) v.dispose()
      }
      m.dispose()
    }
  })
}

export function createAssetBoundsCache(opts: AssetBoundsCacheOptions): AssetBoundsCache {
  const measured = new Map<string, { size: number; bounds: Aabb | null }>()
  /** In-flight measurements, so two listings never load the same asset twice. */
  const pending = new Map<string, Promise<void>>()
  /** Newest size asked for per id: an older blob's result must not land over it. */
  const wanted = new Map<string, number>()
  /** Bumped by `clear()`; a measurement started under an older value is dropped. */
  let generation = 0

  async function measure(asset: MeasurableAsset): Promise<void> {
    const gen = generation
    let url: string | null = null
    let revoke = false
    let bounds: Aabb | null = null
    try {
      if (opts.urlFor) url = opts.urlFor(asset)
      else if (asset.blob) { url = URL.createObjectURL(asset.blob); revoke = true }
      if (url) {
        const { scene } = await opts.loadGltf(url)
        scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(scene)
        if (!box.isEmpty()) {
          bounds = { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } }
        }
        disposeTree(scene)
      }
    } catch (e) {
      console.warn('[assetBoundsCache] could not measure', asset.id, e)
    } finally {
      if (revoke && url) URL.revokeObjectURL(url)
    }
    if (gen !== generation || wanted.get(asset.id) !== asset.size) return
    measured.set(asset.id, { size: asset.size, bounds })
  }

  /** Run `jobs` with at most `n` in flight. */
  async function limited(jobs: (() => Promise<void>)[], n: number): Promise<void> {
    let next = 0
    const lane = async () => { while (next < jobs.length) await jobs[next++]() }
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, lane))
  }

  return {
    get: id => measured.get(id)?.bounds,
    async measureAll(assets) {
      const jobs: (() => Promise<void>)[] = []
      for (const a of assets) {
        if (a.kind === 'audio' || a.kind === 'animation-pack') continue
        if (measured.get(a.id)?.size === a.size) continue
        wanted.set(a.id, a.size)
        const key = `${a.id}:${a.size}`
        jobs.push(() => {
          let job = pending.get(key)
          if (!job) {
            // Delete only its own entry: after a clear() a newer job may hold the key.
            const own: Promise<void> = measure(a).finally(() => {
              if (pending.get(key) === own) pending.delete(key)
            })
            job = own
            pending.set(key, own)
          }
          return job
        })
      }
      await limited(jobs, MEASURE_CONCURRENCY)
    },
    clear() {
      generation++
      measured.clear()
      wanted.clear()
      pending.clear()
    },
  }
}
