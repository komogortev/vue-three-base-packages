/**
 * Clip names of a GLB, read from its JSON chunk — no GLTFLoader, no WebGL.
 *
 * Why this exists: `AssetRow.clipNames` drives the Anim tab's "Load existing clip" and
 * the Asset tab's clip list. Normal uploads fill it by parsing the whole file with
 * GLTFLoader, but an asset that arrives any other way (a scene package imported without
 * an `assets.json` sidecar, or a row imported by an older build) had none, so its clips
 * were invisible in the editor even though they were in the file. Reading just the
 * JSON chunk is enough and is cheap.
 *
 * GLB layout: 12-byte header (magic 'glTF', version, total length), then chunks of
 * (length u32, type u32, data); the first chunk is the JSON.
 */

const GLB_MAGIC = 0x46546c67 // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a // 'JSON' little-endian
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

/** Clip names in a GLB's bytes, or `null` when it is not a readable GLB. `[]` = no animations. */
export function glbAnimationNames(bytes: Uint8Array): string[] | null {
  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC) return null
  const jsonLength = dv.getUint32(HEADER_BYTES, true)
  if (dv.getUint32(HEADER_BYTES + 4, true) !== CHUNK_JSON) return null
  const start = HEADER_BYTES + CHUNK_HEADER_BYTES
  if (start + jsonLength > bytes.byteLength) return null
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + jsonLength))) as {
      animations?: Array<{ name?: string }>
    }
    // Same naming as three's GLTFLoader, so a name read here matches the loaded clip's.
    return (json.animations ?? []).map((a, i) => a.name || `animation_${i}`)
  } catch {
    return null
  }
}

/** Blob variant: reads only the header and the JSON chunk, not the (large) binary payload. */
export async function readGlbAnimationNames(blob: Blob): Promise<string[] | null> {
  const head = new Uint8Array(await blob.slice(0, HEADER_BYTES + CHUNK_HEADER_BYTES).arrayBuffer())
  if (head.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) return null
  const jsonLength = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(HEADER_BYTES, true)
  const end = HEADER_BYTES + CHUNK_HEADER_BYTES + jsonLength
  return glbAnimationNames(new Uint8Array(await blob.slice(0, end).arrayBuffer()))
}

export interface BackfillRow {
  id: string
  kind: string
  clipNames?: string[]
  blob: Blob
}

/**
 * Fill `clipNames` on animation packs that lack them. Idempotent: rows that already
 * have names, rows of other kinds, and files with no animations are left alone, and a
 * row that cannot be read is skipped (logged), never fatal. Returns how many were updated.
 */
export async function backfillClipNames(
  rows: readonly BackfillRow[],
  update: (id: string, clipNames: string[]) => Promise<void>,
): Promise<number> {
  let updated = 0
  for (const row of rows) {
    if (row.kind !== 'animation-pack' || row.clipNames !== undefined) continue
    try {
      const names = await readGlbAnimationNames(row.blob)
      if (names && names.length > 0) {
        await update(row.id, names)
        updated++
      }
    } catch (e) {
      console.warn(`[backfillClipNames] could not read ${row.id}:`, e)
    }
  }
  return updated
}
