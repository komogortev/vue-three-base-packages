import type { KeyboardBindings, ButtonAction, InputEmitter } from './types'

/**
 * Maps keyboard events to abstract InputActions and move-axis values.
 *
 * - Button actions (interact, pause, confirm, cancel, jump) fire on keydown/keyup.
 * - Move axis is recalculated each tick() from currently held keys and emitted
 *   as `input:axis { axis: 'move', value }`. This must be called every frame.
 */
export class KeyboardProvider {
  private readonly held = new Set<string>()
  private readonly cleanup: Array<() => void> = []

  constructor(
    private readonly bindings: KeyboardBindings,
    private readonly emit: InputEmitter,
  ) {}

  mount(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return
      this.held.add(e.code)
      this.checkButton(e.code, 'pressed')
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      this.held.delete(e.code)
      this.checkButton(e.code, 'released')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    this.cleanup.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
    )
  }

  /**
   * Called every frame by InputModule's poll loop.
   * Emits the current move-axis vector derived from held keys.
   */
  tick(): void {
    const b = this.bindings.move
    let x = 0
    let y = 0

    if (b.up.some((k) => this.held.has(k))) y += 1
    if (b.down.some((k) => this.held.has(k))) y -= 1
    if (b.right.some((k) => this.held.has(k))) x += 1
    if (b.left.some((k) => this.held.has(k))) x -= 1

    // Normalize diagonal movement
    if (x !== 0 && y !== 0) {
      const len = Math.sqrt(x * x + y * y)
      x /= len
      y /= len
    }

    this.emit({ axis: 'move', value: { x, y } })
  }

  unmount(): void {
    for (const off of this.cleanup) off()
    this.cleanup.length = 0
    this.held.clear()
  }

  private checkButton(code: string, type: 'pressed' | 'released'): void {
    const b = this.bindings
    const checks: Array<[ButtonAction, string[]]> = [
      ['interact', b.interact],
      ['pause',    b.pause],
      ['confirm',  b.confirm],
      ['cancel',   b.cancel],
      ['jump',     b.jump],
    ]
    for (const [action, keys] of checks) {
      if (keys.includes(code)) {
        this.emit({ action, type })
      }
    }
  }
}
