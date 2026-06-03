import type { InputEmitter } from './types'

interface JoystickState {
  touchId: number
  originX: number
  originY: number
}

/**
 * Maps touch events to abstract input actions using a split-screen layout:
 * - Left half of the container: virtual joystick → `input:axis move`
 * - Right half of the container: tap → `input:action interact`
 *
 * No visual elements are rendered in Phase 3 — touch areas are invisible.
 * A visual joystick overlay can be added in Phase 4 as a child component.
 *
 * The overlay div is appended to the container above the canvas (by DOM order).
 * `touch-action: none` disables browser default pan/zoom handling.
 */
export class TouchProvider {
  private overlay!: HTMLDivElement
  private container!: HTMLElement
  /** Saved so unmount() can restore the container's position style exactly as found. */
  private savedPosition = ''
  private joystick: JoystickState | null = null
  private readonly maxRadius = 64

  constructor(private readonly emit: InputEmitter) {}

  mount(container: HTMLElement): void {
    this.container = container
    this.savedPosition = container.style.position   // typically '' or 'absolute'

    this.overlay = document.createElement('div')
    this.overlay.style.cssText =
      'position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none;'

    // Ensure the overlay (position:absolute) has a positioning context.
    // Only set an INLINE position when none is already set inline — hosts that
    // position the container via a CSS class (e.g. Tailwind `absolute`) still get
    // the `relative` inline override here, which unmount() restores. The guard only
    // avoids clobbering a host's explicit *inline* position.
    if (!container.style.position) {
      container.style.position = 'relative'
    }
    container.appendChild(this.overlay)

    this.overlay.addEventListener('touchstart',  this.onTouchStart,  { passive: false })
    this.overlay.addEventListener('touchmove',   this.onTouchMove,   { passive: false })
    this.overlay.addEventListener('touchend',    this.onTouchEnd,    { passive: false })
    this.overlay.addEventListener('touchcancel', this.onTouchCancel, { passive: false })
  }

  unmount(): void {
    this.overlay.removeEventListener('touchstart',  this.onTouchStart)
    this.overlay.removeEventListener('touchmove',   this.onTouchMove)
    this.overlay.removeEventListener('touchend',    this.onTouchEnd)
    this.overlay.removeEventListener('touchcancel', this.onTouchCancel)
    this.overlay.remove()
    // Restore the container's position style so inline overrides don't persist
    // across unmount→remount cycles and corrupt the next mount's clientHeight.
    this.container.style.position = this.savedPosition
    this.joystick = null
  }

  // ─── Event handlers ──────────────────────────────────────────────────────────

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault()
    const rect = this.overlay.getBoundingClientRect()

    for (const touch of Array.from(e.changedTouches)) {
      const relX = touch.clientX - rect.left
      const isLeft = relX < rect.width / 2

      if (isLeft && this.joystick === null) {
        this.joystick = {
          touchId: touch.identifier,
          originX: touch.clientX,
          originY: touch.clientY,
        }
      } else if (!isLeft) {
        this.emit({ action: 'interact', type: 'pressed' })
      }
    }
  }

  private readonly onTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    if (this.joystick === null) return

    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier !== this.joystick.touchId) continue

      const dx = touch.clientX - this.joystick.originX
      const dy = touch.clientY - this.joystick.originY
      const dist = Math.sqrt(dx * dx + dy * dy)

      let x = dx / this.maxRadius
      let y = -dy / this.maxRadius // invert Y: drag up → positive

      if (dist > this.maxRadius) {
        x /= dist / this.maxRadius
        y /= dist / this.maxRadius
      }

      this.emit({ axis: 'move', value: { x, y } })
    }
  }

  private readonly onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault()
    for (const touch of Array.from(e.changedTouches)) {
      if (this.joystick !== null && touch.identifier === this.joystick.touchId) {
        this.joystick = null
        this.emit({ axis: 'move', value: { x: 0, y: 0 } })
      } else {
        this.emit({ action: 'interact', type: 'released' })
      }
    }
  }

  private readonly onTouchCancel = (e: TouchEvent): void => {
    this.onTouchEnd(e)
  }
}
