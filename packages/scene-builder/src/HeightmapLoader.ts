import type { HeightmapFeature } from './SceneDescriptor'

export type ResolvePublicUrl = (url: string) => string

/**
 * Pre-decoded heightmap ready for fast per-vertex sampling.
 * All spatial config is resolved to concrete values so the sampler
 * does no conditional logic per sample call.
 */
export interface HeightmapData {
  width: number
  height: number
  /** Pixel brightness remapped to [-1, 1]. Mid-grey (128) = 0. */
  values: Float32Array
  amplitude: number
  /** Resolved world extents (terrain diameter by default). */
  worldWidth: number
  worldDepth: number
  /** Resolved centre offsets. */
  offsetX: number
  offsetZ: number
}

/**
 * Load a heightmap PNG, decode it to a normalised Float32Array, and attach
 * the resolved spatial config from the feature descriptor.
 *
 * @param feature         The HeightmapFeature from the SceneDescriptor.
 * @param terrainDiameter Fallback width/depth when the feature omits worldWidth/worldDepth.
 * @param resolvePublicUrl Resolves `/public` paths for non-root deployments (host-provided).
 */
export function loadHeightmap(
  feature: HeightmapFeature,
  terrainDiameter: number,
  resolvePublicUrl: ResolvePublicUrl,
): Promise<HeightmapData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height

      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) {
        reject(new Error('Canvas 2D unavailable'))
        return
      }

      ctx2d.drawImage(img, 0, 0)
      const { data } = ctx2d.getImageData(0, 0, img.width, img.height)

      const values = new Float32Array(img.width * img.height)
      for (let i = 0; i < values.length; i++) {
        const base = i * 4
        const brightness = (data[base]! + data[base + 1]! + data[base + 2]!) / (3 * 255)
        values[i] = brightness * 2 - 1
      }

      resolve({
        width: img.width,
        height: img.height,
        values,
        amplitude: feature.amplitude,
        worldWidth: feature.worldWidth ?? terrainDiameter,
        worldDepth: feature.worldDepth ?? terrainDiameter,
        offsetX: feature.offsetX ?? 0,
        offsetZ: feature.offsetZ ?? 0,
      })
    }

    const src = resolvePublicUrl(feature.url)
    img.onerror = () => reject(new Error(`HeightmapLoader: failed to load "${src}"`))
    img.src = src
  })
}

/**
 * Bilinear sample of a HeightmapData at world position (x, z).
 * Returns the displacement in world units (amplitude already applied).
 * Returns 0 when (x, z) falls outside the image's world footprint.
 */
export function sampleHeightmap(data: HeightmapData, x: number, z: number): number {
  const halfW = data.worldWidth * 0.5
  const halfD = data.worldDepth * 0.5

  const u = (x - data.offsetX + halfW) / data.worldWidth
  const v = (z - data.offsetZ + halfD) / data.worldDepth

  if (u < 0 || u > 1 || v < 0 || v > 1) return 0

  const { width, height, values } = data

  const px = u * (width - 1)
  const py = v * (height - 1)

  const x0 = Math.floor(px)
  const x1 = Math.min(x0 + 1, width - 1)
  const y0 = Math.floor(py)
  const y1 = Math.min(y0 + 1, height - 1)

  const tx = px - x0
  const ty = py - y0

  const v00 = values[y0 * width + x0]!
  const v10 = values[y0 * width + x1]!
  const v01 = values[y1 * width + x0]!
  const v11 = values[y1 * width + x1]!

  const sampled =
    v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty

  return sampled * data.amplitude
}
