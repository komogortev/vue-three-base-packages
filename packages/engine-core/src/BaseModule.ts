import { EventBus } from './EventBus'
import type { EngineModule, ShellContext, EngineContext } from './types'

/**
 * Abstract base class for all @base modules.
 * Provides EventBus wiring and child-slot management out of the box.
 * Extend this instead of implementing EngineModule from scratch.
 *
 * Usage:
 *   export class MyModule extends BaseModule {
 *     readonly id = 'my-module'
 *     async onMount(container, context) { ... }
 *     async onUnmount() { ... }
 *   }
 */
export abstract class BaseModule implements EngineModule {
  abstract readonly id: string

  protected readonly bus = new EventBus()
  protected context!: ShellContext | EngineContext
  protected container!: HTMLElement

  private children = new Map<string, EngineModule>()

  async mount(container: HTMLElement, context: ShellContext | EngineContext): Promise<void> {
    this.container = container
    this.context = context
    await this.onMount(container, context)
  }

  async unmount(): Promise<void> {
    for (const [slot, child] of this.children) {
      await child.unmount()
      this.children.delete(slot)
    }
    await this.onUnmount()
    this.bus.clear()
  }

  on(event: string, handler: (...args: unknown[]) => void): () => void {
    return this.bus.on(event, handler)
  }

  emit(event: string, ...args: unknown[]): void {
    this.bus.emit(event, ...args)
  }

  async mountChild(slot: string, module: EngineModule): Promise<void> {
    if (this.children.has(slot)) {
      await this.children.get(slot)!.unmount()
    }
    this.children.set(slot, module)
    await module.mount(this.container, this.buildChildContext())
  }

  async unmountChild(slot: string): Promise<void> {
    const child = this.children.get(slot)
    if (child) {
      await child.unmount()
      this.children.delete(slot)
    }
  }

  getChild(slot: string): EngineModule | undefined {
    return this.children.get(slot)
  }

  /**
   * Override to provide an enriched context to child modules.
   * Engine hosts (e.g. threejs-engine) override this to inject renderer, scene, entityManager.
   */
  protected buildChildContext(): ShellContext | EngineContext {
    return this.context
  }

  protected abstract onMount(container: HTMLElement, context: ShellContext | EngineContext): Promise<void>
  protected abstract onUnmount(): Promise<void>
}
