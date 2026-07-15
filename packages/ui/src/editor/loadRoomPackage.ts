import { unzipSync, strFromU8 } from 'fflate'
import type { RoomPackageManifest, RoomPackageScene } from './roomPackageTypes'
import { assetDb } from './assetDb'

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

/**
 * Build a LoadedRoomPackage directly from a saved scene in the Dexie database.
 * Used by the FPV environment menu to switch scenes without a ZIP file.
 *
 * Resolves all referenced asset blobs from assetDb and creates object URLs.
 * Call revoke() when the scene is torn down.
 *
 * @throws Error if the scene row is not found.
 */
export async function loadRoomFromDb(sceneId: string): Promise<LoadedRoomPackage> {
  const row = await assetDb.scenes.get(sceneId)
  if (!row) throw new Error(`[loadRoomFromDb] Scene "${sceneId}" not found in DB`)

  const scene: RoomPackageScene = {
    placedObjects: row.placedObjects ?? [],
    npcs: row.config?.npcs ?? [],
    zones: row.config?.zones ?? [],
    spawnPoint: row.config?.spawnPoint,
    ambientAudioAssetId: row.config?.ambientAudioAssetId,
    ambientAudioVolume: row.config?.ambientAudioVolume,
  }

  const assetIdSet = new Set<string>()
  for (const obj of scene.placedObjects) assetIdSet.add(obj.assetId)
  for (const npc of scene.npcs) {
    if (npc.assetId) assetIdSet.add(npc.assetId)
    // animationPackAssetId is consumed by the room player (S5-c): RoomPlayerModule
    // creates a mixer per NPC and loops npc.defaultClip from this pack blob.
    if (npc.animationPackAssetId) assetIdSet.add(npc.animationPackAssetId)
  }
  if (scene.ambientAudioAssetId) assetIdSet.add(scene.ambientAudioAssetId)

  const assetBlobUrls = new Map<string, string>()
  for (const assetId of assetIdSet) {
    const assetRow = await assetDb.assets.get(assetId)
    if (!assetRow) {
      console.warn(`[loadRoomFromDb] Asset ${assetId} not found — skipping`)
      continue
    }
    const ext = assetRow.name.split('.').pop()?.trim() ?? 'bin'
    const mime =
      ext === 'glb'  ? 'model/gltf-binary'
      : ext === 'mp3' ? 'audio/mpeg'
      : ext === 'ogg' ? 'audio/ogg'
      : ext === 'wav' ? 'audio/wav'
      : 'application/octet-stream'
    assetBlobUrls.set(assetId, URL.createObjectURL(new Blob([await assetRow.blob.arrayBuffer()], { type: mime })))
  }

  const manifest: RoomPackageManifest = {
    version: 1,
    exportedAt: row.savedAt,
    packageId: row.id,
    sceneLabel: row.name,
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
