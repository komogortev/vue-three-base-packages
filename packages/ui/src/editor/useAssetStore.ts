import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import * as THREE from 'three'

import { assetDb, type AssetRow, type AssetKind } from './assetDb'
import { createEditorGltfLoader } from './gltfLoaderFactory'
import { useLiveQuery } from './useLiveQuery'
import { generateThumbnail } from './thumbnailGenerator'

/**
 * @base/ui asset registry — Pinia setup-store.
 *
 * The store wraps `assetDb` with:
 *   - live-queried `assets` list (shallowRef → blobs survive structured-clone)
 *   - kind-inference + thumbnail generation at upload time (Q3 + Q4)
 *   - blob-URL resolver with revoke discipline (cache `Map<id, blobUrl>`)
 *
 * Contract: `SHARED/packages/ui/docs/ASSET-PIPELINE.md`.
 * Mirror of: `apps/personal-planner/src/stores/categories.ts`.
 */

export type UploadErrorKind =
  | 'invalid-file-type'
  | 'parse-failed'
  | 'thumbnail-failed'
  | 'dexie-write-failed'

export class UploadError extends Error {
  constructor(public readonly kind: UploadErrorKind, message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

const SUPPORTED_EXTS = ['glb', 'gltf', 'fbx', 'mp3', 'ogg', 'wav'] as const
type SupportedExt = (typeof SUPPORTED_EXTS)[number]

const MIME_FALLBACK: Record<string, string> = {
  fbx: 'application/octet-stream',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

function extOf(filename: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename)
  return m ? m[1]!.toLowerCase() : ''
}

function isSupported(ext: string): ext is SupportedExt {
  return (SUPPORTED_EXTS as readonly string[]).includes(ext)
}

export const useAssetStore = defineStore('assets', () => {
  // Live-queried list. shallowRef under the hood (see useLiveQuery).
  const assets = useLiveQuery<AssetRow[]>(
    () => assetDb.assets.orderBy('createdAt').reverse().toArray(),
    [],
  )

  // Session-scoped blob URL cache. Revoked on remove() + page unload.
  const blobUrlCache = new Map<string, string>()

  /**
   * Validate, infer kind, extract clip names + thumbnail, persist to Dexie.
   * Returns the new asset's logical ID. Throws `UploadError` on failure.
   */
  async function upload(file: File): Promise<string> {
    const ext = extOf(file.name)
    if (!isSupported(ext)) {
      throw new UploadError(
        'invalid-file-type',
        `Unsupported extension ".${ext}" — expected .glb, .gltf, .fbx, .mp3, .ogg, or .wav`,
      )
    }

    const blob = new Blob([await file.arrayBuffer()], {
      type: file.type || MIME_FALLBACK[ext] || '',
    })

    let kind: AssetKind = 'prop'
    let clipNames: string[] | undefined
    let contentType: string

    if (ext === 'glb' || ext === 'gltf') {
      contentType = ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'
      try {
        const buf = await blob.arrayBuffer()
        const loader = createEditorGltfLoader()
        const gltf = await loader.parseAsync(buf, '')
        if (!gltf.scene) {
          throw new Error('GLB has no scene')
        }
        // Kind inference heuristics (Q3 in ASSET-PIPELINE.md)
        let skinnedCount = 0
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh) skinnedCount++
        })
        const animCount = gltf.animations?.length ?? 0
        clipNames = animCount > 0 ? gltf.animations.map((a) => a.name) : undefined

        const box = new THREE.Box3().setFromObject(gltf.scene)
        const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3())
        const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z)

        // A skinned mesh is a character body even without embedded clips —
        // rigged-but-unanimated exports (e.g. three-dreams npc-*.glb) must not
        // fall through to 'prop' or the NPC character picker never lists them.
        // Tradeoff: skinning outranks size, so a large scene GLB containing any
        // SkinnedMesh classifies 'character' — platform environment exports
        // don't embed skinning, and the picker's kind filter is user-correctable.
        if (skinnedCount > 0) kind = 'character'
        else if (animCount > 0) kind = 'animation-pack'
        else if (diag > 20) kind = 'environment'
        else kind = 'prop'

        // Dispose parsed scene immediately — thumbnail generator re-parses.
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else if (mat) mat.dispose()
        })
      } catch (err) {
        throw new UploadError('parse-failed', (err as Error).message)
      }
    } else if (ext === 'mp3' || ext === 'ogg' || ext === 'wav') {
      contentType = MIME_FALLBACK[ext]!
      kind = 'audio'
    } else {
      // ext === 'fbx' — Mixamo convention; we don't parse FBX in browser.
      contentType = 'application/octet-stream'
      kind = 'animation-pack'
    }

    // Thumbnail is best-effort — failure stores the row without a thumbnail.
    let thumbnail: Blob | undefined
    if (ext === 'glb' || ext === 'gltf') {
      try {
        thumbnail = await generateThumbnail(blob)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useAssetStore] thumbnail generation failed:', err)
      }
    }

    const row: AssetRow = {
      id: `asset-${nanoid()}`,
      name: file.name,
      kind,
      size: blob.size,
      contentType,
      blob,
      clipNames,
      thumbnail,
      createdAt: new Date().toISOString(),
    }

    try {
      await assetDb.assets.add(row)
    } catch (err) {
      throw new UploadError('dexie-write-failed', (err as Error).message)
    }
    return row.id
  }

  function getById(id: string): AssetRow | undefined {
    return assets.value.find((a) => a.id === id)
  }

  /**
   * Cached blob-URL resolver. Returns null when the asset is missing OR when
   * the live-query hasn't populated yet — callers should treat null as "asset
   * unavailable" and render a placeholder.
   */
  function resolveBlobUrl(id: string): string | null {
    const cached = blobUrlCache.get(id)
    if (cached) return cached
    const row = assets.value.find((a) => a.id === id)
    if (!row) return null
    const url = URL.createObjectURL(row.blob)
    blobUrlCache.set(id, url)
    return url
  }

  async function remove(id: string): Promise<void> {
    const cached = blobUrlCache.get(id)
    if (cached) {
      URL.revokeObjectURL(cached)
      blobUrlCache.delete(id)
    }
    await assetDb.assets.delete(id)
  }

  return { assets, upload, getById, resolveBlobUrl, remove }
})
