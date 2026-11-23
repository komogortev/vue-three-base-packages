/**
 * `window.__editorApi` — the scene editor driven from a console (opt-in, `?editordebug`).
 *
 * A stand-in for the prompt panel's tools (Track P, PP-5) so a Claude session in a
 * browser pane can build a scene from prompts today: read the scene and the library
 * (PP-2), place / move / remove objects, NPCs and zones through the PP-1 history (so
 * Ctrl+Z undoes every call), and save. No model call, no key: the agent driving the
 * page is the prompt loop.
 *
 * Units follow the scene description (`describe/sceneDescription.ts`): metres and
 * degrees, `pos` = `[x, y, z]` pivot, `yaw` about +Y. Await every call: writes are
 * serialized through the history, and a call that names an id looks it up when it
 * starts. Unknown ids and ambiguous asset names throw rather than do nothing.
 *
 * L2 glue: holds nothing but the bounds cache, imports no THREE; the host injects
 * everything. Kept out of `useSceneEditorViewport` (over its structural budget).
 */
import { nanoid } from 'nanoid'
import type { AssetRow } from '../assetDb'
import type { EditorCommands } from '../commands/useEditorCommands'
import type { NpcFields, ZoneFields } from '../commands/sceneCommand'
import type { PlacedTransform } from '../placement/placedObjectModel'
import { IDENTITY_PLACED_TRANSFORM } from '../placement/placedObjectModel'
import type { EditorNpcEntry, EditorZoneEntry } from '../sceneEditorTypes'
import type { AssetBoundsCache } from '../describe/assetBoundsCache'
import { describeAssets, readSceneDescription, type SceneSources } from '../describe/readScene'
import type { AssetCatalog, SceneDescription, V3 } from '../describe/sceneDescription'

export const EDITOR_API_GLOBAL = '__editorApi'

/** A placement or move, in description units. Omitted fields keep their value (identity on place). */
export interface PoseInput {
  pos?: V3
  /** Degrees about +Y. */
  yaw?: number
  /** Uniform scale. */
  scale?: number
}

export interface EditorApiDeps {
  commands: EditorCommands
  sources: () => SceneSources
  assets: () => readonly AssetRow[]
  resolveBlobUrl: (assetId: string) => string | null
  placeAsset: (objectId: string, assetId: string, blobUrl: string, label: string, t: PlacedTransform) => Promise<boolean>
  getPlacedTransform: (objectId: string) => PlacedTransform | null
  boundsCache: AssetBoundsCache
  /** Set the toolbar name (when given) and save; resolves the saved row id, null on failure. */
  save: (name?: string) => Promise<string | null>
}

const DEG = Math.PI / 180

/** `t` with the fields of `p` written over it (degrees → radians). Pure. */
export function applyPose(t: PlacedTransform, p: PoseInput): PlacedTransform {
  const out: PlacedTransform = {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  }
  if (p.pos) out.position = { x: p.pos[0], y: p.pos[1], z: p.pos[2] }
  if (p.yaw !== undefined) out.rotation.y = p.yaw * DEG
  if (p.scale !== undefined) out.scale = { x: p.scale, y: p.scale, z: p.scale }
  return out
}

export function createEditorApi(d: EditorApiDeps) {
  const findAsset = (ref: string): AssetRow | undefined => {
    const all = d.assets()
    const byId = all.find(a => a.id === ref)
    if (byId) return byId
    const named = all.filter(a => a.name === ref)
    if (named.length > 1) throw new Error(`Asset name "${ref}" is ambiguous (${named.map(a => a.id).join(', ')}); use an id`)
    return named[0]
  }
  const needPlaced = (id: string): void => {
    if (!d.getPlacedTransform(id)) throw new Error(`No placed object "${id}"`)
  }
  const needNpc = (id: string): void => {
    if (!d.sources().npcs?.some(n => n.entityId === id)) throw new Error(`No NPC "${id}"`)
  }
  const needZone = (id: string): void => {
    if (!d.sources().zones?.some(z => z.id === id)) throw new Error(`No zone "${id}"`)
  }

  return {
    /** The scene as it is now (PP-2 description). */
    describeScene: (): SceneDescription => readSceneDescription(d.sources()),
    /** The library with each model's own bounds (measures what is not measured yet). */
    listAssets: (): Promise<AssetCatalog> => describeAssets(d.assets(), d.boundsCache),

    /** Place an asset (by id or exact name). Resolves the new object's id. One undo step. */
    async place(assetRef: string, pose: PoseInput = {}, label?: string): Promise<string> {
      const asset = findAsset(assetRef)
      if (!asset) throw new Error(`No asset "${assetRef}"`)
      const url = d.resolveBlobUrl(asset.id)
      if (!url) throw new Error(`Asset "${asset.name}" has no loadable blob`)
      const id = `placed-${nanoid(6)}`
      const ok = await d.placeAsset(id, asset.id, url, label ?? asset.name, applyPose(IDENTITY_PLACED_TRANSFORM, pose))
      if (!ok) throw new Error('Placement overtaken by a scene switch')
      // The viewport reported it through onPlaced, which queued the record; later
      // commands and undo are serialized behind it.
      return id
    },
    /** Move / turn / scale a placed object. One undo step. */
    async move(objectId: string, pose: PoseInput): Promise<void> {
      const from = d.getPlacedTransform(objectId)
      if (!from) throw new Error(`No placed object "${objectId}"`)
      await d.commands.commands.execute(
        [{ kind: 'placed.transform', objectId, from, to: applyPose(from, pose) }], 'Move object')
    },
    async remove(objectId: string): Promise<void> { needPlaced(objectId); await d.commands.removePlaced(objectId) },

    addNpc: (npc: EditorNpcEntry) => d.commands.addNpc(npc),
    async patchNpc(entityId: string, patch: NpcFields): Promise<void> { needNpc(entityId); await d.commands.patchNpc(entityId, patch) },
    async removeNpc(entityId: string): Promise<void> { needNpc(entityId); await d.commands.removeNpc(entityId) },
    addZone: (zone: EditorZoneEntry) => d.commands.addZone(zone),
    async patchZone(id: string, patch: ZoneFields): Promise<void> { needZone(id); await d.commands.patchZone(id, patch) },
    async removeZone(id: string): Promise<void> { needZone(id); await d.commands.removeZone(id) },

    undo: () => d.commands.undo(),
    redo: () => d.commands.redo(),
    /** Labels of the steps Undo / Redo would take next. */
    history: () => ({ undo: d.commands.commands.undoLabel.value, redo: d.commands.commands.redoLabel.value }),

    save: (name?: string) => d.save(name),
  }
}

export type EditorApi = ReturnType<typeof createEditorApi>

/** Publish the API on `window` when the page URL has `?editordebug`. Returns the removal. */
export function installEditorApi(d: EditorApiDeps): () => void {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('editordebug')) {
    return () => {}
  }
  const w = window as unknown as Record<string, unknown>
  const api = createEditorApi(d)
  w[EDITOR_API_GLOBAL] = api
  return () => { if (w[EDITOR_API_GLOBAL] === api) delete w[EDITOR_API_GLOBAL] }
}
