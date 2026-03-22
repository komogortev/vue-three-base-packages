import type { EventBus } from './EventBus'

/**
 * Context provided by the pwa-platform shell to any top-level module.
 * Modules receive this on mount and may use it to communicate upward.
 */
export interface ShellContext {
  /** Shared event bus for cross-module and shell-to-module communication */
  eventBus: EventBus
  /** Current locale string (e.g. 'en', 'fr') */
  locale: string
  /** Navigate shell routes programmatically */
  navigate(path: string): void
}

/**
 * Context provided by a host module (e.g. threejs-engine) to its child modules.
 * Extends ShellContext with engine-level primitives.
 * The concrete engine package (e.g. @base/threejs-engine) will extend this further.
 */
export interface EngineContext extends ShellContext {
  /** The host module that created this context */
  host: EngineModule
  /** Engine-level entity manager — host provides the concrete implementation */
  entityManager: EntityManager
}

/**
 * Minimal entity manager interface. The engine host provides the implementation.
 * Child modules call these to interact with the 3D world.
 */
export interface EntityManager {
  create(id: string, components?: Record<string, unknown>): string
  destroy(id: string): void
  get(id: string): Record<string, unknown> | undefined
  query(componentKeys: string[]): string[]
}

/**
 * The universal mount contract. Every module in the @base ecosystem
 * implements this interface — whether it is mounted by the shell or by another module.
 */
export interface EngineModule {
  /** Unique stable identifier for this module (e.g. 'threejs-engine', 'game-logic') */
  readonly id: string

  /**
   * Called when the parent mounts this module.
   * @param container - The DOM element to render into
   * @param context   - Shell or engine context from the parent
   */
  mount(container: HTMLElement, context: ShellContext | EngineContext): Promise<void>

  /** Called when the parent unmounts this module. Must clean up all resources. */
  unmount(): Promise<void>

  /** Subscribe to a module-level event */
  on(event: string, handler: (...args: unknown[]) => void): () => void

  /** Emit a module-level event */
  emit(event: string, ...args: unknown[]): void

  /**
   * Optional — implement if this module can itself host child modules.
   * Makes the module a composite host (e.g. threejs-engine hosting game-logic).
   */
  mountChild?(slot: string, module: EngineModule): Promise<void>
  unmountChild?(slot: string): Promise<void>
  getChild?(slot: string): EngineModule | undefined
}
