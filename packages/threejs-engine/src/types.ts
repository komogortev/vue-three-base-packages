import type * as THREE from 'three'
import type { EngineContext } from '@base/engine-core'
import type { ThreeEntityManager } from './ThreeEntityManager'
import type { AssetLoader } from './AssetLoader'

/**
 * Context provided by ThreeModule to its child modules.
 * Extends EngineContext with Three.js rendering primitives and the system registration API.
 *
 * Child modules receive this as their `context` on mount and use it to:
 * - Register per-frame update systems via `registerSystem`
 * - Access and mutate the scene, camera, and renderer directly
 * - Create/destroy entities with managed Three.js lifecycle via `entityManager`
 * - Load GLTF models and textures via `assets`
 */
export interface ThreeContext extends EngineContext {
  /** The WebGL renderer. Avoid calling render() directly — the engine loop handles it. */
  renderer: THREE.WebGLRenderer

  /** The root Three.js scene. Direct access for lights, skyboxes, and objects outside ECS. */
  scene: THREE.Scene

  /** The perspective camera. Mutate position/rotation directly or via a camera rig system. */
  camera: THREE.PerspectiveCamera

  /** The engine clock. Use delta from registerSystem — avoid calling getDelta() manually. */
  clock: THREE.Clock

  /** Asset loader for GLTF models and textures, with caching and progress events. */
  assets: AssetLoader

  /**
   * Narrows entityManager to ThreeEntityManager, exposing addMesh, setTransform, setState.
   * The base EntityManager interface (create, destroy, get, query) is always available.
   */
  entityManager: ThreeEntityManager

  /**
   * Register a named update function that runs every frame BEFORE rendering, in registration order.
   * Returns an unsubscribe function — always call it in onUnmount() to avoid stale systems.
   *
   * @example
   * const off = ctx.registerSystem('player-movement', (delta) => {
   *   player.position.x += speed * delta
   * })
   * // in onUnmount: off()
   */
  registerSystem(id: string, fn: (delta: number) => void): () => void
}
