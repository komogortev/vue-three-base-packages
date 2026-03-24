import type { KeyboardBindings, ButtonAction, InputEmitter } from './types'

/**
 * Ctrl/Meta + WASD: bookmark, close tab, save page, select all.
 * **Chromium ignores `preventDefault()` for Ctrl+W** (and several others); default crouch is **KeyC** in `DEFAULT_BINDINGS`.
 * This still helps some chords in other browsers and when users add Ctrl to crouch binds.
 */
const BROWSER_CHORD_CODES_CROUCH_WASD = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])

function isBrowserChordOverridingCrouchMove(e: KeyboardEvent): boolean {
  if (!e.ctrlKey && !e.metaKey) return false
  return BROWSER_CHORD_CODES_CROUCH_WASD.has(e.code)
}

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
      if (isBrowserChordOverridingCrouchMove(e)) {
        e.preventDefault()
      }
      if (e.repeat) return
      this.held.add(e.code)
      this.checkButton(e.code, 'pressed')
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      this.held.delete(e.code)
      this.checkButton(e.code, 'released')
    }

    const opts: AddEventListenerOptions = { capture: true }
    window.addEventListener('keydown', onKeyDown, opts)
    window.addEventListener('keyup', onKeyUp, opts)

    this.cleanup.push(
      () => window.removeEventListener('keydown', onKeyDown, opts),
      () => window.removeEventListener('keyup', onKeyUp, opts),
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

    const kb = this.bindings
    const sprint = kb.sprint.some((k) => this.held.has(k)) ? 1 : 0
    const crouch = kb.crouch.some((k) => this.held.has(k)) ? 1 : 0
    const jog = (kb.jog ?? []).some((k) => this.held.has(k)) ? 1 : 0
    this.emit({ axis: 'locomotion', value: { x: sprint, y: crouch, z: jog } })
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
