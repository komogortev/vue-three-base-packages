/**
 * Scene description — the pure serializer behind `describe_scene` / `list_assets`
 * (Track P, PP-2). The output goes into a model prompt, so it is compact JSON with
 * a fixed key order and fixed precision: the same scene always gives the same bytes.
 *
 * **L0.** Plain values in, plain values out: no THREE, Vue or Dexie at runtime (the
 * asset types are imported as types only). The live values — transforms and world
 * bounds — are read by the caller (`readScene.ts`) and passed in.
 *
 * Conventions, stated once here and nowhere else:
 * - lengths in metres, angles in degrees;
 * - `pos` is the object's pivot, `[x, y, z]`;
 * - `yaw` is the turn about +Y in (−180, 180]; `tilt` `[x, z]` appears only when the
 *   object is also turned about X or Z (Euler order XYZ, as the editor stores it);
 * - `scale` is one number when uniform, else `[x, y, z]`;
 * - `bounds` is the world-space axis-aligned box `[[minX, minY, minZ], [maxX, maxY, maxZ]]`,
 *   `null` when it cannot be measured (model not loaded);
 * - `parent` appears only when the object carries an attachment (PP-3 authors them).
 *
 * Precision: positions to 1 cm (nearest); bounds to 1 cm **rounded outward** (min
 * down, max up), so a box never claims less room than the object takes; yaw / tilt
 * to 0.1°; scale to 0.001. Every value is first snapped to 1 µm, so float noise
 * (`0.07 * 100 = 7.000000000000001`) cannot tip an outward rounding by a whole step.
 */
import type { Aabb } from '../gate/verdict'
import type { AssetKind } from '../assetDb'
import type { EditorNpcEntry, EditorPlacedObject, EditorZoneEntry } from '../sceneEditorTypes'

export const DESCRIPTION_VERSION = 1

export type V3 = [number, number, number]
export type Bounds = [V3, V3]

/** Kind of a described object: the asset kind of a placed object, or NPC / zone. */
export type ObjectKind = AssetKind | 'missing-asset' | 'npc' | 'zone-exit' | 'zone-proximity'

/** One object. Keys appear in this order; optional ones only when set. */
export interface DescribedObject {
  id: string
  kind: ObjectKind
  label: string
  asset?: string
  pos: V3
  yaw?: number
  tilt?: [number, number]
  scale?: number | V3
  bounds?: Bounds | null
  parent?: string
  radius?: number
  target?: string
}

export interface SceneDescription {
  v: typeof DESCRIPTION_VERSION
  units: 'm,deg'
  objects: DescribedObject[]
  /** Player spawn `[x, z]`, when the scene has one. */
  spawn?: [number, number]
}

export interface DescribedAsset {
  id: string
  name: string
  kind: AssetKind
  /** The model's own bounds (pivot frame, scale 1, no turn). Absent for audio and animation packs; null when unmeasured. */
  bounds?: Bounds | null
  /** Animation clip names, when the asset has any. */
  clips?: string[]
}

export interface AssetCatalog {
  v: typeof DESCRIPTION_VERSION
  units: 'm'
  assets: DescribedAsset[]
}

// ─── Rounding ────────────────────────────────────────────────────────────────

/** -0 → 0, so `JSON.stringify` never sees a sign the scene does not have. */
const z0 = (n: number): number => (n === 0 ? 0 : n)
/** Value in `1/step` units, snapped to 1 µm-equivalent (1e-4 of a centimetre step). */
const snap = (v: number, perUnit: number): number => Math.round(v * perUnit * 1e4) / 1e4

/** Metres to the nearest centimetre. */
export const roundLen = (v: number): number => z0(Math.round(snap(v, 100)) / 100)
const floorLen = (v: number): number => z0(Math.floor(snap(v, 100)) / 100)
const ceilLen = (v: number): number => z0(Math.ceil(snap(v, 100)) / 100)
/** Scale to 0.001, so a tiny factor (0.004 on a centimetre-unit FBX) never reads as 0. */
const roundScale = (v: number): number => z0(Math.round(snap(v, 1000)) / 1000)

/** Degrees to 0.1°, wrapped into (−180, 180]. */
export function roundDeg(deg: number): number {
  let d = Math.round(snap(deg, 10)) / 10
  d = ((d % 360) + 360) % 360
  if (d > 180) d -= 360
  return z0(Math.round(d * 10) / 10)
}
const radToDeg = (r: number): number => roundDeg((r * 180) / Math.PI)

/** World AABB, rounded outward to 1 cm. */
export function roundBounds(b: Aabb | null | undefined): Bounds | null {
  if (!b) return null
  return [
    [floorLen(b.min.x), floorLen(b.min.y), floorLen(b.min.z)],
    [ceilLen(b.max.x), ceilLen(b.max.y), ceilLen(b.max.z)],
  ]
}

function scaleOf(x: number, y: number, z: number): number | V3 {
  const s: V3 = [roundScale(x), roundScale(y), roundScale(z)]
  return s[0] === s[1] && s[1] === s[2] ? s[0] : s
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export interface PlacedInput {
  /** The record with its **live** transform (the registry's `snapshot()`). */
  record: EditorPlacedObject
  /** Drawn world bounds (pick hit box excluded), or null when not measurable. */
  worldBounds: Aabb | null
}

export interface NpcInput {
  entry: EditorNpcEntry
  /** World bounds of the NPC's display model, or null when it has none loaded. */
  worldBounds: Aabb | null
}

export interface SceneDescriptionInput {
  /** In list order — the order the author built the scene in. */
  placed: readonly PlacedInput[]
  npcs?: readonly NpcInput[]
  zones?: readonly EditorZoneEntry[]
  spawn?: { x: number; z: number } | null
  /** Kind of an asset by id; undefined when the asset is not in the library. */
  assetKind: (assetId: string) => AssetKind | undefined
}

function describePlaced({ record: r, worldBounds }: PlacedInput, assetKind: SceneDescriptionInput['assetKind']): DescribedObject {
  const o: DescribedObject = {
    id: r.id,
    kind: assetKind(r.assetId) ?? 'missing-asset',
    label: r.label,
    asset: r.assetId,
    pos: [roundLen(r.x), roundLen(r.y), roundLen(r.z)],
    yaw: radToDeg(r.rotationY),
  }
  const tx = radToDeg(r.rotationX), tz = radToDeg(r.rotationZ)
  if (tx !== 0 || tz !== 0) o.tilt = [tx, tz]
  o.scale = scaleOf(r.scaleX, r.scaleY, r.scaleZ)
  o.bounds = roundBounds(worldBounds)
  if (r.attachment) o.parent = r.attachment.parentId
  return o
}

function describeNpc({ entry: n, worldBounds }: NpcInput): DescribedObject {
  const o: DescribedObject = {
    id: n.entityId,
    kind: 'npc',
    label: n.label ?? n.entityId,
    ...(n.assetId ? { asset: n.assetId } : {}),
    pos: [roundLen(n.x), roundLen(n.y ?? 0), roundLen(n.z)],
    // NPC rotation is authored in degrees already.
    yaw: roundDeg(n.rotationY ?? 0),
    scale: roundScale(n.scale ?? 1),
    bounds: roundBounds(worldBounds),
  }
  if (n.proximityRadius !== undefined) o.radius = roundLen(n.proximityRadius)
  return o
}

function describeZone(zn: EditorZoneEntry): DescribedObject {
  const o: DescribedObject = {
    id: zn.id,
    kind: zn.type === 'exit' ? 'zone-exit' : 'zone-proximity',
    label: zn.label ?? zn.id,
    pos: [roundLen(zn.x), 0, roundLen(zn.z)],
    radius: roundLen(zn.radius),
  }
  if (zn.targetSceneId) o.target = zn.targetSceneId
  return o
}

/**
 * Describe a scene: placed objects (list order), then NPCs, then zones (each in
 * their list order), then the spawn point.
 */
export function describeScene(input: SceneDescriptionInput): SceneDescription {
  const objects = [
    ...input.placed.map(p => describePlaced(p, input.assetKind)),
    ...(input.npcs ?? []).map(describeNpc),
    ...(input.zones ?? []).map(describeZone),
  ]
  const d: SceneDescription = { v: DESCRIPTION_VERSION, units: 'm,deg', objects }
  if (input.spawn) d.spawn = [roundLen(input.spawn.x), roundLen(input.spawn.z)]
  return d
}

// ─── Asset catalog ───────────────────────────────────────────────────────────

/** The asset fields the catalog reads (an `AssetRow` fits). */
export interface CatalogAssetInput {
  id: string
  name: string
  kind: AssetKind
  clipNames?: string[]
}

/**
 * The asset library, sorted by name then id. `boundsOf` gives each model's own
 * bounds (pivot frame); undefined / null means not measured.
 */
export function listAssets(
  assets: readonly CatalogAssetInput[],
  boundsOf: (id: string) => Aabb | null | undefined,
): AssetCatalog {
  const sorted = [...assets].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return {
    v: DESCRIPTION_VERSION,
    units: 'm',
    assets: sorted.map(a => {
      const o: DescribedAsset = { id: a.id, name: a.name, kind: a.kind }
      if (a.kind !== 'audio' && a.kind !== 'animation-pack') o.bounds = roundBounds(boundsOf(a.id))
      if (a.clipNames && a.clipNames.length > 0) o.clips = [...a.clipNames]
      return o
    }),
  }
}

/** The prompt form: JSON with no whitespace. Key order is the construction order above. */
export function toPromptJson(d: SceneDescription | AssetCatalog): string {
  return JSON.stringify(d)
}
