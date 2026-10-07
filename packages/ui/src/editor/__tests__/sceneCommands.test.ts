import { describe, it, expect, vi } from 'vitest'
import { reactive } from 'vue'
import {
  clonePlain, describeCommands, invertAll, invertCommand, isNoopCommand, placedIdsOf, plainEqual,
  splitPatch, type SceneCommand,
} from '../commands/sceneCommand'
import { EditorHistory } from '../commands/editorHistory'
import { useSceneCommands, type SceneCommandTarget } from '../commands/useSceneCommands'
import type { EditorNpcEntry, EditorPlacedObject, EditorZoneEntry } from '../sceneEditorTypes'
import { transformOf, type PlacedTransform } from '../placement/placedObjectModel'

// ─── A fake scene: the same list semantics the editor host applies ─────────────

interface FakeScene {
  npcs: EditorNpcEntry[]
  zones: EditorZoneEntry[]
  placed: Map<string, EditorPlacedObject>
  transforms: Map<string, PlacedTransform>
}

const T = (x: number, ry = 0, s = 1): PlacedTransform => ({
  position: { x, y: 0, z: 0 }, rotation: { x: 0, y: ry, z: 0 }, scale: { x: s, y: s, z: s },
})

function placedObj(id: string): EditorPlacedObject {
  return { id, assetId: 'a', label: id, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }
}

function fakeTarget(scene: FakeScene): SceneCommandTarget {
  return {
    apply(c: SceneCommand) {
      switch (c.kind) {
        case 'npc.add': scene.npcs.splice(c.index, 0, clonePlain(c.npc)); break
        case 'npc.remove': scene.npcs = scene.npcs.filter(n => n.entityId !== c.npc.entityId); break
        case 'npc.patch': Object.assign(scene.npcs.find(n => n.entityId === c.entityId)!, clonePlain(c.to)); break
        case 'zone.add': scene.zones.splice(c.index, 0, clonePlain(c.zone)); break
        case 'zone.remove': scene.zones = scene.zones.filter(z => z.id !== c.zone.id); break
        case 'zone.patch': Object.assign(scene.zones.find(z => z.id === c.id)!, clonePlain(c.to)); break
        case 'placed.add': scene.placed.set(c.object.id, c.object); scene.transforms.set(c.object.id, transformOf(c.object)); break
        case 'placed.remove': scene.placed.delete(c.object.id); scene.transforms.delete(c.object.id); break
        case 'placed.transform': scene.transforms.set(c.objectId, clonePlain(c.to)); break
      }
    },
  }
}

function emptyScene(): FakeScene {
  return { npcs: [], zones: [], placed: new Map(), transforms: new Map() }
}

/** Plain snapshot for equality (Maps → sorted arrays). */
function snap(s: FakeScene) {
  return clonePlain({
    npcs: s.npcs, zones: s.zones,
    placed: [...s.placed.keys()].sort(),
    transforms: [...s.transforms.entries()].sort(([a], [b]) => a.localeCompare(b)),
  })
}

// ─── Kernel ───────────────────────────────────────────────────────────────────

describe('sceneCommand kernel', () => {
  it('inverting twice gives the command back, for every kind', () => {
    const cmds: SceneCommand[] = [
      { kind: 'npc.add', npc: { entityId: 'n', x: 1, z: 2 }, index: 0 },
      { kind: 'npc.remove', npc: { entityId: 'n', x: 1, z: 2 }, index: 3 },
      { kind: 'npc.patch', entityId: 'n', from: { x: 1 }, to: { x: 2 } },
      { kind: 'zone.add', zone: { id: 'z', type: 'proximity', x: 0, z: 0, radius: 3 }, index: 0 },
      { kind: 'zone.patch', id: 'z', from: { radius: 3 }, to: { radius: 5 } },
      { kind: 'zone.remove', zone: { id: 'z', type: 'exit', x: 1, z: 1, radius: 2 }, index: 2 },
      { kind: 'placed.add', object: placedObj('p') },
      { kind: 'placed.remove', object: placedObj('p') },
      { kind: 'placed.transform', objectId: 'p', from: T(0), to: T(4) },
    ]
    for (const c of cmds) expect(invertCommand(invertCommand(c))).toEqual(c)
  })

  it('invertAll reverses the order', () => {
    const a: SceneCommand = { kind: 'npc.patch', entityId: 'n', from: { x: 0 }, to: { x: 1 } }
    const b: SceneCommand = { kind: 'npc.patch', entityId: 'n', from: { x: 1 }, to: { x: 2 } }
    expect(invertAll([a, b])).toEqual([invertCommand(b), invertCommand(a)])
  })

  it('splitPatch keeps prior values, drops unchanged keys, and copies', () => {
    const pose = [{ bone: 'Hips', q: [0, 0, 0, 1] as [number, number, number, number] }]
    const npc: EditorNpcEntry = { entityId: 'n', x: 1, z: 2, poseOverride: pose }
    const { from, to } = splitPatch(npc, { x: 1, z: 5, poseOverride: undefined })
    expect(from).toEqual({ z: 2, poseOverride: pose })
    expect(to).toEqual({ z: 5, poseOverride: undefined })
    pose[0].q[3] = 0 // mutating the entry later must not rewrite the command
    expect(from.poseOverride![0].q[3]).toBe(1)
  })

  it('splitPatch copies through a Vue reactive proxy (structuredClone would throw)', () => {
    const npc = reactive<EditorNpcEntry>({ entityId: 'n', x: 0, z: 0, poseOverride: [{ bone: 'B', q: [0, 0, 0, 1] }] })
    const { from } = splitPatch(npc, { poseOverride: undefined })
    expect(() => structuredClone(from)).not.toThrow()
  })

  it('no-op detection: empty patch and an unmoved transform', () => {
    expect(isNoopCommand({ kind: 'npc.patch', entityId: 'n', from: {}, to: {} })).toBe(true)
    expect(isNoopCommand({ kind: 'placed.transform', objectId: 'p', from: T(1), to: T(1 + 1e-9) })).toBe(true)
    expect(isNoopCommand({ kind: 'placed.transform', objectId: 'p', from: T(1), to: T(1.01) })).toBe(false)
    expect(isNoopCommand({ kind: 'placed.remove', object: placedObj('p') })).toBe(false)
  })

  it('plainEqual treats an undefined key as absent', () => {
    expect(plainEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(plainEqual([1, [2]], [1, [2]])).toBe(true)
    expect(plainEqual([1, [2]], [1, [3]])).toBe(false)
  })

  it('labels and placed-id extraction', () => {
    expect(describeCommands([{ kind: 'placed.transform', objectId: 'p', from: T(0), to: T(1) }])).toBe('Move object')
    expect(describeCommands([
      { kind: 'npc.add', npc: { entityId: 'n', x: 0, z: 0 }, index: 0 },
      { kind: 'zone.add', zone: { id: 'z', type: 'proximity', x: 0, z: 0, radius: 1 }, index: 0 },
    ])).toBe('Add NPC (+1)')
    expect(placedIdsOf([
      { kind: 'placed.add', object: placedObj('a') },
      { kind: 'npc.patch', entityId: 'n', from: {}, to: { x: 1 } },
      { kind: 'placed.transform', objectId: 'b', from: T(0), to: T(1) },
    ])).toEqual(['a', 'b'])
  })
})

// ─── History ──────────────────────────────────────────────────────────────────

describe('EditorHistory', () => {
  const e = (label: string) => ({ label, commands: [label] })

  it('a new push discards the redo stack and reports it', () => {
    const onDrop = vi.fn()
    const h = new EditorHistory<string>({ onDrop })
    h.push(e('a')); h.push(e('b'))
    h.undo()
    expect(h.canRedo).toBe(true)
    h.push(e('c'))
    expect(h.canRedo).toBe(false)
    expect(onDrop).toHaveBeenCalledWith(e('b'), 'truncated')
  })

  it('evicts the oldest entry past the limit', () => {
    const onDrop = vi.fn()
    const h = new EditorHistory<string>({ limit: 2, onDrop })
    h.push(e('a')); h.push(e('b')); h.push(e('c'))
    expect(h.undoSize).toBe(2)
    expect(onDrop).toHaveBeenCalledWith(e('a'), 'evicted')
    expect(h.undo()?.label).toBe('c')
    expect(h.undo()?.label).toBe('b')
    expect(h.undo()).toBeNull()
  })

  it('clear drops both stacks', () => {
    const onDrop = vi.fn()
    const h = new EditorHistory<string>({ onDrop })
    h.push(e('a')); h.push(e('b')); h.undo()
    h.clear()
    expect(h.canUndo || h.canRedo).toBe(false)
    expect(onDrop).toHaveBeenCalledTimes(2)
    expect(onDrop.mock.calls.every(([, r]) => r === 'cleared')).toBe(true)
  })
})

// ─── Routing point ────────────────────────────────────────────────────────────

describe('useSceneCommands', () => {
  /** A script of edits, each as the host would issue it. */
  function script(): SceneCommand[][] {
    return [
      [{ kind: 'npc.add', npc: { entityId: 'n1', x: 0, z: 0 }, index: 0 }],
      [{ kind: 'npc.add', npc: { entityId: 'n2', x: 5, z: 5 }, index: 1 }],
      [{ kind: 'npc.patch', entityId: 'n1', from: { x: 0, rotationY: undefined }, to: { x: 3, rotationY: 90 } }],
      [{ kind: 'zone.add', zone: { id: 'z1', type: 'proximity', x: 1, z: 1, radius: 3 }, index: 0 }],
      [{ kind: 'zone.patch', id: 'z1', from: { radius: 3 }, to: { radius: 6 } }],
      [{ kind: 'placed.add', object: placedObj('p1') }],
      [{ kind: 'placed.transform', objectId: 'p1', from: T(0), to: T(2, 1.5, 2) }],
      [{ kind: 'npc.remove', npc: { entityId: 'n2', x: 5, z: 5 }, index: 1 }],
    ]
  }

  /** A scene that already holds objects, so patches on them survive to the end. */
  function seededScene(): FakeScene {
    const s = emptyScene()
    s.npcs.push({ entityId: 'n0', x: 7, z: 7, scale: 1.5 })
    s.zones.push({ id: 'z0', type: 'proximity', x: 2, z: 2, radius: 4 })
    s.placed.set('p0', placedObj('p0'))
    s.transforms.set('p0', T(0))
    return s
  }

  /** Edits on the seeded objects, interleaved with the script. */
  function seededScript(): SceneCommand[][] {
    return [
      [{ kind: 'npc.patch', entityId: 'n0', from: { x: 7, scale: 1.5 }, to: { x: -1, scale: 2 } }],
      ...script(),
      [{ kind: 'zone.patch', id: 'z0', from: { x: 2, radius: 4 }, to: { x: 8, radius: 1 } }],
      [{ kind: 'placed.transform', objectId: 'p0', from: T(0), to: T(3, 0.5) }],
      // A removal records the live transform (the host snapshots it), not the drop-time one.
      [{ kind: 'placed.remove', object: { ...placedObj('p0'), x: 3, rotationY: 0.5 } }],
    ]
  }

  it('each undo restores the state before its step; redo walks forward through the same states', async () => {
    const scene = seededScene()
    const cmds = useSceneCommands(fakeTarget(scene))
    const states = [snap(scene)]
    for (const step of seededScript()) {
      await cmds.execute(step)
      states.push(snap(scene))
    }
    for (let i = states.length - 1; i > 0; i--) {
      expect(states[i]).not.toEqual(states[i - 1]) // every step changed something
      expect(await cmds.undo()).toBe(true)
      expect(snap(scene)).toEqual(states[i - 1])
    }
    expect(await cmds.undo()).toBe(false)
    for (let i = 1; i < states.length; i++) {
      expect(await cmds.redo()).toBe(true)
      expect(snap(scene)).toEqual(states[i])
    }
  })


  it('record() does not apply, but its undo does', async () => {
    const scene = emptyScene()
    scene.placed.set('p', placedObj('p'))
    scene.transforms.set('p', T(9)) // the gizmo already moved it live
    const cmds = useSceneCommands(fakeTarget(scene))
    await cmds.record([{ kind: 'placed.transform', objectId: 'p', from: T(0), to: T(9) }])
    expect(scene.transforms.get('p')!.position.x).toBe(9)
    await cmds.undo()
    expect(scene.transforms.get('p')!.position.x).toBe(0)
  })

  it('no-op steps are not recorded', async () => {
    const cmds = useSceneCommands(fakeTarget(emptyScene()))
    await cmds.record([{ kind: 'placed.transform', objectId: 'p', from: T(1), to: T(1) }])
    await cmds.execute([{ kind: 'npc.patch', entityId: 'n', from: {}, to: {} }])
    expect(cmds.canUndo.value).toBe(false)
  })

  it('reactive flags and labels follow the stack', async () => {
    const scene = emptyScene()
    const cmds = useSceneCommands(fakeTarget(scene))
    expect(cmds.canUndo.value).toBe(false)
    await cmds.execute([{ kind: 'npc.add', npc: { entityId: 'n', x: 0, z: 0 }, index: 0 }])
    expect(cmds.canUndo.value).toBe(true)
    expect(cmds.undoLabel.value).toBe('Add NPC')
    await cmds.undo()
    expect(cmds.canUndo.value).toBe(false)
    expect(cmds.canRedo.value).toBe(true)
    expect(cmds.redoLabel.value).toBe('Add NPC')
    cmds.clear()
    expect(cmds.canRedo.value).toBe(false)
  })

  it('operations queue behind a slow apply', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const cmds = useSceneCommands({
      async apply(c) {
        if (c.kind === 'npc.add') { await gate; order.push('add') } else order.push(c.kind)
      },
    })
    const add = cmds.execute([{ kind: 'npc.add', npc: { entityId: 'n', x: 0, z: 0 }, index: 0 }])
    const undo = cmds.undo() // pressed while the add is still applying
    release()
    await add
    expect(await undo).toBe(true)
    expect(order).toEqual(['add', 'npc.remove'])
  })

  it('reports dropped entries to the target', async () => {
    const onDrop = vi.fn()
    const cmds = useSceneCommands({ apply: () => {}, onDrop }, { limit: 1 })
    await cmds.execute([{ kind: 'npc.add', npc: { entityId: 'a', x: 0, z: 0 }, index: 0 }])
    await cmds.execute([{ kind: 'npc.add', npc: { entityId: 'b', x: 0, z: 0 }, index: 1 }])
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ label: 'Add NPC' }), 'evicted')
  })
})
