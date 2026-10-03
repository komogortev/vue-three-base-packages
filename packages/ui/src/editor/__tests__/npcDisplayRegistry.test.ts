import { describe, it, expect, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { createNpcDisplayRegistry, type NpcDisplayEntry } from '../npc/npcDisplayRegistry'

interface FakeModel {
  scene: THREE.Group
  geometry: THREE.BufferGeometry
  material: THREE.MeshBasicMaterial
  bones: THREE.Bone[]
  geometryDispose: ReturnType<typeof vi.fn>
  materialDispose: ReturnType<typeof vi.fn>
  textureDispose: ReturnType<typeof vi.fn>
}

interface ModelOpts {
  /** Put the root bone under a non-identity, non-bone parent, like a Mixamo Armature node. */
  armature?: boolean
  /** Add a second SkinnedMesh with its own skeleton (split body / head rigs). */
  secondMesh?: boolean
}

/** A skinned model `height` tall with a 2-bone skeleton. No WebGL needed. */
function makeModel(height = 1.8, o: ModelOpts = {}): FakeModel {
  const geometry = new THREE.BoxGeometry(0.5, height, 0.5)
  geometry.translate(0, height / 2, 0)
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const w = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) w[i * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4))

  const material = new THREE.MeshBasicMaterial()
  const texture = new THREE.Texture()
  material.map = texture
  const root = new THREE.Bone(); root.name = 'Hips'
  const arm = new THREE.Bone(); arm.name = 'Arm'
  // Non-trivial local transforms, so a reset to the wrong pose is visible.
  root.position.set(0, 1, 0)
  arm.position.set(0.3, 0.2, 0)
  arm.quaternion.setFromEuler(new THREE.Euler(0.4, 0, 0))
  root.add(arm)
  const mesh = new THREE.SkinnedMesh(geometry, material)
  const scene = new THREE.Group()
  if (o.armature) {
    const armature = new THREE.Group()
    armature.scale.setScalar(0.01)
    armature.rotation.x = Math.PI / 2
    armature.add(root)
    scene.add(armature, mesh)
  } else {
    scene.add(root, mesh)
  }
  scene.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([root, arm]))
  if (o.secondMesh) {
    const root2 = new THREE.Bone(); root2.name = 'Head'
    const mesh2 = new THREE.SkinnedMesh(geometry, material)
    scene.add(root2, mesh2)
    scene.updateMatrixWorld(true)
    mesh2.bind(new THREE.Skeleton([root2]))
  }

  const geometryDispose = vi.fn(); geometry.dispose = geometryDispose as never
  const materialDispose = vi.fn(); material.dispose = materialDispose as never
  const textureDispose = vi.fn(); texture.dispose = textureDispose as never
  return { scene, geometry, material, bones: [root, arm], geometryDispose, materialDispose, textureDispose }
}

/** Loader whose every URL stays pending until the test resolves or rejects it. */
function deferredLoader() {
  const calls: string[] = []
  const models = new Map<string, FakeModel>()
  const resolvers = new Map<string, (v: { scene: THREE.Object3D }) => void>()
  const rejecters = new Map<string, (e: unknown) => void>()
  const loadGltf = vi.fn((url: string) => {
    calls.push(url)
    return new Promise<{ scene: THREE.Object3D }>((res, rej) => {
      resolvers.set(url, res)
      rejecters.set(url, rej)
    })
  })
  return {
    loadGltf,
    calls,
    models,
    resolve(url: string, height = 1.8, o: ModelOpts = {}): FakeModel {
      const m = makeModel(height, o)
      models.set(url, m)
      resolvers.get(url)!({ scene: m.scene })
      return m
    },
    reject(url: string, err: unknown = new Error('boom')) { rejecters.get(url)!(err) },
  }
}

const e = (id: string, url: string, extra: Partial<NpcDisplayEntry> = {}): NpcDisplayEntry =>
  ({ entityId: id, assetUrl: url, x: 0, z: 0, ...extra })

afterEach(() => { vi.restoreAllMocks() })

describe('createNpcDisplayRegistry', () => {
  it('loads a model once for two NPCs on the same asset and shares geometry', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1'), e('b', 'u1', { x: 3 })])
    L.resolve('u1')
    await p

    expect(L.loadGltf).toHaveBeenCalledTimes(1)
    expect(reg.group.children).toHaveLength(2)
    const a = reg.get('a')!, b = reg.get('b')!
    expect(a.root).not.toBe(b.root)
    expect(a.skinned!.geometry).toBe(b.skinned!.geometry)
    expect(a.skinned!.skeleton).not.toBe(b.skinned!.skeleton)
    expect(b.root.position.x).toBe(3)
  })

  it('places a model with y, rotationY and scale from the entry, without grounding', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1', { x: 1, y: 2, z: 3, rotationY: 90, scale: 2 })])
    L.resolve('u1')
    await p
    const d = reg.get('a')!
    expect(d.root.position.toArray()).toEqual([1, 2, 3])
    expect(d.root.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(d.root.scale.x).toBe(2)
  })

  it('rescues a centimetre-scale model to a sane height', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1')])
    L.resolve('u1', 180)
    await p
    const d = reg.get('a')!
    expect(d.baseScale).toBeCloseTo(1.7 / 180)
    expect(d.root.scale.x).toBeCloseTo(1.7 / 180)
  })

  it('re-applies a yaw cleanly after a gizmo wrote a quaternion past 90 degrees', async () => {
    // A gizmo sets the quaternion; for a yaw of 150 deg three decomposes it to Euler
    // (180, 30, 180). Setting only rotation.y on top of that would leave the model upside down.
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1', { rotationY: 150 })])
    L.resolve('u1'); await p
    const root = reg.get('a')!.root
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (150 * Math.PI) / 180) // what the gizmo does
    expect(Math.abs(root.rotation.x)).toBeCloseTo(Math.PI, 5) // the trap is real
    await reg.reconcile([e('a', 'u1', { rotationY: 160 })])
    expect(root.rotation.x).toBe(0)
    expect(root.rotation.z).toBe(0)
    expect(root.rotation.y).toBeCloseTo((160 * Math.PI) / 180, 6)
  })

  it('does not reload or re-clone when nothing changed', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1')])
    L.resolve('u1')
    await p
    const root = reg.get('a')!.root
    await reg.reconcile([e('a', 'u1', { scale: 3 })])
    expect(reg.get('a')!.root).toBe(root)
    expect(L.loadGltf).toHaveBeenCalledTimes(1)
    expect(root.scale.x).toBe(3)
  })

  describe('swapping and removing', () => {
    it('disposes the old asset when its last NPC swaps away', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      let p = reg.reconcile([e('a', 'u1')])
      const m1 = L.resolve('u1'); await p
      p = reg.reconcile([e('a', 'u2')])
      L.resolve('u2'); await p

      expect(m1.geometryDispose).toHaveBeenCalled()
      expect(m1.materialDispose).toHaveBeenCalled()
      expect(reg.get('a')!.assetUrl).toBe('u2')
      expect(reg.group.children).toHaveLength(1)
    })

    it('keeps a shared asset alive while another NPC still uses it', async () => {
      // Negative control for the refcount: disposing here would blank NPC "b".
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      let p = reg.reconcile([e('a', 'u1'), e('b', 'u1')])
      const m1 = L.resolve('u1'); await p
      p = reg.reconcile([e('a', 'u2'), e('b', 'u1')])
      L.resolve('u2'); await p

      expect(m1.geometryDispose).not.toHaveBeenCalled()
      expect(reg.get('b')!.assetUrl).toBe('u1')
    })

    it('disposes the cloned skeleton and removes the model when an NPC is removed', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      const m = L.resolve('u1'); await p
      const skeleton = reg.get('a')!.skinned!.skeleton
      const spy = vi.spyOn(skeleton, 'dispose')
      await reg.reconcile([])

      expect(spy).toHaveBeenCalled()
      expect(reg.get('a')).toBeUndefined()
      expect(reg.group.children).toHaveLength(0)
      expect(m.geometryDispose).toHaveBeenCalled()
    })
  })

  describe('races', () => {
    it('keeps the latest request when loads resolve out of order', async () => {
      // Known positive: u2 (requested last) resolves FIRST, u1 resolves late. A naive
      // "last load to finish wins" would leave the stale u1 model on screen.
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p1 = reg.reconcile([e('a', 'u1')])
      const p2 = reg.reconcile([e('a', 'u2')])
      L.resolve('u2'); await p2
      const m1 = L.resolve('u1'); await p1

      expect(reg.get('a')!.assetUrl).toBe('u2')
      expect(reg.group.children).toHaveLength(1)
      expect(m1.geometryDispose).toHaveBeenCalled() // the stale template did not leak
    })

    it('drops a stale clone even when the asset stays alive for another NPC', async () => {
      // The cache entry is NOT dead here (B still holds u1), so only the per-entity
      // generation check stops A's superseded request from adding a third model.
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p1 = reg.reconcile([e('a', 'u1'), e('b', 'u1')])
      const p2 = reg.reconcile([e('a', 'u2'), e('b', 'u1')])
      L.resolve('u2'); L.resolve('u1')
      await Promise.all([p1, p2])

      expect(reg.get('a')!.assetUrl).toBe('u2')
      expect(reg.get('b')!.assetUrl).toBe('u1')
      expect(reg.group.children).toHaveLength(2)
    })

    it('adds nothing when the NPC is removed while its load is in flight', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      await reg.reconcile([])
      const m = L.resolve('u1'); await p

      expect(reg.group.children).toHaveLength(0)
      expect(reg.get('a')).toBeUndefined()
      expect(m.geometryDispose).toHaveBeenCalled()
    })

    it('adds nothing to a cleared registry when a load resolves after a scene switch', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      reg.clear()
      L.resolve('u1'); await p
      expect(reg.group.children).toHaveLength(0)
    })

    it('applies the latest entry when it changed while the load was in flight', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p1 = reg.reconcile([e('a', 'u1', { x: 1 })])
      const p2 = reg.reconcile([e('a', 'u1', { x: 9, scale: 2 })])
      L.resolve('u1'); await Promise.all([p1, p2])
      const d = reg.get('a')!
      expect(L.loadGltf).toHaveBeenCalledTimes(1)
      expect(d.root.position.x).toBe(9)
      expect(d.root.scale.x).toBe(2)
    })
  })

  describe('failure', () => {
    it('does not throw or add a model, warns, and leaves other NPCs alone', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('bad', 'ubad'), e('ok', 'u1')])
      L.reject('ubad'); L.resolve('u1')
      await expect(p).resolves.toBeUndefined()

      expect(reg.get('bad')).toBeUndefined()
      expect(reg.get('ok')).toBeDefined()
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it('does not retry an unchanged failed entry, but retries after remove and re-add', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      L.reject('u1'); await p
      await reg.reconcile([e('a', 'u1')])
      expect(L.loadGltf).toHaveBeenCalledTimes(1)

      await reg.reconcile([])
      const p2 = reg.reconcile([e('a', 'u1')])
      L.resolve('u1'); await p2
      expect(L.loadGltf).toHaveBeenCalledTimes(2)
      expect(reg.get('a')).toBeDefined()
    })
  })

  describe('pose', () => {
    const q: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]

    it('applies poseOverride on creation', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1', { poseOverride: [{ bone: 'Arm', q }] })])
      L.resolve('u1'); await p
      const arm = reg.get('a')!.skinned!.skeleton.getBoneByName('Arm')!
      expect(arm.quaternion.toArray()).toEqual(q)
    })

    it('resets the pose when the override is cleared', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1', { poseOverride: [{ bone: 'Arm', q }] })])
      const m = L.resolve('u1'); await p
      await reg.reconcile([e('a', 'u1', { poseOverride: undefined })])
      const arm = reg.get('a')!.skinned!.skeleton.getBoneByName('Arm')!
      // Back to the model's own rest pose, not to identity.
      expect(arm.quaternion.toArray()).toEqual(m.bones[1].quaternion.toArray())
    })

    it('restoreAuthoredPose discards un-captured bone edits', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      const m = L.resolve('u1'); await p
      const arm = reg.get('a')!.skinned!.skeleton.getBoneByName('Arm')!
      arm.quaternion.set(0.5, 0.5, 0.5, 0.5) // a live, un-captured edit
      reg.restoreAuthoredPose('a', undefined)
      expect(arm.quaternion.toArray()).toEqual(m.bones[1].quaternion.toArray())
    })

    it('a scale change does not wipe live pose edits', async () => {
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      L.resolve('u1'); await p
      const arm = reg.get('a')!.skinned!.skeleton.getBoneByName('Arm')!
      arm.quaternion.set(0.5, 0.5, 0.5, 0.5)
      await reg.reconcile([e('a', 'u1', { scale: 2 })])
      expect(arm.quaternion.toArray()).toEqual([0.5, 0.5, 0.5, 0.5])
    })
  })

  it('clear removes every model and disposes every template', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1'), e('b', 'u2')])
    const m1 = L.resolve('u1'); const m2 = L.resolve('u2'); await p
    reg.clear()
    expect(reg.group.children).toHaveLength(0)
    expect(reg.get('a')).toBeUndefined()
    expect(reg.get('b')).toBeUndefined()
    expect(m1.geometryDispose).toHaveBeenCalled()
    expect(m2.geometryDispose).toHaveBeenCalled()
  })
  describe('rest pose (review finding 2)', () => {
    it('does not disturb bones on creation, even under a scaled/rotated Armature parent', async () => {
      // Skeleton.pose() would apply the Armature transform twice to the root bone.
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1')])
      const m = L.resolve('u1', 1.8, { armature: true }); await p
      const before = m.bones.map(b => ({ p: b.position.toArray(), q: b.quaternion.toArray(), s: b.scale.toArray() }))
      const cloneBones = reg.get('a')!.skinned!.skeleton.bones
      cloneBones.forEach((b, i) => {
        expect(b.position.toArray()).toEqual(before[i].p)
        expect(b.quaternion.toArray()).toEqual(before[i].q)
        expect(b.scale.toArray()).toEqual(before[i].s)
      })
    })

    it('restores exactly the load-time pose after an override is cleared, under an Armature', async () => {
      const q: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1', { poseOverride: [{ bone: 'Arm', q }] })])
      const m = L.resolve('u1', 1.8, { armature: true }); await p
      await reg.reconcile([e('a', 'u1', { poseOverride: undefined })])
      const bones = reg.get('a')!.skinned!.skeleton.bones
      expect(bones[0].position.toArray()).toEqual(m.bones[0].position.toArray())
      expect(bones[1].quaternion.toArray()).toEqual(m.bones[1].quaternion.toArray())
      expect(bones[1].position.toArray()).toEqual(m.bones[1].position.toArray())
    })
  })

  it('disposes the skeleton of every skinned mesh, not only the first', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1')])
    L.resolve('u1', 1.8, { secondMesh: true }); await p
    const skeletons: THREE.Skeleton[] = []
    reg.get('a')!.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.push((o as THREE.SkinnedMesh).skeleton) })
    expect(skeletons).toHaveLength(2)
    const spies = skeletons.map(sk => vi.spyOn(sk, 'dispose'))
    await reg.reconcile([])
    spies.forEach(spy => expect(spy).toHaveBeenCalled())
  })

  it('disposes textures along with geometry and materials at refcount zero', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    const p = reg.reconcile([e('a', 'u1')])
    const m = L.resolve('u1'); await p
    expect(m.textureDispose).not.toHaveBeenCalled()
    await reg.reconcile([])
    expect(m.textureDispose).toHaveBeenCalled()
  })

  describe('a throw while building the display', () => {
    it('is contained: reconcile resolves, the ref is released, a re-add retries', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const L = deferredLoader()
      let boom = true
      const reg = createNpcDisplayRegistry({
        loadGltf: L.loadGltf,
        cloneModel: src => {
          if (boom) throw new Error('clone failed')
          return src.clone()
        },
      })
      const p = reg.reconcile([e('a', 'u1')])
      const m = L.resolve('u1')
      await expect(p).resolves.toBeUndefined()
      expect(reg.get('a')).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(m.geometryDispose).toHaveBeenCalled() // ref released -> template disposed

      boom = false
      await reg.reconcile([])
      const p2 = reg.reconcile([e('a', 'u1')])
      L.resolve('u1'); await p2
      expect(reg.get('a')).toBeDefined()
    })

    it('two NPCs on one failing URL both fail cleanly and a later NPC can retry', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const L = deferredLoader()
      const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
      const p = reg.reconcile([e('a', 'u1'), e('b', 'u1')])
      L.reject('u1'); await p
      expect(reg.group.children).toHaveLength(0)

      await reg.reconcile([])
      const p2 = reg.reconcile([e('c', 'u1')])
      L.resolve('u1'); await p2
      expect(L.loadGltf).toHaveBeenCalledTimes(2)
      expect(reg.get('c')).toBeDefined()
    })
  })

  it('settled(id) resolves without waiting for another NPC still loading', async () => {
    const L = deferredLoader()
    const reg = createNpcDisplayRegistry({ loadGltf: L.loadGltf })
    void reg.reconcile([e('a', 'u1'), e('b', 'u2')])
    L.resolve('u1') // u2 never resolves in this test
    await reg.settled('a')
    expect(reg.get('a')).toBeDefined()
    expect(reg.get('b')).toBeUndefined()
    await expect(reg.settled('unknown')).resolves.toBeUndefined()
  })
})
