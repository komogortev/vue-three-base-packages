# @base/engine-core

Mount contract, event bus, and context interfaces for the @base module ecosystem.

The base layer every other `@base` package builds on. It has no dependencies.

## What is in it

- `BaseModule`: abstract class implementing the mount contract. Gives a module an `id`, an event bus, `on` / `emit`, and child slots (`mountChild`, `unmountChild`, `getChild`). Unmounting a module unmounts its children first.
- `EventBus`: `on` (returns an unsubscribe function), `once`, `off`, `emit`, `clear`.
- Types: `EngineModule` (the mount contract), `ShellContext` (`eventBus`, `locale`, `navigate`), `EngineContext` (adds `host` and `entityManager`) and the `EntityManager` interface.

## Usage

```ts
import { BaseModule } from '@base/engine-core'
import type { EngineContext, ShellContext } from '@base/engine-core'

export class MyModule extends BaseModule {
  readonly id = 'my-module'

  protected async onMount(container: HTMLElement, context: ShellContext | EngineContext): Promise<void> {
    this.emit('my-module:ready')
  }

  protected async onUnmount(): Promise<void> {
    // release anything the module created
  }
}
```

A host mounts a module with `await host.mountChild('slot', new MyModule())`. A shell such as
[vue-pwa-shell](https://github.com/komogortev/vue-pwa-shell) mounts the top-level module.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/engine-core`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
