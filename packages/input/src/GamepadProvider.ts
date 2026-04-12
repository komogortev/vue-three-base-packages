import type { GamepadBindings, ButtonAction, InputEmitter } from './types'

/** ~rad/s at full stick deflection for look yaw (horizontal). */
const GAMEPAD_LOOK_YAW_RATE = 2.4
/** ~rad/s at full stick deflection for look pitch (vertical). */
const GAMEPAD_LOOK_PITCH_RATE = 1.75

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
   *
   * @param dtSeconds  Frame delta (seconds) — scales right-stick look to rad/frame.
   * @param skipLook   When true (e.g. pointer lock for mouse look), do not emit `look`.
   */
  poll(dtSeconds: number, skipLook = false): void {
    const gp = this.findActiveGamepad()
    if (!gp) return

    this.pollAxes(gp, dtSeconds, skipLook)
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

  private pollAxes(gp: Gamepad, dtSeconds: number, skipLook: boolean): void {
    const b = this.bindings

    const mx = this.applyDeadzone(gp.axes[b.moveAxis.x] ?? 0)
    const my = this.applyDeadzone(-(gp.axes[b.moveAxis.y] ?? 0)) // invert Y: stick up → positive
    this.emit({ axis: 'move', value: { x: mx, y: my } })

    const sprint = (b.sprintHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    const crouch = (b.crouchHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    const jog = (b.jogHold ?? []).some((i) => gp.buttons[i]?.pressed) ? 1 : 0
    this.emit({ axis: 'locomotion', value: { x: sprint, y: crouch, z: jog } })

    if (skipLook) return

    const lx = this.applyDeadzone(gp.axes[b.lookAxis.x] ?? 0)
    const ly = this.applyDeadzone(-(gp.axes[b.lookAxis.y] ?? 0))
    const dt = Math.max(0, dtSeconds)
    this.emit({
      axis: 'look',
      value: {
        // Stick right (lx > 0) → negative yaw delta; matches pointer look + body `rotation.y` / facing.
        x: -lx * GAMEPAD_LOOK_YAW_RATE * dt,
        y: ly * GAMEPAD_LOOK_PITCH_RATE * dt,
      },
    })
  }

  private pollButtons(gp: Gamepad): void {
    const buttonMap: Array<[ButtonAction, number[]]> = [
      ['interact', this.bindings.interact],
      ['pause',    this.bindings.pause],
      ['confirm',  this.bindings.confirm],
      ['cancel',   this.bindings.cancel],
      ['jump',     this.bindings.jump],
      ['ability_primary',   this.bindings.ability_primary],
      ['ability_secondary', this.bindings.ability_secondary],
      ['toggle_camera',     this.bindings.toggle_camera],
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
