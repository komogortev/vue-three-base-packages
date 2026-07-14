import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { EventBus } from '@base/engine-core'
import { localDracoDecoderPath, resetDracoLoaderOnInitFailure } from './dracoDecoder'

export type { GLTF }

/**
 * Wraps a loaded GLTF scene in a corrective pivot group so that feet land at Y=0
 * and the mesh is centered on XZ — the player-three character convention.
 *
 * Use this on Rodin / Tripo-sourced GLBs before handing to CharacterAnimationRig.
 * Pipeline-processed GLBs (via optimize-glb.sh --pivot bottom) won't need it, but
 * calling it on an already-clean model is safe (pivot offset will be ~0).
 *
 * AnimationMixer safety: Three.js resolves bones by Object3D.name traversal, not
 * depth — the extra pivot wrapper does not break AnimationClip bone path resolution.
 */
export function normalizeGLTFOrigin(scene: THREE.Group): THREE.Group {
  const box = new THREE.Box3().setFromObject(scene)
  if (box.isEmpty()) {
    console.warn('[AssetLoader] normalizeGLTFOrigin: bounding box is empty — model has no geometry, returning scene unchanged')
    return scene
  }
  const height = box.max.y - box.min.y
  if (height > 5 || height < 0.5) {
    console.warn(`[AssetLoader] normalizeGLTFOrigin: suspicious height ${height.toFixed(2)}m — check model scale`)
  }
  const pivot = new THREE.Group()
  scene.position.set(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  )
  pivot.add(scene)
  return pivot
}

/** Result of {@link AssetLoader.loadFBX} — Mixamo and other FBX sources. */
export interface FBXRoot {
  group: THREE.Group
  animations: THREE.AnimationClip[]
}

/**
 * {@link FBXLoader} warns on almost every Mixamo file; behaviour is already handled (truncate weights,
 * skip unsupported Phong maps). Filter only these templates so other FBX warnings still show.
 */
const FBX_LOADER_WARN_SUPPRESS = [
  /^THREE\.FBXLoader: Vertex has more than 4 skinning weights/i,
  /^THREE\.FBXLoader: %s map is not supported in three\.js, skipping texture\./i,
] as const

function shouldSuppressFbxLoaderWarn(args: unknown[]): boolean {
  const head = args[0]
  if (typeof head !== 'string') return false
  return FBX_LOADER_WARN_SUPPRESS.some((re) => re.test(head))
}

/** Runs `fn` while filtering the two noisy warnings above from `console.warn`. */
function withFbxLoaderWarnFilter<T>(fn: () => Promise<T>): Promise<T> {
  const prev = console.warn
  console.warn = (...args: unknown[]) => {
    if (shouldSuppressFbxLoaderWarn(args)) return
    prev.apply(console, args as Parameters<typeof console.warn>)
  }
  return fn().finally(() => {
    console.warn = prev
  })
}

/**
 * Centralized asset loader for the Three.js engine.
 *
 * - GLTF: loaded on demand, not cached (GLTF scenes are mutable — cache the clone, not the original)
 * - FBX: via `FBXLoader` (Mixamo default) — returns a `Group` + `animations`; not cached
 * - GLTFLoader is wired with **Draco** + **Meshopt** decoders (lazy init on first GLTF load)
 * - Textures: cached by URL — safe to share across materials
 * - Emits `assets:progress` during loading and `assets:complete` on success
 *
 * Disposal: call dispose() in ThreeModule.onUnmount() to release cached textures.
 */
export class AssetLoader {
  private readonly textureCache = new Map<string, THREE.Texture>()
  private readonly gltfLoader = new GLTFLoader()
  private readonly fbxLoader = new FBXLoader()
  private readonly textureLoader = new THREE.TextureLoader()

  private dracoLoader: DRACOLoader | null = null
  /** Ensures Draco + Meshopt are registered on GLTFLoader once. */
  private gltfExtensionsReady: Promise<void> | null = null

  constructor(private readonly eventBus: EventBus) {}

  private initGltfLoaderExtensions(): Promise<void> {
    if (this.gltfExtensionsReady === null) {
      this.gltfExtensionsReady = (async (): Promise<void> => {
        const draco = new DRACOLoader()
        draco.setDecoderPath(localDracoDecoderPath())
        this.dracoLoader = draco
        this.gltfLoader.setDRACOLoader(draco)
        // Kick off decoder init now and reset ONLY on a decoder-init failure — a
        // failed Draco fetch otherwise stays poisoned in DRACOLoader's cached
        // promise until page reload (CodeReview 2026-07-11, problem 2). Scoping
        // the reset to the decoder (not to every GLTF load error) means a plain
        // model 404 can't dispose a decoder a concurrent Draco load is using.
        draco.preload()
        resetDracoLoaderOnInitFailure(draco, () => this.resetGltfLoaderExtensions(draco))
        await MeshoptDecoder.ready
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
      })().catch((err) => {
        // Don't leave a rejected promise cached — the meshopt/decoder init would
        // then fail every future load with no retry. Clear so the next call rebuilds.
        this.resetGltfLoaderExtensions(this.dracoLoader)
        throw err
      })
    }
    return this.gltfExtensionsReady
  }

  /**
   * Dispose the Draco decoder + clear the extension-init cache so the next
   * {@link loadGLTF} rebuilds a fresh DRACOLoader. `expected` guards against a
   * late/duplicate reset clobbering a decoder a newer init has already installed.
   */
  private resetGltfLoaderExtensions(expected: DRACOLoader | null): void {
    if (this.dracoLoader !== expected) return
    this.dracoLoader?.dispose()
    this.dracoLoader = null
    this.gltfExtensionsReady = null
  }

  /**
   * Load a GLTF/GLB file. The returned GLTF is not cached — callers are
   * responsible for cloning the scene if they need multiple instances:
   * `gltf.scene.clone(true)` for a deep clone.
   */
  async loadGLTF(url: string): Promise<GLTF> {
    await this.initGltfLoaderExtensions()
    return new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          this.eventBus.emit('assets:complete', { url, type: 'gltf' })
          resolve(gltf)
        },
        (event) => {
          this.eventBus.emit('assets:progress', {
            url,
            type: 'gltf',
            loaded: event.loaded,
            total: event.total,
          })
        },
        (error) => {
          console.error(`[AssetLoader] Failed to load GLTF: ${url}`, error)
          reject(error)
        },
      )
    })
  }

  /**
   * Load FBX (e.g. Mixamo). Materials are often Phong/Lambert; consider converting to glTF
   * in Blender for smaller files and PBR — this path is for direct web use.
   */
  async loadFBX(url: string): Promise<FBXRoot> {
    return withFbxLoaderWarnFilter(
      () =>
        new Promise<FBXRoot>((resolve, reject) => {
          this.fbxLoader.load(
            url,
            (group) => {
              const animations = [...(group.animations ?? [])]
              this.eventBus.emit('assets:complete', { url, type: 'fbx' })
              resolve({ group, animations })
            },
            (event) => {
              this.eventBus.emit('assets:progress', {
                url,
                type: 'fbx',
                loaded: event.loaded,
                total: event.total,
              })
            },
            (error) => {
              console.error(`[AssetLoader] Failed to load FBX: ${url}`, error)
              reject(error)
            },
          )
        }),
    )
  }

  /**
   * Load a texture. Results are cached by URL — the same THREE.Texture instance
   * is returned on subsequent calls. Safe to share across materials.
   */
  async loadTexture(url: string): Promise<THREE.Texture> {
    const cached = this.textureCache.get(url)
    if (cached !== undefined) return cached

    return new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          this.textureCache.set(url, texture)
          this.eventBus.emit('assets:complete', { url, type: 'texture' })
          resolve(texture)
        },
        (event) => {
          this.eventBus.emit('assets:progress', {
            url,
            type: 'texture',
            loaded: event.loaded,
            total: event.total,
          })
        },
        (error) => {
          console.error(`[AssetLoader] Failed to load texture: ${url}`, error)
          reject(error)
        },
      )
    })
  }

  /** Dispose all cached textures. Called by ThreeModule.onUnmount(). */
  dispose(): void {
    this.dracoLoader?.dispose()
    this.dracoLoader = null
    this.gltfExtensionsReady = null

    for (const texture of this.textureCache.values()) {
      texture.dispose()
    }
    this.textureCache.clear()
  }
}
