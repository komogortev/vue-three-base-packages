import { nanoid } from 'nanoid'
import { unzipSync, strFromU8 } from 'fflate'
import type { RoomPackageAssetMeta, RoomPackageManifest, RoomPackageScene } from './roomPackageTypes'
import { assetDb, type AssetKind, type AssetRow, type SceneRow } from './assetDb'

/** One asset file found in a package, before it touches the database. */
export interface ParsedPackageAsset {
  id: string
  /** Filename to store — from the `assets.json` sidecar, else `<id>.<ext>`. */
  name: string
  kind: AssetKind
  contentType: string
  clipNames?: string[]
  bytes: Uint8Array
}

export interface ParsedRoomPackage {
  manifest: RoomPackageManifest
  scene: RoomPackageScene
  assets: ParsedPackageAsset[]
  /** Asset ids the scene references that the ZIP did not contain. */
  missingAssetIds: string[]
}

export interface ImportRoomPackageResult {
  sceneId: string
  /** Final scene name (suffixed when it collided with an existing row). */
  sceneName: string
  assetsAdded: number
  /** Ids already present in the library — kept as-is, never overwritten. */
  assetsReused: number
  missingAssetIds: string[]
}

const MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

/**
 * How each referenced asset is used in the scene. Packages written before the
 * `assets.json` sidecar carry no `kind`, so usage is the only signal left.
 * An NPC body wins over a placed object when one id is used both ways.
 */
function inferKinds(scene: RoomPackageScene): Map<string, AssetKind> {
  const kinds = new Map<string, AssetKind>()
  for (const o of scene.placedObjects ?? []) if (o.assetId) kinds.set(o.assetId, 'prop')
  for (const n of scene.npcs ?? []) {
    if (n.assetId) kinds.set(n.assetId, 'character')
    if (n.animationPackAssetId) kinds.set(n.animationPackAssetId, 'animation-pack')
  }
  if (scene.ambientAudioAssetId) kinds.set(scene.ambientAudioAssetId, 'audio')
  return kinds
}

function parseJsonFile<T>(raw: Uint8Array, label: string): T {
  try {
    return JSON.parse(strFromU8(raw)) as T
  } catch {
    throw new Error(`Not a scene package: ${label} is not valid JSON`)
  }
}

/**
 * Pure half of the import: unzip and validate, no database access.
 *
 * @throws Error when manifest.json / scene.json is absent or the manifest
 *   version is not 1 (a future format must not be half-read as v1).
 */
export function parseRoomPackage(zipBytes: Uint8Array): ParsedRoomPackage {
  let files: ReturnType<typeof unzipSync>
  try {
    files = unzipSync(zipBytes)
  } catch {
    throw new Error('Not a scene package: the file is not a readable ZIP')
  }
  const manifestRaw = files['manifest.json']
  const sceneRaw = files['scene.json']
  if (!manifestRaw || !sceneRaw) {
    throw new Error('Not a scene package: manifest.json or scene.json is missing')
  }

  const manifest = parseJsonFile<RoomPackageManifest>(manifestRaw, 'manifest.json')
  const scene = parseJsonFile<RoomPackageScene>(sceneRaw, 'scene.json')
  if (!manifest || typeof manifest !== 'object' || !scene || typeof scene !== 'object') {
    throw new Error('Not a scene package: manifest.json or scene.json is empty')
  }
  if (manifest.version !== 1) {
    throw new Error(`Unsupported scene package version: ${String(manifest.version)}`)
  }

  const metaRaw = files['assets.json']
  // The sidecar is optional: a corrupt one degrades to kind inference, never aborts.
  let meta: Record<string, RoomPackageAssetMeta> = {}
  if (metaRaw) {
    try { meta = parseJsonFile<Record<string, RoomPackageAssetMeta>>(metaRaw, 'assets.json') ?? {} } catch { /* inference */ }
  }
  const inferred = inferKinds(scene)

  const assets: ParsedPackageAsset[] = []
  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith('assets/')) continue
    const basename = path.slice('assets/'.length)
    const dot = basename.lastIndexOf('.')
    if (dot < 0) continue
    const id = basename.slice(0, dot)
    const ext = basename.slice(dot + 1).toLowerCase()
    const m = meta[id]
    assets.push({
      id,
      name: m?.name ?? basename,
      kind: m?.kind ?? inferred.get(id) ?? 'prop',
      contentType: MIME[ext] ?? 'application/octet-stream',
      clipNames: m?.clipNames,
      // Copy: unzipSync returns sub-views with a non-zero byteOffset.
      bytes: new Uint8Array(data),
    })
  }

  const present = new Set(assets.map(a => a.id))
  const missingAssetIds = [...inferred.keys()].filter(id => !present.has(id))

  return { manifest, scene, assets, missingAssetIds }
}

/** `Name`, else `Name (imported)`, `Name (imported 2)`, … — never overwrites. */
export function uniqueSceneName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 1
  for (;;) {
    const candidate = n === 1 ? `${base} (imported)` : `${base} (imported ${n})`
    if (!taken.has(candidate)) return candidate
    n++
  }
}

/** Build the row an imported package becomes. Pure. */
export function buildImportedSceneRow(
  parsed: ParsedRoomPackage,
  id: string,
  name: string,
  savedAt: string,
): SceneRow {
  const { scene } = parsed
  return {
    id,
    name,
    savedAt,
    placedObjects: scene.placedObjects ?? [],
    config: {
      npcs: scene.npcs ?? [],
      zones: scene.zones ?? [],
      spawnPoint: scene.spawnPoint,
      ambientAudioAssetId: scene.ambientAudioAssetId,
      ambientAudioVolume: scene.ambientAudioVolume,
    },
  }
}

/**
 * Import a scene package into the local library so it can be edited.
 *
 * - Assets whose id already exists are kept untouched (ids are random per
 *   upload, so a match means the same file from this library's own export).
 * - The scene is always inserted as a NEW row; a name clash gets a suffix.
 *   Import never overwrites a saved scene.
 * - Asset rows from a package without an `assets.json` sidecar have no
 *   thumbnail and no `clipNames`; kind is inferred from how the scene uses it.
 * - Waypoints are not part of the package format (they live in localStorage),
 *   so an imported scene arrives without paths.
 *
 * Writes run in one transaction: a failure leaves neither orphan assets nor a
 * scene row pointing at nothing.
 */
export async function importRoomPackageToDb(zipBytes: Uint8Array): Promise<ImportRoomPackageResult> {
  const parsed = parseRoomPackage(zipBytes)
  const now = new Date().toISOString()

  return assetDb.transaction('rw', assetDb.assets, assetDb.scenes, async () => {
    let assetsAdded = 0
    let assetsReused = 0
    for (const a of parsed.assets) {
      if (await assetDb.assets.get(a.id)) {
        assetsReused++
        continue
      }
      const row: AssetRow = {
        id: a.id,
        name: a.name,
        kind: a.kind,
        size: a.bytes.byteLength,
        contentType: a.contentType,
        blob: new Blob([a.bytes as BlobPart], { type: a.contentType }),
        clipNames: a.clipNames,
        createdAt: now,
      }
      await assetDb.assets.add(row)
      assetsAdded++
    }

    const names = new Set((await assetDb.scenes.toArray()).map(s => s.name))
    const sceneName = uniqueSceneName(parsed.manifest.sceneLabel || 'Imported Scene', names)
    const sceneId = `saved-${nanoid(8)}`
    await assetDb.scenes.add(buildImportedSceneRow(parsed, sceneId, sceneName, now))

    return { sceneId, sceneName, assetsAdded, assetsReused, missingAssetIds: parsed.missingAssetIds }
  })
}
