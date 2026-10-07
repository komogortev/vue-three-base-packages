/**
 * NPC display registry — the always-on character model for each editor NPC.
 *
 * Plan: threejs-engine-dev/docs/PLAN-E5-NPC-DISPLAY-MESH-2026-10-03.md.
 * Before this, the only NPC model in the editor was the pose editor's: loaded
 * on Pose/Anim activation, one at a time, disposed on every selection change.
 * Setting a character asset therefore showed nothing until the Pose tab opened.
 *
 * L1 module: owns one slice of THREE state (the display group, per-NPC clones,
 * a refcounted asset cache) and its lifecycle. Takes its loader at construction
 * and imports nothing from `markers/` — the composable feeds it entries (which
 * carry the marker's authored position), so L1 never depends on L1.
 *
 * **Declarative.** `reconcile(entries)` is the one mutation path: it diffs the
 * wanted NPCs against what exists and adds, swaps, retransforms or removes. Asset
 * set, NPC add/remove, scene load and the asset library finishing its async load
 * are all the same call, so there is no per-event path to forget.
 *
 * **Assets are cloned, not reloaded.** One parse per distinct blob URL; each NPC
 * gets a `SkeletonUtils.clone` (own skeleton, shared geometry + materials). The
 * cache key is the URL, not the asset id, so an `appendToPack`-grown blob
 * (same id, new URL) reloads. Shared geometry/materials are disposed only when
 * the last NPC using that URL goes away. The registry never mutates a material.
 *
 * **Stale loads are discarded.** A load that resolves after its NPC was removed,
 * swapped or cleared is dropped (and its template disposed if nothing else holds
 * it). Per-entity identity of the state record is the generation token.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { baseScaleFor, placementFor, type NpcPlacementEntry } from '../pose/npcPlacement'

export interface PoseOverrideEntry {
  bone: string
  q: [number, number, number, number]
}

export interface NpcDisplayEntry extends NpcPlacementEntry {
  entityId: string
  /** Resolved blob URL of the character GLB — also the cache key. */
  assetUrl: string
  /** Authored static pose. Applied on creation and whenever the reference changes. */
  poseOverride?: PoseOverrideEntry[]
}

export interface NpcDisplay {
  readonly entityId: string
  readonly assetUrl: string
  /** The cloned model root (a child of the registry's group). */
  readonly root: THREE.Object3D
  /** First SkinnedMesh in the model, or null for a static mesh. */
  readonly skinned: THREE.SkinnedMesh | null
  /** Fit-rescue multiplier measured when the asset was loaded. */
  readonly baseScale: number
}

export interface NpcDisplayRegistryOptions {
  /** Load and parse a GLB. Injected so the registry is testable without WebGL. */
  loadGltf: (url: string) => Promise<{ scene: THREE.Object3D }>
  /** Clone a loaded model with its own skeleton. Defaults to `SkeletonUtils.clone`. */
  cloneModel?: (source: THREE.Object3D) => THREE.Object3D
}

export interface NpcDisplayRegistry {
  /** Scene-level container. Added to the scene once, at init. */
  readonly group: THREE.Group
  /**
   * Make the displayed NPCs match `entries`. Resolves when every load this call
   * depends on has settled (success or failure — a failed load never rejects).
   */
  reconcile(entries: readonly NpcDisplayEntry[]): Promise<void>
  get(entityId: string): NpcDisplay | undefined
  /**
   * Resolves when this NPC's current load has settled (success or failure). Lets a
   * caller wait for ONE model instead of every pending load. Resolves at once for
   * an unknown entity.
   */
  settled(entityId: string): Promise<void>
  /**
   * Reset a model to its authored state: bind pose, then `poseOverride`.
   * Called when the pose editor lets go, so un-captured bone edits do not
   * linger as phantom state. No-op if absent.
   */
  restoreAuthoredPose(entityId: string, poseOverride: readonly PoseOverrideEntry[] | undefined): void
  /** Scene-switch teardown: remove every model and cancel in-flight loads. */
  clear(): void
  /** Unmount teardown. Same as `clear()`; the group itself is the caller's to remove. */
  dispose(): void
}

/** A bone's local transform at load time: the rest pose we reset to. */
interface BoneRest {
  p: THREE.Vector3
  q: THREE.Quaternion
  s: THREE.Vector3
}

interface Template {
  scene: THREE.Object3D
  baseScale: number
  /** Local transforms of the first skinned mesh's bones, in skeleton order. */
  rest: BoneRest[]
}

/** One cache record per URL. `dead` is set when the last holder lets go. */
interface CacheEntry {
  refs: number
  dead: boolean
  template: Template | null
  promise: Promise<Template | null>
}

interface MutableDisplay extends NpcDisplay {
  root: THREE.Object3D
}

/** Per-NPC state. Its identity is the generation token for stale loads. */
interface EntityState {
  url: string
  entry: NpcDisplayEntry
  cancelled: boolean
  display: MutableDisplay | null
  /** Rest pose of this model's skeleton (from the template), for resets. */
  rest: BoneRest[]
  /** Last pose-override reference applied, to detect a change. */
  appliedPose: readonly PoseOverrideEntry[] | undefined
  done: Promise<void>
}

function disposeMaterial(mat: THREE.Material): void {
  for (const value of Object.values(mat)) {
    if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
  }
  mat.dispose()
}

/** Geometry, materials and their textures. Safe to call twice on shared resources. */
function disposeTemplate(root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach(disposeMaterial)
    else if (mat) disposeMaterial(mat)
  })
}

function firstSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse(obj => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) found = obj as THREE.SkinnedMesh
  })
  return found
}

/**
 * Reset the skeleton to its load-time rest pose, then apply the authored override.
 *
 * Deliberately NOT `Skeleton.pose()`: that rebuilds local matrices from the bind
 * inverses, and for a root bone under a non-bone parent (an Armature node with a
 * scale or rotation) it copies the bind WORLD matrix as the local one, applying
 * that parent's transform twice. Restoring the snapshot taken at load cannot
 * disagree with the file, and matches the room player, which never calls `pose()`.
 */
function applyPose(
  skinned: THREE.SkinnedMesh | null,
  rest: readonly BoneRest[],
  poseOverride: readonly PoseOverrideEntry[] | undefined,
): void {
  if (!skinned) return
  const bones = skinned.skeleton.bones
  for (let i = 0; i < bones.length && i < rest.length; i++) {
    bones[i].position.copy(rest[i].p)
    bones[i].quaternion.copy(rest[i].q)
    bones[i].scale.copy(rest[i].s)
  }
  for (const o of poseOverride ?? []) {
    skinned.skeleton.getBoneByName(o.bone)?.quaternion.fromArray(o.q)
  }
}

function applyTransform(d: MutableDisplay, entry: NpcPlacementEntry): void {
  const t = placementFor(d.baseScale, entry)
  d.root.scale.setScalar(t.scale)
  d.root.position.set(t.position.x, t.position.y, t.position.z)
  // Full reset, not just `.y`: a gizmo writes the quaternion, and for a yaw past 90 deg the
  // Euler it decomposes to has x = z = pi. Setting only `.y` would leave the model upside down.
  d.root.rotation.set(0, t.rotationY, 0)
}

/** Every skinned mesh in a model: a character may be split into body / head / hair rigs. */
function disposeSkeletons(root: THREE.Object3D): void {
  root.traverse(obj => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) (obj as THREE.SkinnedMesh).skeleton.dispose()
  })
}

export function createNpcDisplayRegistry(opts: NpcDisplayRegistryOptions): NpcDisplayRegistry {
  const group = new THREE.Group()
  group.name = 'npc-display'
  const cloneModel = opts.cloneModel ?? ((s: THREE.Object3D) => cloneSkinned(s))

  const cache = new Map<string, CacheEntry>()
  const states = new Map<string, EntityState>()

  function acquire(url: string): CacheEntry {
    const hit = cache.get(url)
    if (hit && !hit.dead) {
      hit.refs++
      return hit
    }
    const entry: CacheEntry = { refs: 1, dead: false, template: null, promise: Promise.resolve(null) }
    entry.promise = opts.loadGltf(url).then(gltf => {
      // Every holder let go while this was in flight: nobody will use the result.
      if (entry.dead) {
        disposeTemplate(gltf.scene)
        return null
      }
      gltf.scene.updateMatrixWorld(true)
      const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y
      const rest = (firstSkinned(gltf.scene)?.skeleton.bones ?? []).map(b => ({
        p: b.position.clone(),
        q: b.quaternion.clone(),
        s: b.scale.clone(),
      }))
      entry.template = { scene: gltf.scene, baseScale: baseScaleFor(height), rest }
      return entry.template
    })
    cache.set(url, entry)
    return entry
  }

  function release(url: string): void {
    const entry = cache.get(url)
    if (!entry) return
    entry.refs--
    if (entry.refs > 0) return
    entry.dead = true
    cache.delete(url)
    if (entry.template) disposeTemplate(entry.template.scene)
  }

  function removeState(id: string): void {
    const st = states.get(id)
    if (!st) return
    states.delete(id)
    const holdsRef = !st.cancelled
    st.cancelled = true
    if (st.display) {
      group.remove(st.display.root)
      // Each cloned skeleton owns a GPU bone texture; geometry/materials are shared.
      disposeSkeletons(st.display.root)
      st.display = null
    }
    // A failed load already released its reference; do not release twice.
    if (holdsRef) release(st.url)
  }

  function start(entry: NpcDisplayEntry): EntityState {
    const cacheEntry = acquire(entry.assetUrl)
    const st: EntityState = {
      url: entry.assetUrl,
      entry,
      cancelled: false,
      display: null,
      rest: [],
      appliedPose: undefined,
      done: Promise.resolve(),
    }
    const fail = (err: unknown): void => {
      console.warn(`[NpcDisplay] load failed for "${entry.entityId}" (${entry.assetUrl}):`, err)
      // Keep the (display-less) state so an unchanged entry is not retried on every
      // reconcile; a URL change or a remove/re-add starts a fresh attempt.
      if (!st.cancelled) {
        st.cancelled = true
        release(st.url)
      }
    }
    st.done = cacheEntry.promise.then(template => {
      if (st.cancelled || states.get(entry.entityId) !== st || !template) return
      // Everything below can throw (a malformed override, a clone failure): it must
      // take the same release-and-warn path as a failed load, not reject reconcile().
      let root: THREE.Object3D | null = null
      try {
        root = cloneModel(template.scene)
        const display: MutableDisplay = {
          entityId: entry.entityId,
          assetUrl: entry.assetUrl,
          root,
          skinned: firstSkinned(root),
          baseScale: template.baseScale,
        }
        st.rest = template.rest
        // Latest entry wins: it may have changed while the load was in flight.
        applyTransform(display, st.entry)
        applyPose(display.skinned, st.rest, st.entry.poseOverride)
        st.appliedPose = st.entry.poseOverride
        group.add(root)
        st.display = display
      } catch (err) {
        if (root) disposeSkeletons(root)
        fail(err)
      }
    }, fail)
    return st
  }

  return {
    group,

    reconcile(entries) {
      const wanted = new Set(entries.map(e => e.entityId))
      for (const id of [...states.keys()]) {
        if (!wanted.has(id)) removeState(id)
      }
      const pending: Promise<void>[] = []
      for (const entry of entries) {
        let st = states.get(entry.entityId)
        if (st && st.url !== entry.assetUrl) {
          removeState(entry.entityId)
          st = undefined
        }
        if (!st) {
          st = start(entry)
          states.set(entry.entityId, st)
        } else {
          st.entry = entry
          if (st.display) {
            applyTransform(st.display, entry)
            if (entry.poseOverride !== st.appliedPose) {
              applyPose(st.display.skinned, st.rest, entry.poseOverride)
              st.appliedPose = entry.poseOverride
            }
          }
        }
        pending.push(st.done)
      }
      return Promise.all(pending).then(() => undefined)
    },

    get: id => states.get(id)?.display ?? undefined,
    settled: id => states.get(id)?.done ?? Promise.resolve(),

    restoreAuthoredPose(id, poseOverride) {
      const st = states.get(id)
      if (!st?.display) return
      applyPose(st.display.skinned, st.rest, poseOverride)
      st.appliedPose = poseOverride
    },

    clear() {
      for (const id of [...states.keys()]) removeState(id)
    },

    dispose() {
      for (const id of [...states.keys()]) removeState(id)
    },
  }
}
