/**
 * Abstract button actions — game-agnostic identifiers that providers map device input onto.
 * Game modules listen for these; they never care which key or button produced them.
 */
export type ButtonAction = 'interact' | 'pause' | 'confirm' | 'cancel' | 'jump'

/**
 * Abstract axis names. Each axis carries a normalized { x, y } value in [-1, 1].
 * - move:  primary movement direction (WASD / left stick / touch joystick)
 * - look:  camera / aim direction (mouse delta / right stick)
 */
export type AxisAction = 'move' | 'look'

export interface InputActionEvent {
  action: ButtonAction
  type: 'pressed' | 'released'
}

export interface InputAxisEvent {
  axis: AxisAction
  value: { x: number; y: number }
}

export type InputEvent = InputActionEvent | InputAxisEvent

/** Internal emit function type used by all providers. */
export type InputEmitter = (event: InputEvent) => void

// ─── Binding configuration ────────────────────────────────────────────────────

export interface KeyboardMoveBindings {
  up: string[]
  down: string[]
  left: string[]
  right: string[]
}

export interface KeyboardBindings {
  move: KeyboardMoveBindings
  interact: string[]
  pause: string[]
  confirm: string[]
  cancel: string[]
  jump: string[]
}

export interface GamepadAxisBindings {
  /** Gamepad axis index for X (left stick = 0, right stick = 2) */
  x: number
  /** Gamepad axis index for Y (left stick = 1, right stick = 3) */
  y: number
}

export interface GamepadBindings {
  moveAxis: GamepadAxisBindings
  lookAxis: GamepadAxisBindings
  /** Button indices that map to each action */
  interact: number[]
  pause: number[]
  confirm: number[]
  cancel: number[]
  jump: number[]
}

export interface InputBindings {
  keyboard: KeyboardBindings
  gamepad: GamepadBindings
  /** Minimum axis magnitude below which input is treated as zero */
  deadzone: number
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_BINDINGS: InputBindings = {
  keyboard: {
    move: {
      up:    ['KeyW', 'ArrowUp'],
      down:  ['KeyS', 'ArrowDown'],
      left:  ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
    },
    interact: ['KeyE'],
    pause:    ['Escape', 'KeyP'],
    confirm:  ['Enter', 'Space'],
    cancel:   ['Escape', 'Backspace'],
    jump:     ['Space'],
  },
  gamepad: {
    moveAxis: { x: 0, y: 1 },  // left stick
    lookAxis: { x: 2, y: 3 },  // right stick
    interact: [0],              // A / Cross
    pause:    [9],              // Start / Options
    confirm:  [0],              // A / Cross
    cancel:   [1],              // B / Circle
    jump:     [0],              // A / Cross
  },
  deadzone: 0.12,
}
