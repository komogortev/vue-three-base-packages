import type { InputEmitter } from './types'

export interface PointerLookProviderOptions {
  /** Radians per horizontal pixel (pointer lock). Mouse right → negative yaw delta (matches body/camera `rotation.y` + facing). */
  sensitivityX?: number
  /** Radians per vertical pixel; applied to pitch (inverted so mouse-up looks up). */
  sensitivityY?: number
}

/**
 * Emits `input:axis` `look` while the pointer is locked on {@link target}.
 * Click the target to call `requestPointerLock()`; Esc exits lock in browsers.
 *
 * Values are **delta radians this frame** (same convention as gamepad look after dt scaling).
 */
export class PointerLookProvider {
  private accX = 0
  private accY = 0
  private readonly cleanup: Array<() => void> = []

  constructor(
    private readonly target: HTMLElement,
    private readonly emit: InputEmitter,
    private readonly opts: PointerLookProviderOptions = {},
  ) {}

  mount(): void {
    const sensX = this.opts.sensitivityX ?? 0.0022
    const sensY = this.opts.sensitivityY ?? 0.0022

    const onMove = (e: MouseEvent): void => {
      if (document.pointerLockElement !== this.target) return
      // movementX > 0 = mouse right → subtract yaw so view turns right (facing decreases for this rig).
      this.accX -= e.movementX * sensX
      // Positive movementY (mouse down) → negative pitch delta so Three.js YXZ pitch-up is negative x.
      this.accY -= e.movementY * sensY
    }

    const onClick = (): void => {
      if (document.pointerLockElement === this.target) return
      void this.target.requestPointerLock()
    }

    document.addEventListener('mousemove', onMove)
    this.target.addEventListener('click', onClick)

    this.cleanup.push(
      () => document.removeEventListener('mousemove', onMove),
      () => this.target.removeEventListener('click', onClick),
    )
  }

  /** True when this provider’s element currently owns the pointer lock. */
  isLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.target
  }

  unmount(): void {
    for (const off of this.cleanup) off()
    this.cleanup.length = 0
    this.accX = 0
    this.accY = 0
    if (document.pointerLockElement === this.target) {
      document.exitPointerLock()
    }
  }

  /**
   * Call once per frame after gamepad poll. Emits look only when the pointer is locked on target.
   */
  flush(): void {
    if (document.pointerLockElement !== this.target) {
      this.accX = 0
      this.accY = 0
      return
    }
    const x = this.accX
    const y = this.accY
    this.accX = 0
    this.accY = 0
    if (x === 0 && y === 0) return
    this.emit({ axis: 'look', value: { x, y } })
  }
}
