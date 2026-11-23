import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useEditorCommands, type CommandViewport } from '../commands/useEditorCommands'
import { applyPose, createEditorApi, installEditorApi, EDITOR_API_GLOBAL, type EditorApiDeps } from '../debug/editorApi'
import { IDENTITY_PLACED_TRANSFORM, makePlacedObject, transformOf, type PlacedTransform } from '../placement/placedObjectModel'
import type { AssetRow } from '../assetDb'
import type { EditorNpcEntry, EditorPlacedObject, EditorZoneEntry } from '../sceneEditorTypes'
import type { PlacedHandle } from '../useSceneEditorViewport'

describe('applyPose', () => {
  it('writes metres and degrees over a transform, leaving omitted fields alone', () => {
    const t = applyPose(IDENTITY_PLACED_TRANSFORM, { pos: [1, 0, -2], yaw: 90 })
    expect(t.position).toEqual({ x: 1, y: 0, z: -2 })
    expect(t.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(t.scale).toEqual({ x: 1, y: 1, z: 1 })
    const s = applyPose(t, { scale: 2 })
    expect(s.position).toEqual(t.position)
    expect(s.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(s.scale).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('does not mutate its input', () => {
    const t: PlacedTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    applyPose(t, { pos: [5, 5, 5], yaw: 10, scale: 3 })
    expect(t).toEqual(IDENTITY_PLACED_TRANSFORM)
  })
})

/** Editor commands bound to an in-memory viewport, plus the API over them. */
function setup() {
  const inScene = new Map<string, EditorPlacedObject>()
  const vp: CommandViewport = {
    addNpcMarker: vi.fn(), removeNpcMarker: vi.fn(), setNpcPosition: vi.fn(),
    addZoneMarker: vi.fn(), removeZoneMarker: vi.fn(), setZonePosition: vi.fn(),
    getPlacedTransform: id => { const o = inScene.get(id); return o ? transformOf(o) : null },
    setPlacedTransform: (id, t) => {
      const o = inScene.get(id)
      if (o) inScene.set(id, makePlacedObject(o, t))
    },
    snapshotPlacedTransforms: () => [...inScene.values()],
    detachPlacedObject(id) {
      const record = inScene.get(id)
      if (!record) return null
      inScene.delete(id)
      return { id, record } satisfies PlacedHandle
    },
    reattachPlacedObject(h) {
      if (inScene.has(h.id)) return false
      inScene.set(h.id, h.record)
      return true
    },
    disposePlacedHandle: vi.fn(),
    discardPoseGesture: vi.fn(),
  }
  const npcs = ref<EditorNpcEntry[]>([])
  const zones = ref<EditorZoneEntry[]>([])
  const commands = useEditorCommands({ npcs, zones })
  commands.bindViewport(vp)
  const assets = [
    { id: 'asset-table', name: 'table.glb', kind: 'prop', size: 1 },
    { id: 'wall-a', name: 'wall.glb', kind: 'prop', size: 1 },
    { id: 'wall-b', name: 'wall.glb', kind: 'prop', size: 1 },
  ] as AssetRow[]
  const save = vi.fn(async () => 'saved-1')
  const api = createEditorApi({
    commands,
    sources: () => ({ placed: { snapshot: () => [...inScene.values()], visibleWorldBounds: () => null }, assetKind: () => 'prop' }),
    assets: () => assets,
    resolveBlobUrl: id => (id === 'asset-table' ? 'blob:table' : null),
    // The real viewport adds the object, then reports it through onPlaced.
    async placeAsset(objectId, assetId, _url, label, t) {
      const record = makePlacedObject({ id: objectId, assetId, label }, t)
      inScene.set(objectId, record)
      commands.viewportOptions.onPlaced(record)
      return true
    },
    getPlacedTransform: vp.getPlacedTransform,
    boundsCache: { get: () => undefined, measureAll: async () => {}, clear: () => {} },
    save,
  })
  return { api, inScene, save }
}

describe('createEditorApi', () => {
  it('place by name → one undo step; undo removes it, redo restores it at the same pose', async () => {
    const { api, inScene } = setup()
    const id = await api.place('table.glb', { pos: [1, 0, 2], yaw: 90 })
    expect(api.history().undo).toBe('Add object')
    expect(inScene.get(id)?.x).toBe(1)
    await api.undo()
    expect(inScene.has(id)).toBe(false)
    await api.redo()
    expect(inScene.get(id)?.rotationY).toBeCloseTo(Math.PI / 2)
  })

  it('move goes through the history: undo puts it back', async () => {
    const { api, inScene } = setup()
    const id = await api.place('asset-table', { pos: [0, 0, 0] })
    await api.move(id, { pos: [3, 0, 0] })
    expect(inScene.get(id)?.x).toBe(3)
    expect(api.history().undo).toBe('Move object')
    await api.undo()
    expect(inScene.get(id)?.x).toBe(0)
  })

  it('describeScene reads the live placement', async () => {
    const { api } = setup()
    await api.place('table.glb', { pos: [1.234, 0, 0] })
    const d = api.describeScene()
    expect(d.objects).toHaveLength(1)
    expect(d.objects[0].pos).toEqual([1.23, 0, 0])
  })

  it('negative control: an unknown asset throws and records nothing', async () => {
    const { api, inScene } = setup()
    await expect(api.place('sofa.glb')).rejects.toThrow('No asset')
    expect(inScene.size).toBe(0)
    expect(api.history().undo).toBeNull()
  })

  it('save passes the name through', async () => {
    const { api, save } = setup()
    expect(await api.save('Cosy room')).toBe('saved-1')
    expect(save).toHaveBeenCalledWith('Cosy room')
  })
})

describe('createEditorApi — failures are loud', () => {
  it('an ambiguous asset name throws; its id works', async () => {
    const { api, inScene } = setup()
    await expect(api.place('wall.glb')).rejects.toThrow('ambiguous')
    expect(inScene.size).toBe(0)
    // resolveBlobUrl knows only the table, so the id resolves but has no blob.
    await expect(api.place('wall-b')).rejects.toThrow('no loadable blob')
  })

  it('unknown ids throw instead of doing nothing', async () => {
    const { api } = setup()
    await expect(api.remove('placed-nope')).rejects.toThrow('No placed object')
    await expect(api.patchNpc('n', { x: 1 })).rejects.toThrow('No NPC')
    await expect(api.removeZone('z')).rejects.toThrow('No zone')
  })
})

describe('installEditorApi — the ?editordebug gate', () => {
  const deps = {} as EditorApiDeps
  // Node test environment: a minimal window with just the URL the gate reads.
  let w: Record<string, unknown>
  function at(search: string): void {
    w = { location: { search } }
    vi.stubGlobal('window', w)
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('negative control: without ?editordebug nothing is published', () => {
    at('')
    installEditorApi(deps)
    expect(w[EDITOR_API_GLOBAL]).toBeUndefined()
    at('?debug')
    installEditorApi(deps)
    expect(w[EDITOR_API_GLOBAL]).toBeUndefined()
  })

  it('with ?editordebug it publishes, and uninstall removes only its own API', () => {
    at('?editordebug')
    const first = installEditorApi(deps)
    const firstApi = w[EDITOR_API_GLOBAL]
    expect(firstApi).toBeDefined()
    const second = installEditorApi(deps)
    first()   // a stale instance's uninstall leaves the newer API alone
    expect(w[EDITOR_API_GLOBAL]).toBeDefined()
    expect(w[EDITOR_API_GLOBAL]).not.toBe(firstApi)
    second()
    expect(w[EDITOR_API_GLOBAL]).toBeUndefined()
  })
})
