import { strToU8, zipSync } from 'fflate'
import type { SandboxSceneSave } from './sandboxSceneSchema'
import { assetDb } from './assetDb'

/**
 * Build a ZIP artifact from a SandboxSceneSave and trigger a browser download.
 *
 * ZIP layout:
 *   manifest.json          ← SandboxSceneSave (same schema as localStorage payload)
 *   assets/<assetId>.<ext> ← one entry per unique assetId referenced in placedObjects
 *
 * Assets are stored at compression level 0 (store mode) because GLBs are already
 * deflate-compressed internally. Deduplicates identical assetIds automatically.
 *
 * Throws if any critical step fails (blob read, ZIP build). Individual missing
 * assets are skipped with a console warning so a partial scene still downloads.
 */
export async function exportSandboxZip(save: SandboxSceneSave): Promise<void> {
  const files: Record<string, Uint8Array> = {}

  // Deduplicate — multiple placed objects may share the same source asset.
  const uniqueAssetIds = [...new Set(save.placedObjects.map(o => o.assetId))]

  for (const assetId of uniqueAssetIds) {
    const row = await assetDb.assets.get(assetId)
    if (!row) {
      console.warn(`[exportSandboxZip] Asset ${assetId} not found in DB — omitting from ZIP`)
      continue
    }
    // Derive extension from the stored filename (e.g. 'rock.glb' → 'glb').
    const ext = row.name.includes('.') ? row.name.split('.').pop()! : 'glb'
    const buf = await row.blob.arrayBuffer()
    files[`assets/${assetId}.${ext}`] = new Uint8Array(buf)
  }

  files['manifest.json'] = strToU8(JSON.stringify(save, null, 2))

  // level: 0 = store (no compression) — correct for GLBs which are pre-compressed.
  const zipped = zipSync(files, { level: 0 })
  // zipSync always returns a Uint8Array backed by a plain ArrayBuffer (not SharedArrayBuffer).
  // The cast is safe; the extra strictness comes from fflate's ArrayBufferLike generic param.
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `sandbox-scene-${save.savedAt.slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
