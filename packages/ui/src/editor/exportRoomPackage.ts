import { nanoid } from 'nanoid'
import { strToU8, zipSync } from 'fflate'
import type { RoomPackageManifest, RoomPackageScene } from './roomPackageTypes'
import { assetDb } from './assetDb'

/**
 * Build a self-contained room package ZIP and trigger a browser download.
 *
 * ZIP layout:
 *   manifest.json           ← RoomPackageManifest
 *   scene.json              ← RoomPackageScene
 *   assets/<assetId>.<ext>  ← all referenced asset blobs (GLBs + audio)
 *
 * Collected asset IDs:
 *   - placedObjects[].assetId          (environment / prop GLBs)
 *   - npcs[].assetId                   (character mesh GLBs)
 *   - npcs[].animationPackAssetId      (animation pack GLBs)
 *   - ambientAudioAssetId              (audio file)
 *
 * Assets are stored at compression level 0 (store mode) — GLBs are already
 * deflate-compressed internally; audio is similarly pre-compressed.
 *
 * Missing assets are skipped with a warning so a partial scene still downloads.
 */
export async function exportRoomPackage(
  scene: RoomPackageScene,
  sceneLabel: string,
): Promise<void> {
  const files: Record<string, Uint8Array> = {}

  // Collect all unique asset IDs referenced in the scene.
  const assetIdSet = new Set<string>()
  for (const obj of scene.placedObjects) {
    assetIdSet.add(obj.assetId)
  }
  for (const npc of scene.npcs) {
    if (npc.assetId) assetIdSet.add(npc.assetId)
    if (npc.animationPackAssetId) assetIdSet.add(npc.animationPackAssetId)
  }
  if (scene.ambientAudioAssetId) assetIdSet.add(scene.ambientAudioAssetId)

  // Resolve each asset from Dexie and bundle it.
  for (const assetId of assetIdSet) {
    const row = await assetDb.assets.get(assetId)
    if (!row) {
      console.warn(`[exportRoomPackage] Asset ${assetId} not found in DB — omitting from ZIP`)
      continue
    }
    const ext = row.name.split('.').pop()?.trim() || 'bin'
    const buf = await row.blob.arrayBuffer()
    files[`assets/${assetId}.${ext}`] = new Uint8Array(buf)
  }

  const manifest: RoomPackageManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    packageId: `room-${nanoid(8)}`,
    sceneLabel,
  }

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['scene.json'] = strToU8(JSON.stringify(scene, null, 2))

  const zipped = zipSync(files, { level: 0 })
  // zipSync always returns a Uint8Array backed by a plain ArrayBuffer (not SharedArrayBuffer).
  // The cast is safe; the extra strictness comes from fflate's ArrayBufferLike generic param.
  // Pattern mirrors exportSandboxZip.ts.
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)

  const safeName = sceneLabel.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  const a = document.createElement('a')
  a.href = url
  a.download = `room-${safeName}-${manifest.exportedAt.slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
