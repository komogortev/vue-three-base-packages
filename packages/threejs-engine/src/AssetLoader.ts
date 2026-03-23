import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { EventBus } from '@base/engine-core'

export type { GLTF }

/**
 * Draco decoder served by Google — matches what three.js examples use.
 * Required for many Sketchfab / Blender-compressed GLBs.
 */
const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

/**
 * Centralized asset loader for the Three.js engine.
 *
 * - GLTF: loaded on demand, not cached (GLTF scenes are mutable — cache the clone, not the original)
 * - GLTFLoader is wired with **Draco** + **Meshopt** decoders (lazy init on first GLTF load)
 * - Textures: cached by URL — safe to share across materials
 * - Emits `assets:progress` during loading and `assets:complete` on success
 *
 * Disposal: call dispose() in ThreeModule.onUnmount() to release cached textures.
 */
export class AssetLoader {
  private readonly textureCache = new Map<string, THREE.Texture>()
  private readonly gltfLoader = new GLTFLoader()
  private readonly textureLoader = new THREE.TextureLoader()

  private dracoLoader: DRACOLoader | null = null
  /** Ensures Draco + Meshopt are registered on GLTFLoader once. */
  private gltfExtensionsReady: Promise<void> | null = null

  constructor(private readonly eventBus: EventBus) {}

  private initGltfLoaderExtensions(): Promise<void> {
    if (this.gltfExtensionsReady === null) {
      this.gltfExtensionsReady = (async (): Promise<void> => {
        this.dracoLoader = new DRACOLoader()
        this.dracoLoader.setDecoderPath(DRACO_DECODER_URL)
        this.gltfLoader.setDRACOLoader(this.dracoLoader)
        await MeshoptDecoder.ready
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
      })()
    }
    return this.gltfExtensionsReady
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
