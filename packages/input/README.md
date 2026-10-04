# @base/input

Abstract input module for the @base ecosystem — keyboard, gamepad, and touch mapped to game-agnostic actions.

Keyboard, gamepad, touch and optional pointer-lock input, translated into events on the shared event bus.

## What is in it

- `InputModule`: mount it as a child of a host such as `ThreeModule`. It emits `input:action` (`{ action, type: 'pressed' | 'released' }`) and `input:axis` (`move`, `look` and `locomotion` axes) on `context.eventBus`.
- Providers it orchestrates: `KeyboardProvider`, `GamepadProvider`, `TouchProvider` and `PointerLookProvider`.
- Bindings: `DEFAULT_BINDINGS`, `mergeBindings(base, overrides)` for user rebinding, and the `InputBindings`, `KeyboardBindings` and `GamepadBindings` types.
- Options (`InputModuleOptions`): `enableTouchOverlay` (default true; turn it off in desktop editors, where the overlay would block mouse events), `enablePointerLook` (default false; click the container to lock the pointer and emit `look`) and `pointerLookOptions`.

## Usage

```ts
import { InputModule, DEFAULT_BINDINGS, mergeBindings } from '@base/input'
import type { InputActionEvent } from '@base/input'

const bindings = mergeBindings(DEFAULT_BINDINGS, userOverrides)
await engine.mountChild('input', new InputModule(bindings, { enablePointerLook: true }))

context.eventBus.on('input:action', (e) => {
  const { action, type } = e as InputActionEvent
  if (action === 'jump' && type === 'pressed') player.notifyJumpPressed()
})
```

## Peer dependencies

`@base/engine-core`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/input`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
