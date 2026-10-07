import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useEditorCommands, type CommandViewport } from '../commands/useEditorCommands'
import type { EditorNpcEntry, EditorPlacedObject, EditorZoneEntry } from '../sceneEditorTypes'
import type { PlacedHandle } from '../useSceneEditorViewport'

function placedObj(id: string): EditorPlacedObject {
  return { id, assetId: 'a', label: id, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }
}

/**
 * A viewport holding placed objects by id. Detach returns a fresh handle object each
 * time (like the real one), so "the same handle disposed twice" is observable.
 */
function fakeViewport(ids: string[]) {
  const inScene = new Map(ids.map(id => [id, placedObj(id)]))
  const disposed: string[] = []
  const vp: CommandViewport = {
    addNpcMarker: vi.fn(), removeNpcMarker: vi.fn(), setNpcPosition: vi.fn(),
    addZoneMarker: vi.fn(), removeZoneMarker: vi.fn(), setZonePosition: vi.fn(),
    getPlacedTransform: () => null,
    setPlacedTransform: vi.fn(),
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
    disposePlacedHandle(h) { if (!inScene.has(h.id)) disposed.push(h.id) },
    discardPoseGesture: vi.fn(),
  }
  return { vp, inScene, disposed }
}

function setup(ids: string[]) {
  const npcs = ref<EditorNpcEntry[]>([])
  const zones = ref<EditorZoneEntry[]>([])
  const editor = useEditorCommands({ npcs, zones })
  const fake = fakeViewport(ids)
  editor.bindViewport(fake.vp)
  return { editor, npcs, zones, ...fake }
}

describe('useEditorCommands — parked placed objects', () => {
  it('a removed object is parked, not disposed, while undo can bring it back', async () => {
    const { editor, inScene, disposed } = setup(['p'])
    await editor.removePlaced('p')
    expect(inScene.has('p')).toBe(false)
    expect(disposed).toEqual([])
    await editor.undo()
    expect(inScene.has('p')).toBe(true)
    expect(disposed).toEqual([])
  })

  it('is disposed exactly once when a new edit discards the redo that could restore it', async () => {
    const { editor, disposed } = setup(['p'])
    await editor.removePlaced('p')
    await editor.undo()           // back in the scene
    await editor.redo()           // removed again: parked, its entry on the undo side
    expect(disposed).toEqual([])
    await editor.undo()           // back; the remove entry now sits on the redo side
    await editor.addZone({ id: 'z', type: 'proximity', x: 0, z: 0, radius: 1 }) // truncates it
    expect(disposed).toEqual([])  // it is in the scene: not ours to dispose
  })

  it('negative control: delete, undo, delete again, truncate — the live handle survives', async () => {
    const { editor, inScene, disposed } = setup(['p'])
    await editor.removePlaced('p')  // entry A
    await editor.undo()             // A → redo side, p back
    await editor.removePlaced('p')  // entry B truncates A; p parked under B
    expect(inScene.has('p')).toBe(false)
    expect(disposed).toEqual([])    // A's drop must not dispose the handle B still names
    await editor.undo()             // B brings it back
    expect(inScene.has('p')).toBe(true)
  })

  it('disposed when its removal is evicted from the bottom of the history', async () => {
    const { editor, disposed, npcs } = setup(['p'])
    await editor.removePlaced('p')
    // The default limit is 100 steps; push the removal off the bottom.
    for (let i = 0; i < 100; i++) {
      await editor.addNpc({ entityId: `n${i}`, x: 0, z: 0 })
    }
    expect(npcs.value.length).toBe(100)
    expect(disposed).toEqual(['p'])
  })

  it('not disposed while an older step still names it (only a newer one was dropped)', async () => {
    const { editor, disposed } = setup(['p', 'q'])
    await editor.removePlaced('p')
    await editor.removePlaced('q')
    await editor.undo()             // q back; its removal on the redo side
    await editor.addZone({ id: 'z', type: 'proximity', x: 0, z: 0, radius: 1 }) // drops q's removal
    expect(disposed).toEqual([])    // p's removal is still undoable
  })

  it('clear() disposes every parked object', async () => {
    const { editor, disposed } = setup(['p', 'q'])
    await editor.removePlaced('p')
    await editor.removePlaced('q')
    editor.clear()
    expect([...disposed].sort()).toEqual(['p', 'q'])
    expect(editor.commands.canUndo.value).toBe(false)
  })

  it('a reattach refused (id taken) keeps the handle parked, so clear() still disposes it', async () => {
    const { editor, inScene, disposed } = setup(['p'])
    await editor.removePlaced('p')
    inScene.set('p', placedObj('p')) // something else took the id
    await editor.undo()
    inScene.delete('p')
    editor.clear()
    expect(disposed).toEqual(['p'])
  })
})

describe('useEditorCommands — pose gesture ordering', () => {
  it('recording, undo and redo each discard a pending bone / IK slot', async () => {
    const { editor, vp } = setup([])
    await editor.addNpc({ entityId: 'n', x: 0, z: 0 })
    expect(vp.discardPoseGesture).toHaveBeenCalledTimes(1)
    await editor.undo()
    expect(vp.discardPoseGesture).toHaveBeenCalledTimes(2)
    await editor.redo()
    expect(vp.discardPoseGesture).toHaveBeenCalledTimes(3)
  })
})
