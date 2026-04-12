import { BaseModule } from '@base/engine-core'
import type { ShellContext } from '@base/engine-core'
import { KeyboardProvider } from './KeyboardProvider'
import { GamepadProvider } from './GamepadProvider'
import { TouchProvider } from './TouchProvider'
import { PointerLookProvider, type PointerLookProviderOptions } from './PointerLookProvider'
import { DEFAULT_BINDINGS } from './types'
import type { InputBindings, InputEvent } from './types'

/** Optional behaviour for {@link InputModule}. */
export interface InputModuleOptions {
  /**
   * When false, the full-screen touch overlay is not mounted.
   * Use in desktop editors: the overlay sits above the canvas and blocks mouse events (e.g. OrbitControls).
   * Default **true** (unchanged for game views).
   */
  enableTouchOverlay?: boolean
  /**
   * When true, click the mount `container` to use pointer lock and emit `look` from mouse movement.
   * Disable in scene editors that rely on OrbitControls. Default **false**.
   */
  enablePointerLook?: boolean
  /** Passed through to {@link PointerLookProvider}. */
  pointerLookOptions?: PointerLookProviderOptions
}

/**
 * Input child module. Mount as a child of ThreeModule (or any EngineModule host).
 *
 * Orchestrates three providers:
 * - KeyboardProvider: keydown/keyup → button actions + move axis (via tick)
 * - GamepadProvider:  Gamepad API poll → button actions + move/look axes
 * - TouchProvider:    touch events → move axis + interact action
 * - PointerLookProvider (optional): pointer lock on mount container → `look` axis (desktop FPS)
 *
 * Emits on context.eventBus:
 * - `input:action`  — { action: ButtonAction, type: 'pressed' | 'released' } (includes optional `ability_*` / `toggle_camera` when bound)
 * - `input:axis`    — value `{ x, y, z? }` (`locomotion`: sprint=x, crouch=y, jog/slow-run=z; default crouch **C**, jog **V**)
 *
 * Both keyboard move-axis and gamepad axes fire every frame via the poll loop.
 * Button events fire only on state transitions (pressed / released).
 *
 * @example
 * // Mount alongside other engine children
 * await engine.mountChild('input', new InputModule())
 *
 * // Listen in any child module
 * context.eventBus.on('input:action', (e) => {
 *   const { action, type } = e as InputActionEvent
 *   if (action === 'jump' && type === 'pressed') player.jump()
 * })
 */
export class InputModule extends BaseModule {
  readonly id = 'input'

  private keyboard!: KeyboardProvider
  private gamepad!: GamepadProvider
  private touch: TouchProvider | null = null
  private pointerLook: PointerLookProvider | null = null
  private rafId = 0
  private lastPollMs = 0

  constructor(
    private readonly bindings: InputBindings = DEFAULT_BINDINGS,
    private readonly moduleOptions: InputModuleOptions = {},
  ) {
    super()
  }

  protected async onMount(container: HTMLElement, context: ShellContext): Promise<void> {
    const emit = (event: InputEvent): void => {
      if ('action' in event) {
        context.eventBus.emit('input:action', event)
      } else {
        context.eventBus.emit('input:axis', event)
      }
    }

    this.keyboard = new KeyboardProvider(this.bindings.keyboard, emit)
    this.keyboard.mount()

    this.gamepad = new GamepadProvider(this.bindings.gamepad, this.bindings.deadzone, emit)

    if (this.moduleOptions.enableTouchOverlay !== false) {
      this.touch = new TouchProvider(emit)
      this.touch.mount(container)
    }

    if (this.moduleOptions.enablePointerLook === true) {
      this.pointerLook = new PointerLookProvider(container, emit, this.moduleOptions.pointerLookOptions)
      this.pointerLook.mount()
    }

    this.lastPollMs = performance.now()
    this.pollLoop()
  }

  protected async onUnmount(): Promise<void> {
    cancelAnimationFrame(this.rafId)
    this.keyboard.unmount()
    this.touch?.unmount()
    this.touch = null
    this.pointerLook?.unmount()
    this.pointerLook = null
    this.gamepad.reset()
  }

  private pollLoop(): void {
    this.rafId = requestAnimationFrame(() => this.pollLoop())
    const now = performance.now()
    const dt = this.lastPollMs > 0 ? Math.min(0.05, (now - this.lastPollMs) / 1000) : 1 / 60
    this.lastPollMs = now

    this.keyboard.tick()
    const skipGamepadLook = this.pointerLook?.isLocked() ?? false
    this.gamepad.poll(dt, skipGamepadLook)
    this.pointerLook?.flush()
  }
}
