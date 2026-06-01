import { unzipSync, strFromU8 } from 'fflate'
import type { RoomPackageManifest, RoomPackageScene } from './roomPackageTypes'

export interface LoadedRoomPackage {
  manifest: RoomPackageManifest
  scene: RoomPackageScene
  /**
   * Map from assetId to a blob URL ready for GLTFLoader / fetch.
   * Keys match the assetId fields in placedObjects, npcs, and ambientAudioAssetId.
   * Call revoke() when the scene is torn down.
   */
  assetBlobUrls: Map<string, string>
  /** Release all object URLs created during load. */
  revoke(): void
}

/**
 * Unzip a room package and return typed manifest + scene + asset blob URLs.
 *
 * ZIP layout (mirrors exportRoomPackage output):
 *   manifest.json           ← RoomPackageManifest
 *   scene.json              ← RoomPackageScene
 *   assets/<assetId>.<ext>  ← GLBs + audio blobs
 *
 * All files are fully in memory after unzipSync — no streaming.
 * Blob URLs are created immediately and held until revoke() is called.
 *
 * @throws Error if manifest.json or scene.json is absent.
 */
export function loadRoomPackage(zipBytes: Uint8Array): LoadedRoomPackage {
  const files = unzipSync(zipBytes)

  const manifestRaw = files['manifest.json']
  const sceneRaw = files['scene.json']
  if (!manifestRaw || !sceneRaw) {
    throw new Error('[loadRoomPackage] ZIP is missing manifest.json or scene.json')
  }

  const manifest = JSON.parse(strFromU8(manifestRaw)) as RoomPackageManifest
  const scene = JSON.parse(strFromU8(sceneRaw)) as RoomPackageScene

  const assetBlobUrls = new Map<string, string>()
  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith('assets/')) continue
    const basename = path.slice(7) // strip "assets/"
    const dot = basename.lastIndexOf('.')
    if (dot < 0) continue
    const assetId = basename.slice(0, dot)
    const ext = basename.slice(dot + 1).toLowerCase()
    const mime =
      ext === 'glb' ? 'model/gltf-binary'
      : ext === 'mp3' ? 'audio/mpeg'
      : ext === 'ogg' ? 'audio/ogg'
      : ext === 'wav' ? 'audio/wav'
      : 'application/octet-stream'
    // Copy into a fresh Uint8Array — two reasons:
    // 1. TypeScript: fflate types Uint8Array<ArrayBufferLike>, rejected as BlobPart.
    // 2. Correctness: unzipSync returns sub-views with non-zero byteOffset for stored
    //    entries; new Uint8Array(data) copies only the asset bytes into a fresh buffer.
    assetBlobUrls.set(assetId, URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mime })))
  }

  return {
    manifest,
    scene,
    assetBlobUrls,
    revoke() {
      for (const url of assetBlobUrls.values()) URL.revokeObjectURL(url)
    },
  }
}
