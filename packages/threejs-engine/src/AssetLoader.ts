import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { EventBus } from '@base/engine-core'

export type { GLTF }

/**
 * Centralized asset loader for the Three.js engine.
 *
 * - GLTF: loaded on demand, not cached (GLTF scenes are mutable — cache the clone, not the original)
 * - Textures: cached by URL — safe to share across materials
 * - Emits `assets:progress` during loading and `assets:complete` on success
 *
 * Disposal: call dispose() in ThreeModule.onUnmount() to release cached textures.
 */
export class AssetLoader {
  private readonly textureCache = new Map<string, THREE.Texture>()
  private readonly gltfLoader = new GLTFLoader()
  private readonly textureLoader = new THREE.TextureLoader()

  constructor(private readonly eventBus: EventBus) {}

  /**
   * Load a GLTF/GLB file. The returned GLTF is not cached — callers are
   * responsible for cloning the scene if they need multiple instances:
   * `gltf.scene.clone(true)` for a deep clone.
   */
  async loadGLTF(url: string): Promise<GLTF> {
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
    for (const texture of this.textureCache.values()) {
      texture.dispose()
    }
    this.textureCache.clear()
  }
}
