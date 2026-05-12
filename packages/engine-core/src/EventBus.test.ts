import { describe, it, expect, vi } from 'vitest'
import { EventBus } from './EventBus'

describe('EventBus', () => {
  describe('on / emit', () => {
    it('calls a registered handler when event is emitted', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      bus.on('foo', handler)
      bus.emit('foo')
      expect(handler).toHaveBeenCalledOnce()
    })

    it('forwards arguments to the handler', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      bus.on('data', handler)
      bus.emit('data', 42, 'hello')
      expect(handler).toHaveBeenCalledWith(42, 'hello')
    })

    it('calls all handlers registered for the same event', () => {
      const bus = new EventBus()
      const a = vi.fn()
      const b = vi.fn()
      bus.on('evt', a)
      bus.on('evt', b)
      bus.emit('evt')
      expect(a).toHaveBeenCalledOnce()
      expect(b).toHaveBeenCalledOnce()
    })

    it('does not call handlers for unrelated events', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      bus.on('foo', handler)
      bus.emit('bar')
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not throw when emitting an event with no listeners', () => {
      const bus = new EventBus()
      expect(() => bus.emit('unknown')).not.toThrow()
    })

    it('returns an unsubscribe function from on()', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      const off = bus.on('click', handler)
      off()
      bus.emit('click')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('off', () => {
    it('removes a specific handler', () => {
      const bus = new EventBus()
      const a = vi.fn()
      const b = vi.fn()
      bus.on('evt', a)
      bus.on('evt', b)
      bus.off('evt', a)
      bus.emit('evt')
      expect(a).not.toHaveBeenCalled()
      expect(b).toHaveBeenCalledOnce()
    })

    it('does not throw when removing a handler that was never added', () => {
      const bus = new EventBus()
      expect(() => bus.off('nonexistent', vi.fn())).not.toThrow()
    })
  })

  describe('once', () => {
    it('fires handler exactly once', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      bus.once('ping', handler)
      bus.emit('ping')
      bus.emit('ping')
      expect(handler).toHaveBeenCalledOnce()
    })

    it('forwards arguments to the once handler', () => {
      const bus = new EventBus()
      const handler = vi.fn()
      bus.once('msg', handler)
      bus.emit('msg', { id: 1 })
      expect(handler).toHaveBeenCalledWith({ id: 1 })
    })

    it('does not prevent other persistent handlers from firing', () => {
      const bus = new EventBus()
      const once = vi.fn()
      const always = vi.fn()
      bus.once('evt', once)
      bus.on('evt', always)
      bus.emit('evt')
      bus.emit('evt')
      expect(once).toHaveBeenCalledOnce()
      expect(always).toHaveBeenCalledTimes(2)
    })
  })

  describe('clear', () => {
    it('removes all listeners', () => {
      const bus = new EventBus()
      const a = vi.fn()
      const b = vi.fn()
      bus.on('x', a)
      bus.on('y', b)
      bus.clear()
      bus.emit('x')
      bus.emit('y')
      expect(a).not.toHaveBeenCalled()
      expect(b).not.toHaveBeenCalled()
    })

    it('allows re-registration after clear', () => {
      const bus = new EventBus()
      bus.on('evt', vi.fn())
      bus.clear()
      const fresh = vi.fn()
      bus.on('evt', fresh)
      bus.emit('evt')
      expect(fresh).toHaveBeenCalledOnce()
    })
  })
})
