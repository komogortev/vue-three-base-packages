/**
 * Abstract button actions — game-agnostic identifiers that providers map device input onto.
 * Game modules listen for these; they never care which key or button produced them.
 */
export type ButtonAction =
  | 'interact'
  | 'pause'
  | 'confirm'
  | 'cancel'
  | 'jump'
  /** Generic harness / game ability slot — defaults unbound in {@link DEFAULT_BINDINGS}. */
  | 'ability_primary'
  /** Generic harness / game ability slot — defaults unbound in {@link DEFAULT_BINDINGS}. */
  | 'ability_secondary'
  /** Generic harness / game ability slot — defaults unbound in {@link DEFAULT_BINDINGS}. */
  | 'ability_tertiary'
  /** Generic harness / game ability slot — defaults unbound in {@link DEFAULT_BINDINGS}. */
  | 'ability_quaternary'
  /** Third ↔ first person (or other camera view) — defaults unbound. */
  | 'toggle_camera'

/**
 * Abstract axis names. Each axis carries a normalized { x, y } value in [-1, 1].
 * - move:  primary movement direction (WASD / left stick / touch joystick)
 * - look:  camera / aim direction (mouse delta / right stick)
 * - locomotion: modifiers — `x` = sprint, `y` = crouch, optional `z` = jog / slow-run (hold)
 */
export type AxisAction = 'move' | 'look' | 'locomotion'

export interface InputActionEvent {
  action: ButtonAction
  type: 'pressed' | 'released'
}

export interface InputAxisEvent {
  axis: AxisAction
  /** `z` is used only for `locomotion` (jog / slow run); omit on other axes. */
  value: { x: number; y: number; z?: number }
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
  /** Keys held = sprint (e.g. Shift). Emitted on `locomotion` axis `x`. */
  sprint: string[]
  /**
   * Keys held = crouch. Default {@link DEFAULT_BINDINGS} uses **C** so Chromium cannot trap **Ctrl+W** (close tab) / **Ctrl+D** (bookmark) with WASD.
   * You may add `ControlLeft`/`ControlRight` here, but browsers will still honor those OS-level chords.
   */
  crouch: string[]
  /** Keys held = jog / slow run (forward locomotion clip); not automatic from speed. */
  jog?: string[]
  interact: string[]
  pause: string[]
  confirm: string[]
  cancel: string[]
  jump: string[]
  /** @default [] */
  ability_primary: string[]
  /** @default [] */
  ability_secondary: string[]
  /** @default [] */
  ability_tertiary: string[]
  /** @default [] */
  ability_quaternary: string[]
  /** @default [] — e.g. `Tab` to avoid browser focus ring (see {@link KeyboardProvider}). */
  toggle_camera: string[]
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
  /** Button indices held = sprint (e.g. L3). Empty = never sprint from pad. */
  sprintHold: number[]
  /** Button indices held = crouch (e.g. B). Empty = never crouch from pad. */
  crouchHold: number[]
  /** Buttons held = jog / slow run. Empty = never jog from pad. */
  jogHold?: number[]
  /** Button indices that map to each action */
  interact: number[]
  pause: number[]
  confirm: number[]
  cancel: number[]
  jump: number[]
  /** @default [] */
  ability_primary: number[]
  /** @default [] */
  ability_secondary: number[]
  /** @default [] */
  ability_tertiary: number[]
  /** @default [] */
  ability_quaternary: number[]
  /** @default [] */
  toggle_camera: number[]
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
    sprint: ['ShiftLeft', 'ShiftRight'],
    crouch: ['KeyC'],
    jog: ['KeyV'],
    interact: ['KeyE'],
    pause:    ['Escape', 'KeyP'],
    confirm:  ['Enter', 'Space'],
    cancel:   ['Escape', 'Backspace'],
    jump:     ['Space'],
    ability_primary:    [],
    ability_secondary:  [],
    ability_tertiary:   [],
    ability_quaternary: [],
    toggle_camera: ['Tab'],
  },
  gamepad: {
    moveAxis: { x: 0, y: 1 },  // left stick
    lookAxis: { x: 2, y: 3 },  // right stick
    sprintHold: [10],           // L3 (common sprint bind)
    crouchHold: [],             // map in your game if needed
    jogHold: [],                // e.g. R3 = [11] on standard mapping
    interact: [0],              // A / Cross
    pause:    [9],              // Start / Options
    confirm:  [0],              // A / Cross
    cancel:   [1],              // B / Circle
    jump:     [0],              // A / Cross
    ability_primary:    [],
    ability_secondary:  [],
    ability_tertiary:   [],
    ability_quaternary: [],
    toggle_camera: [],
  },
  deadzone: 0.12,
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Shallow-merge user overrides onto base bindings.
 * Each action array is replaced entirely when the override key is present.
 *
 * @example
 * const active = mergeBindings(GAME_DEFAULT_BINDINGS, userOverrides)
 * new InputModule(active)
 */
export function mergeBindings(
  base: InputBindings,
  overrides: Partial<InputBindings>,
): InputBindings {
  return {
    keyboard: { ...base.keyboard, ...(overrides.keyboard ?? {}) },
    gamepad:  { ...base.gamepad,  ...(overrides.gamepad  ?? {}) },
    deadzone: overrides.deadzone ?? base.deadzone,
  }
}
