/**
 * Placed-object registry — the GLBs an author dropped into the scene.
 *
 * Decomposition: L1 module. It owns one slice of THREE state — the placed group, a
 * root and an invisible pick hit box per object, the record list — and its
 * lifecycle. Lifted out of `useSceneEditorViewport` when PP-1 (scene commands) grew
 * that file past its structural baseline; the composable keeps what crosses
 * clusters (selection, the gizmo, the gesture slot, place mode).
 *
 * The record list is the source of order and identity; the roots hold the live
 * transforms (the gizmo moves them). `snapshot()` merges the two for save. Every
 * change to the list is reported through `onChange`, which is how the composable's
 * reactive `placedObjects` stays in step without the registry knowing about Vue.
 *
 * **One construction path.** A drop and a saved-scene load both go through `add`,
 * so the GLB load, the wireframe fallback and the hit box are built in one place
 * (they were two hand-kept copies).
 *
 * **Stale loads are discarded.** A load that resolves after `clear()` (scene switch)
 * is disposed instead of landing in the next scene.
 */
import * as THREE from 'three'

import type { EditorPlacedObject } from '../sceneEditorTypes'
import type { Aabb } from '../gate/verdict'
import {
  hitBoxDims, resolveLocalBbox, transformOf, withTransform, type PlacedTransform,
} from './placedObjectModel'

/**
 * A placed object taken out of the scene but kept whole (meshes not disposed), so an
 * undo can put it back without reloading its GLB. Release it (`disposeHandle` here,
 * `disposePlacedHandle` on the viewport) once nothing can bring it back.
 */
export interface PlacedHandle {
  readonly id: string
  /** The record with the transform it had when it was taken out. */
  readonly record: EditorPlacedObject
}

export interface PlacedRegistryOptions {
  /** Load and parse a GLB. Injected so the registry is testable without WebGL. */
  loadGltf: (url: string) => Promise<{ scene: THREE.Object3D }>
  /** Called with a copy of the record list after every change to it. */
  onChange?: (records: EditorPlacedObject[]) => void
}

export interface PlacedRegistry {
  /** Scene-level container. Added to the scene once, at init. */
  readonly group: THREE.Group

  /** Records in list order (a copy). */
  records(): EditorPlacedObject[]
  /** Root group of a placed object — TransformControls attaches here. */
  root(id: string): THREE.Group | undefined
  /** id/root pairs, for resolving a gizmo target back to an id. */
  rootEntries(): [string, THREE.Group][]
  /** Click targets, for `raycaster.intersectObjects`. */
  hitBoxMeshes(): THREE.Mesh[]
  /** The placed object a raycast hit belongs to. */
  idForHit(mesh: THREE.Object3D): string | undefined
  /** World bounds of what is drawn (the pick hit box excluded), or null when empty. */
  visibleWorldBounds(id: string): Aabb | null

  /**
   * Load `blobUrl` and append the object at `record`'s transform (a wireframe 1 m
   * proxy when the load fails). Resolves false when a `clear()` overtook the load
   * (nothing was added).
   */
  add(record: EditorPlacedObject, blobUrl: string): Promise<boolean>
  /**
   * Replace the whole list (saved-scene load). Loads run in order. Resolves false when
   * a `clear()` overtook it: the list then belongs to the newer scene.
   */
  restore(items: readonly { record: EditorPlacedObject; blobUrl: string }[]): Promise<boolean>

  /** Live transform of a placed object, or null when it is not in the scene. */
  transformOf(id: string): PlacedTransform | null
  setTransform(id: string, t: PlacedTransform): void
  /** Records with their live transforms (for save / export / the gate). */
  snapshot(): EditorPlacedObject[]

  /** Take an object out without disposing it; null when absent. */
  detach(id: string): PlacedHandle | null
  /** Put a detached object back at its old list position. False when its id is taken. */
  reattach(handle: PlacedHandle): boolean
  /** Dispose a detached object's meshes. No-op while it is (again) in the scene. */
  disposeHandle(handle: PlacedHandle): void
  /** Take an object out and dispose it. */
  remove(id: string): void

  /** Dispose and forget every object (scene switch). Pending loads are discarded. */
  clear(): void
  /** Same as `clear()`, for unmount. */
  dispose(): void
}

interface Entry {
  record: EditorPlacedObject
  root: THREE.Group
  hitBox: THREE.Mesh
}

interface HandleImpl extends PlacedHandle {
  readonly entry: Entry
  readonly index: number
}

function aabbOf(b: THREE.Box3): Aabb | null {
  if (b.isEmpty()) return null
  return { min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } }
}

/** Invisible padded hit box for raycast selection of a placed GLB. */
function buildHitBox(localBbox: THREE.Box3): THREE.Mesh {
  const { size, center } = hitBoxDims(resolveLocalBbox(aabbOf(localBbox)))
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial({ visible: false }),
  )
  mesh.position.set(center.x, center.y, center.z)
  return mesh
}

function liveTransformOf(o: THREE.Object3D): PlacedTransform {
  return {
    position: { x: o.position.x, y: o.position.y, z: o.position.z },
    rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
  }
}

function applyTransform(root: THREE.Object3D, t: PlacedTransform): void {
  root.position.set(t.position.x, t.position.y, t.position.z)
  root.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
  root.scale.set(t.scale.x, t.scale.y, t.scale.z)
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else (mat as THREE.Material)?.dispose()
    }
  })
}

export function createPlacedRegistry(opts: PlacedRegistryOptions): PlacedRegistry {
  const group = new THREE.Group()
  /** List order. Entries are also indexed by id. */
  let list: Entry[] = []
  const byId = new Map<string, Entry>()
  /** Bumped by `clear()`; a load that finishes under an older value is stale. */
  let generation = 0

  const changed = () => opts.onChange?.(list.map(e => e.record))

  /** Load and assemble one object. Never rejects; staleness is the caller's check. */
  async function build(record: EditorPlacedObject, blobUrl: string): Promise<Entry> {
    const root = new THREE.Group()
    applyTransform(root, transformOf(record))
    const localBbox = new THREE.Box3()
    try {
      const gltf = await opts.loadGltf(blobUrl)
      // Bounds in the GLB's own local space, before parenting.
      localBbox.setFromObject(gltf.scene)
      root.add(gltf.scene)
    } catch (e) {
      console.warn('[placedRegistry] GLB load failed for', record.id, e)
      // Fallback proxy so the placement is still visible and selectable.
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: '#c099ff', wireframe: true }),
      )
      proxy.position.set(0, 0.5, 0)
      root.add(proxy)
      // Left empty: `resolveLocalBbox` substitutes the proxy's 1 m cube (one source).
      localBbox.makeEmpty()
    }
    const hitBox = buildHitBox(localBbox)
    root.add(hitBox)
    return { record, root, hitBox }
  }

  function insert(entry: Entry, index = list.length): void {
    group.add(entry.root)
    byId.set(entry.record.id, entry)
    list = [...list]
    list.splice(Math.min(index, list.length), 0, entry)
  }

  function take(id: string): { entry: Entry; index: number } | null {
    const entry = byId.get(id)
    if (!entry) return null
    const index = list.indexOf(entry)
    group.remove(entry.root)
    byId.delete(id)
    list = list.filter(e => e !== entry)
    return { entry, index }
  }

  function clear(): void {
    generation++
    for (const e of list) disposeTree(e.root)
    group.clear()
    list = []
    byId.clear()
    changed()
  }

  return {
    group,

    records: () => list.map(e => e.record),
    root: id => byId.get(id)?.root,
    rootEntries: () => list.map(e => [e.record.id, e.root] as [string, THREE.Group]),
    hitBoxMeshes: () => list.map(e => e.hitBox),
    idForHit(mesh) {
      for (const e of list) if (e.hitBox === mesh) return e.record.id
      return undefined
    },
    visibleWorldBounds(id) {
      const e = byId.get(id)
      if (!e) return null
      e.root.updateWorldMatrix(true, true)
      // The hit box is oversized (bbox + padding); Box3.setFromObject would union it
      // and weaken the gate's contact-gap veto. Expand over the drawn children only.
      const box = new THREE.Box3()
      for (const child of e.root.children) {
        if (child !== e.hitBox) box.expandByObject(child)
      }
      return aabbOf(box)
    },

    async add(record, blobUrl) {
      const gen = generation
      const entry = await build(record, blobUrl)
      // A clear() while it loaded: discard, so it cannot land in the next scene.
      if (gen !== generation) { disposeTree(entry.root); return false }
      insert(entry)
      changed()
      return true
    },

    async restore(items) {
      clear()
      const gen = generation
      for (const { record, blobUrl } of items) {
        const entry = await build(record, blobUrl)
        // Overtaken by another clear: the newer scene owns the list.
        if (gen !== generation) { disposeTree(entry.root); return false }
        insert(entry)
      }
      changed()
      return true
    },

    transformOf: id => {
      const e = byId.get(id)
      return e ? liveTransformOf(e.root) : null
    },
    setTransform(id, t) {
      const e = byId.get(id)
      if (e) applyTransform(e.root, t)
    },
    snapshot: () => list.map(e => withTransform(e.record, liveTransformOf(e.root))),

    detach(id) {
      const taken = take(id)
      if (!taken) return null
      const record = withTransform(taken.entry.record, liveTransformOf(taken.entry.root))
      changed()
      const handle: HandleImpl = { id, record, entry: taken.entry, index: taken.index }
      return handle
    },
    reattach(handle) {
      const h = handle as HandleImpl
      if (byId.has(h.id)) return false
      applyTransform(h.entry.root, transformOf(h.record))
      insert({ ...h.entry, record: h.record }, h.index)
      changed()
      return true
    },
    disposeHandle(handle) {
      const h = handle as HandleImpl
      if (byId.get(h.id)?.root === h.entry.root) return
      disposeTree(h.entry.root)
    },
    remove(id) {
      const taken = take(id)
      if (!taken) return
      disposeTree(taken.entry.root)
      changed()
    },

    clear,
    dispose: clear,
  }
}
