import type { GamepadBindings, ButtonAction, InputEmitter } from './types'

/**
 * Polls the Gamepad API each frame and maps axes/buttons to abstract InputActions.
 *
 * Axis values are deadzone-corrected and re-normalized after deadzone removal.
 * Button state is tracked to emit 'pressed' / 'released' transitions rather than
 * continuously firing while held.
 *
 * Uses the first connected gamepad found via `navigator.getGamepads()`.
 * Multiple gamepad support can be added in a future version.
 */
export class GamepadProvider {
  /** Map of button index → pressed state from last poll, to detect transitions */
  private readonly prevButtons = new Map<number, boolean>()

  constructor(
    private readonly bindings: GamepadBindings,
    private readonly deadzoneThreshold: number,
    private readonly emit: InputEmitter,
  ) {}

  /**
   * Called every frame by InputModule's poll loop.
   * Reads gamepad state, emits axis and button events.
   */
  poll(): void {
    const gp = this.findActiveGamepad()
    if (!gp) return

    this.pollAxes(gp)
    this.pollButtons(gp)
  }

  reset(): void {
    this.prevButtons.clear()
  }

  private findActiveGamepad(): Gamepad | null {
    for (const gp of navigator.getGamepads()) {
      if (gp?.connected) return gp
    }
    return null
  }

  private pollAxes(gp: Gamepad): void {
    const b = this.bindings

    const mx = this.applyDeadzone(gp.axes[b.moveAxis.x] ?? 0)
    const my = this.applyDeadzone(-(gp.axes[b.moveAxis.y] ?? 0)) // invert Y: stick up → positive
    this.emit({ axis: 'move', value: { x: mx, y: my } })

    const sprint = (b.sprintHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    const crouch = (b.crouchHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    const jog = (b.jogHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    this.emit({ axis: 'locomotion', value: { x: sprint, y: crouch, z: jog } })

    const lx = this.applyDeadzone(gp.axes[b.lookAxis.x] ?? 0)
    const ly = this.applyDeadzone(-(gp.axes[b.lookAxis.y] ?? 0))
    this.emit({ axis: 'look', value: { x: lx, y: ly } })
  }

  private pollButtons(gp: Gamepad): void {
    const buttonMap: Array<[ButtonAction, number[]]> = [
      ['interact', this.bindings.interact],
      ['pause',    this.bindings.pause],
      ['confirm',  this.bindings.confirm],
      ['cancel',   this.bindings.cancel],
      ['jump',     this.bindings.jump],
    ]

    for (const [action, indices] of buttonMap) {
      for (const idx of indices) {
        const btn = gp.buttons[idx]
        if (btn === undefined) continue

        const wasPressed = this.prevButtons.get(idx) ?? false
        const isPressed  = btn.pressed

        if (isPressed && !wasPressed) this.emit({ action, type: 'pressed' })
        if (!isPressed && wasPressed) this.emit({ action, type: 'released' })

        this.prevButtons.set(idx, isPressed)
      }
    }
  }

  private applyDeadzone(value: number): number {
    if (Math.abs(value) < this.deadzoneThreshold) return 0
    // Re-normalize: map [deadzone, 1] → [0, 1] to keep full range after deadzone removal
    const sign = value > 0 ? 1 : -1
    return sign * (Math.abs(value) - this.deadzoneThreshold) / (1 - this.deadzoneThreshold)
  }
}
