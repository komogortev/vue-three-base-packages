import * as THREE from 'three'
import { BaseModule } from '@base/engine-core'
import type { ShellContext } from '@base/engine-core'
import { ThreeEntityManager } from './ThreeEntityManager'
import { AssetLoader } from './AssetLoader'
import type { ThreeContext } from './types'

/**
 * Top-level Three.js engine module. Mount this from the shell via ModuleMount.vue.
 *
 * Responsibilities:
 * - Creates and owns the WebGLRenderer, Scene, PerspectiveCamera, and Clock
 * - Runs the RAF loop: registered systems → engine:frame event → render()
 * - Observes container resize and updates renderer + camera aspect
 * - Provides ThreeContext to child modules via buildChildContext()
 * - Disposes all GPU resources on unmount
 *
 * Extension point: override render() in a subclass to swap in EffectComposer
 * without changing the loop logic.
 */
export class ThreeModule extends BaseModule {
  readonly id = 'threejs-engine'

  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private clock!: THREE.Clock
  private entityManager!: ThreeEntityManager
  private assetLoader!: AssetLoader

  private rafId = 0
  private resizeObserver!: ResizeObserver
  private systems = new Map<string, (delta: number) => void>()

  // ─── Mount / Unmount ────────────────────────────────────────────────────────

  protected async onMount(container: HTMLElement, context: ShellContext): Promise<void> {
    const w = container.clientWidth
    const h = container.clientHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(w, h)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000)
    this.clock = new THREE.Clock()

    this.entityManager = new ThreeEntityManager(this.scene, context.eventBus)
    this.assetLoader = new AssetLoader(context.eventBus)

    this.resizeObserver = new ResizeObserver(() => this.onResize(container))
    this.resizeObserver.observe(container)

    this.clock.start()
    this.loop()

    context.eventBus.emit('engine:ready')
  }

  protected async onUnmount(): Promise<void> {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()

    this.entityManager.destroyAll()
    this.assetLoader.dispose()
    this.systems.clear()

    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ─── RAF Loop ───────────────────────────────────────────────────────────────

  private loop(): void {
    this.rafId = requestAnimationFrame(() => this.loop())
    const delta = this.clock.getDelta()

    // 1. Run registered systems in deterministic order
    for (const fn of this.systems.values()) fn(delta)

    // 2. Loose-coupling hook — child modules that prefer events over systems
    this.context.eventBus.emit('engine:frame', delta)

    // 3. Render — override this method to plug in EffectComposer
    this.render(delta)
  }

  /**
   * Override in a subclass to replace the default render call.
   * Called once per frame after all systems have run.
   *
   * @example
   * protected render(_delta: number): void {
   *   this.composer.render()
   * }
   */
  protected render(_delta: number): void {
    this.renderer.render(this.scene, this.camera)
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────

  private onResize(container: HTMLElement): void {
    const w = container.clientWidth
    const h = container.clientHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.context.eventBus.emit('engine:resize', { width: w, height: h })
  }

  // ─── System Registration ─────────────────────────────────────────────────────

  /**
   * Register a named per-frame update function.
   * Systems run in registration order, before rendering.
   * Returns an unsubscribe function — call it in your module's onUnmount().
   */
  registerSystem(id: string, fn: (delta: number) => void): () => void {
    this.systems.set(id, fn)
    return () => this.systems.delete(id)
  }

  // ─── Child Context ───────────────────────────────────────────────────────────

  protected buildChildContext(): ThreeContext {
    return {
      ...(this.context as ShellContext),
      host: this,
      entityManager: this.entityManager,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      clock: this.clock,
      assets: this.assetLoader,
      registerSystem: (id, fn) => this.registerSystem(id, fn),
    }
  }
}
