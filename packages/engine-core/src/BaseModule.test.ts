import { describe, it, expect, vi } from 'vitest'
import { BaseModule } from './BaseModule'
import type { EngineModule, ShellContext } from './types'
import { EventBus } from './EventBus'

// ─── Minimal concrete subclass ─────────────────────────────────────────────

class TestModule extends BaseModule {
  readonly id = 'test-module'
  readonly onMountCalls: Array<{ container: HTMLElement; context: ShellContext }> = []
  readonly onUnmountCalls: number[] = []

  async onMount(container: HTMLElement, context: ShellContext): Promise<void> {
    this.onMountCalls.push({ container, context })
  }

  async onUnmount(): Promise<void> {
    this.onUnmountCalls.push(Date.now())
  }
}

function makeContext(): ShellContext {
  return {
    eventBus: new EventBus(),
    locale: 'en',
    navigate: vi.fn(),
  }
}

function makeContainer(): HTMLElement {
  return { id: 'root' } as unknown as HTMLElement
}

// ─── Minimal EngineModule stub ─────────────────────────────────────────────

function makeChildStub(id: string): EngineModule & { mountCalls: number; unmountCalls: number } {
  return {
    id,
    mountCalls: 0,
    unmountCalls: 0,
    async mount() { this.mountCalls++ },
    async unmount() { this.unmountCalls++ },
    on: () => () => {},
    emit: () => {},
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('BaseModule', () => {
  describe('mount', () => {
    it('stores container and context, then calls onMount', async () => {
      const mod = new TestModule()
      const container = makeContainer()
      const ctx = makeContext()
      await mod.mount(container, ctx)
      expect(mod.onMountCalls).toHaveLength(1)
      expect(mod.onMountCalls[0]!.container).toBe(container)
      expect(mod.onMountCalls[0]!.context).toBe(ctx)
    })
  })

  describe('unmount', () => {
    it('calls onUnmount', async () => {
      const mod = new TestModule()
      await mod.mount(makeContainer(), makeContext())
      await mod.unmount()
      expect(mod.onUnmountCalls).toHaveLength(1)
    })

    it('clears the bus so listeners no longer fire after unmount', async () => {
      const mod = new TestModule()
      await mod.mount(makeContainer(), makeContext())
      const handler = vi.fn()
      mod.on('evt', handler)
      await mod.unmount()
      mod.emit('evt')
      expect(handler).not.toHaveBeenCalled()
    })

    it('unmounts all child modules before calling onUnmount', async () => {
      const order: string[] = []
      const parent = new TestModule()
      parent.onUnmountCalls // satisfy lint
      // Override onUnmount to track order
      const origUnmount = parent.onUnmount.bind(parent)
      parent.onUnmount = async () => { order.push('parent'); await origUnmount() }

      const child = makeChildStub('child')
      const origChildUnmount = child.unmount.bind(child)
      child.unmount = async () => { order.push('child'); await origChildUnmount() }

      await parent.mount(makeContainer(), makeContext())
      await parent.mountChild('slot-a', child)
      await parent.unmount()

      expect(order).toEqual(['child', 'parent'])
    })
  })

  describe('on / emit', () => {
    it('emits events to subscribers', async () => {
      const mod = new TestModule()
      await mod.mount(makeContainer(), makeContext())
      const handler = vi.fn()
      mod.on('update', handler)
      mod.emit('update', { delta: 0.016 })
      expect(handler).toHaveBeenCalledWith({ delta: 0.016 })
    })

    it('returned unsubscribe stops further calls', async () => {
      const mod = new TestModule()
      await mod.mount(makeContainer(), makeContext())
      const handler = vi.fn()
      const off = mod.on('tick', handler)
      off()
      mod.emit('tick')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('mountChild / unmountChild / getChild', () => {
    it('mounts a child and returns it via getChild', async () => {
      const parent = new TestModule()
      await parent.mount(makeContainer(), makeContext())
      const child = makeChildStub('child-a')
      await parent.mountChild('slot-a', child)
      expect(parent.getChild('slot-a')).toBe(child)
      expect(child.mountCalls).toBe(1)
    })

    it('replaces an existing child in the same slot (unmounts old first)', async () => {
      const parent = new TestModule()
      await parent.mount(makeContainer(), makeContext())

      const first = makeChildStub('first')
      const second = makeChildStub('second')
      await parent.mountChild('slot', first)
      await parent.mountChild('slot', second)

      expect(first.unmountCalls).toBe(1)
      expect(second.mountCalls).toBe(1)
      expect(parent.getChild('slot')).toBe(second)
    })

    it('unmountChild unmounts and removes the slot', async () => {
      const parent = new TestModule()
      await parent.mount(makeContainer(), makeContext())
      const child = makeChildStub('child')
      await parent.mountChild('slot', child)
      await parent.unmountChild('slot')
      expect(child.unmountCalls).toBe(1)
      expect(parent.getChild('slot')).toBeUndefined()
    })

    it('unmountChild on a missing slot does not throw', async () => {
      const parent = new TestModule()
      await parent.mount(makeContainer(), makeContext())
      await expect(parent.unmountChild('nonexistent')).resolves.not.toThrow()
    })

    it('getChild returns undefined for unknown slot', async () => {
      const parent = new TestModule()
      await parent.mount(makeContainer(), makeContext())
      expect(parent.getChild('missing')).toBeUndefined()
    })
  })
})
