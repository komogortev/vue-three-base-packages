import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { createPlacedRegistry } from '../placement/placedRegistry'
import { HITBOX_PADDING } from '../placement/placedObjectModel'
import type { EditorPlacedObject } from '../sceneEditorTypes'

function rec(id: string, x = 0, extra: Partial<EditorPlacedObject> = {}): EditorPlacedObject {
  return { id, assetId: 'a', label: id, x, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra }
}

/** A 2 × 1 × 2 box standing on the floor, as a loaded GLB scene. */
function boxScene(): THREE.Object3D {
  const scene = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial())
  mesh.position.y = 0.5
  scene.add(mesh)
  return scene
}

/** A loader whose loads resolve when the test says so. */
function manualLoader() {
  const pending: { url: string; resolve: (v: { scene: THREE.Object3D }) => void; reject: (e: unknown) => void }[] = []
  return {
    pending,
    load: (url: string) => new Promise<{ scene: THREE.Object3D }>((resolve, reject) => pending.push({ url, resolve, reject })),
  }
}

/** Count geometry disposals under a root. */
function watchDisposal(root: THREE.Object3D): () => number {
  let n = 0
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.addEventListener('dispose', () => { n++ }) })
  return () => n
}

describe('placedRegistry', () => {
  it('add: places the GLB at the record transform with a padded pick box, and reports the list', async () => {
    const onChange = vi.fn()
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }), onChange })
    expect(await reg.add(rec('p', 3, { rotationY: 1 }), 'blob:p')).toBe(true)

    const root = reg.root('p')!
    expect(root.parent).toBe(reg.group)
    expect(root.position.x).toBe(3)
    expect(root.rotation.y).toBe(1)
    const [hit] = reg.hitBoxMeshes()
    const size = (hit.geometry as THREE.BoxGeometry).parameters
    expect(size.width).toBeCloseTo(2 + HITBOX_PADDING)
    expect(size.height).toBeCloseTo(1 + HITBOX_PADDING)
    expect(reg.idForHit(hit)).toBe('p')
    expect(onChange).toHaveBeenLastCalledWith([rec('p', 3, { rotationY: 1 })])
  })

  it('add: a failed load still places a selectable 1 m proxy', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => { throw new Error('bad glb') } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await reg.add(rec('p'), 'blob:p')).toBe(true)
    const size = (reg.hitBoxMeshes()[0].geometry as THREE.BoxGeometry).parameters
    expect(size.width).toBeCloseTo(1 + HITBOX_PADDING)
  })

  it('restore: replaces the list in order and keeps attachments', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    await reg.add(rec('old'), 'blob:old')
    const attachment = { parentId: 'room-root', contactType: 'rest' } as unknown as EditorPlacedObject['attachment']
    await reg.restore([
      { record: rec('a', 1), blobUrl: 'blob:a' },
      { record: rec('b', 2, { attachment }), blobUrl: 'blob:b' },
    ])
    expect(reg.records().map(r => r.id)).toEqual(['a', 'b'])
    expect(reg.root('old')).toBeUndefined()
    expect(reg.snapshot()[1].attachment).toEqual(attachment)
  })

  it('snapshot: carries the live transform the gizmo set, other fields untouched', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    await reg.add(rec('p', 0, { label: 'chair' }), 'blob:p')
    reg.root('p')!.position.set(4, 0, -2)
    reg.root('p')!.scale.setScalar(2)
    const [s] = reg.snapshot()
    expect([s.x, s.z, s.scaleY, s.label]).toEqual([4, -2, 2, 'chair'])
    expect(reg.records()[0].x).toBe(0) // the record keeps the drop-time value
  })

  it('detach / reattach: same root back at its list position and last transform', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    for (const id of ['a', 'b', 'c']) await reg.add(rec(id), `blob:${id}`)
    const rootB = reg.root('b')!
    rootB.position.x = 7
    const h = reg.detach('b')!
    expect(h.record.x).toBe(7)
    expect(reg.records().map(r => r.id)).toEqual(['a', 'c'])
    expect(reg.hitBoxMeshes()).toHaveLength(2)
    expect(reg.reattach(h)).toBe(true)
    expect(reg.records().map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(reg.root('b')).toBe(rootB)
    expect(rootB.position.x).toBe(7)
  })

  it('reattach refuses a taken id; disposeHandle disposes only what is out of the scene', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    await reg.add(rec('p'), 'blob:p')
    const disposed = watchDisposal(reg.root('p')!)
    const h = reg.detach('p')!
    await reg.add(rec('p'), 'blob:p2') // something else took the id
    expect(reg.reattach(h)).toBe(false)
    reg.disposeHandle(h)
    expect(disposed()).toBe(2) // the model and its hit box

    const root2 = reg.root('p')!
    const disposed2 = watchDisposal(root2) // watch the real root, before it is detached
    const h2 = reg.detach('p')!
    expect(reg.reattach(h2)).toBe(true)
    reg.disposeHandle(h2) // back in the scene: must not dispose
    expect(disposed2()).toBe(0)
  })

  it('visibleWorldBounds leaves the oversized pick box out', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    await reg.add(rec('p', 10), 'blob:p')
    const b = reg.visibleWorldBounds('p')!
    expect(b.min.x).toBeCloseTo(9)
    expect(b.max.x).toBeCloseTo(11)
    // Known positive: including the hit box would widen it by the padding.
    const withHit = new THREE.Box3().setFromObject(reg.root('p')!)
    expect(withHit.max.x).toBeGreaterThan(b.max.x + HITBOX_PADDING / 4)
  })

  it('a load overtaken by clear() is discarded and disposed, not added to the next scene', async () => {
    const loader = manualLoader()
    const reg = createPlacedRegistry({ loadGltf: loader.load })
    const adding = reg.add(rec('late'), 'blob:late')
    reg.clear() // scene switch while the GLB is still loading
    const scene = boxScene()
    const disposed = watchDisposal(scene)
    loader.pending[0].resolve({ scene })
    expect(await adding).toBe(false)
    expect(reg.records()).toEqual([])
    expect(reg.group.children).toHaveLength(0)
    expect(disposed()).toBe(1)
  })

  it('a restore overtaken by clear() resolves false, stops, and leaves the list to the newer scene', async () => {
    const loader = manualLoader()
    const reg = createPlacedRegistry({ loadGltf: loader.load })
    const restoring = reg.restore([{ record: rec('a'), blobUrl: 'blob:a' }, { record: rec('b'), blobUrl: 'blob:b' }])
    reg.clear()
    loader.pending[0].resolve({ scene: boxScene() })
    expect(await restoring).toBe(false)
    expect(reg.records()).toEqual([])
    expect(loader.pending).toHaveLength(1) // 'b' was never requested
  })

  it('a completed restore resolves true', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    expect(await reg.restore([{ record: rec('a'), blobUrl: 'blob:a' }])).toBe(true)
  })

  it('a failed load overtaken by clear() leaves no proxy behind', async () => {
    const loader = manualLoader()
    const reg = createPlacedRegistry({ loadGltf: loader.load })
    const adding = reg.add(rec('late'), 'blob:late')
    reg.clear()
    loader.pending[0].reject(new Error('bad glb'))
    expect(await adding).toBe(false)
    expect(reg.group.children).toHaveLength(0)
  })

  it('an add overtaken by a restore does not land in the restored list', async () => {
    const loader = manualLoader()
    const reg = createPlacedRegistry({ loadGltf: loader.load })
    const adding = reg.add(rec('dropped'), 'blob:d')
    const restoring = reg.restore([{ record: rec('a'), blobUrl: 'blob:a' }])
    loader.pending[0].resolve({ scene: boxScene() }) // the drop's load
    loader.pending[1].resolve({ scene: boxScene() }) // the restore's load
    expect(await adding).toBe(false)
    expect(await restoring).toBe(true)
    expect(reg.records().map(r => r.id)).toEqual(['a'])
  })

  it('onChange always reports exactly the current list', async () => {
    const reports: string[][] = []
    const reg = createPlacedRegistry({
      loadGltf: async () => ({ scene: boxScene() }),
      onChange: recs => reports.push(recs.map(r => r.id)),
    })
    const ids = () => reg.records().map(r => r.id)
    const steps: [string, () => unknown][] = [
      ['add a', () => reg.add(rec('a'), 'blob:a')],
      ['add b', () => reg.add(rec('b'), 'blob:b')],
      ['detach a', () => { (globalThis as Record<string, unknown>).__h = reg.detach('a') }],
      ['reattach a', () => reg.reattach((globalThis as Record<string, unknown>).__h as never)],
      ['remove b', () => reg.remove('b')],
      ['restore c', () => reg.restore([{ record: rec('c'), blobUrl: 'blob:c' }])],
      ['clear', () => reg.clear()],
    ]
    for (const [name, run] of steps) {
      const before = reports.length
      await run()
      expect(reports.length, name).toBeGreaterThan(before)
      expect(reports.at(-1), name).toEqual(ids())
    }
  })

  it('clear and remove dispose what they drop', async () => {
    const reg = createPlacedRegistry({ loadGltf: async () => ({ scene: boxScene() }) })
    await reg.add(rec('a'), 'blob:a')
    await reg.add(rec('b'), 'blob:b')
    const da = watchDisposal(reg.root('a')!)
    const db = watchDisposal(reg.root('b')!)
    reg.remove('a')
    expect(da()).toBe(2)
    reg.clear()
    expect(db()).toBe(2)
    expect(reg.records()).toEqual([])
  })
})
