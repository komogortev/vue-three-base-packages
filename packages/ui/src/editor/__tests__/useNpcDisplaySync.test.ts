import { describe, it, expect, vi } from 'vitest'
import { ref, shallowRef, nextTick, isReactive } from 'vue'
import { useNpcDisplaySync } from '../npc/useNpcDisplaySync'
import type { EditorNpcEntry } from '../sceneEditorTypes'
import type { NpcDisplayEntry } from '../npc/npcDisplayRegistry'

/** Mimics the asset store: a reactive list plus a per-id URL cache that is NOT reactive. */
function makeAssets(initial: string[] = []) {
  const assets = shallowRef<{ id: string }[]>(initial.map(id => ({ id })))
  const cache = new Map<string, string>()
  return {
    get assets() { return assets.value },
    resolveBlobUrl(id: string): string | null {
      const hit = cache.get(id)
      if (hit) return hit
      if (!assets.value.some(a => a.id === id)) return null
      const url = `blob:${id}`
      cache.set(id, url)
      return url
    },
    set(ids: string[]) { assets.value = ids.map(id => ({ id })) },
    /** Like the real store's remove(): drops the cached URL, then the row. */
    remove(id: string) {
      cache.delete(id)
      assets.value = assets.value.filter(a => a.id !== id)
    },
  }
}

const npc = (entityId: string, extra: Partial<EditorNpcEntry> = {}): EditorNpcEntry =>
  ({ entityId, x: 0, z: 0, ...extra })

async function flush() { await nextTick(); await nextTick() }

describe('useNpcDisplaySync', () => {
  it('applies the list immediately, before any change', () => {
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    useNpcDisplaySync(ref([npc('a', { assetId: 'x' })]), makeAssets(['x']), apply)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toEqual([expect.objectContaining({ entityId: 'a', assetUrl: 'blob:x' })])
  })

  it('leaves out NPCs with no asset or an unresolvable one', () => {
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    useNpcDisplaySync(
      ref([npc('none'), npc('missing', { assetId: 'gone' }), npc('ok', { assetId: 'x' })]),
      makeAssets(['x']),
      apply,
    )
    expect(apply.mock.calls[0][0].map(e => e.entityId)).toEqual(['ok'])
  })

  it('re-applies when the asset library finishes loading after the NPC was set', async () => {
    // The library arrives asynchronously; the URL cache is not reactive, so the
    // computed must re-run off the asset list itself.
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    const lib = makeAssets([])
    useNpcDisplaySync(ref([npc('a', { assetId: 'x' })]), lib, apply)
    expect(apply.mock.calls.at(-1)![0]).toEqual([])
    lib.set(['x'])
    await flush()
    expect(apply.mock.calls.at(-1)![0].map(e => e.entityId)).toEqual(['a'])
  })

  it('drops an NPC whose asset is removed even though its URL was already cached', async () => {
    // A cache HIT never reads the reactive asset list, so without tracking the list
    // explicitly the computed would never re-run and the model would stay on screen.
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    const lib = makeAssets(['x'])
    lib.resolveBlobUrl('x') // prime the cache so the sync's own lookup is a HIT
    useNpcDisplaySync(ref([npc('a', { assetId: 'x' })]), lib, apply)
    expect(apply.mock.calls.at(-1)![0]).toHaveLength(1)
    lib.remove('x')
    await flush()
    expect(apply.mock.calls.at(-1)![0]).toEqual([])
  })

  it('re-applies when an NPC field changes', async () => {
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    const npcs = ref([npc('a', { assetId: 'x' })])
    useNpcDisplaySync(npcs, makeAssets(['x']), apply)
    npcs.value[0].scale = 3
    await flush()
    expect(apply.mock.calls.at(-1)![0][0].scale).toBe(3)
  })

  it('hands the registry the raw poseOverride array, not a reactive proxy', () => {
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    const poseOverride = [{ bone: 'Arm', q: [0, 0, 0, 1] as [number, number, number, number] }]
    useNpcDisplaySync(ref([npc('a', { assetId: 'x', poseOverride })]), makeAssets(['x']), apply)
    const got = apply.mock.calls[0][0][0].poseOverride!
    expect(isReactive(got)).toBe(false)
    expect(got).toBe(poseOverride)
  })

  it('keeps the same poseOverride reference when only another field changes', async () => {
    // The registry re-applies a pose only when this reference changes.
    const apply = vi.fn(async (_: NpcDisplayEntry[]) => {})
    const poseOverride = [{ bone: 'Arm', q: [0, 0, 0, 1] as [number, number, number, number] }]
    const npcs = ref([npc('a', { assetId: 'x', poseOverride })])
    useNpcDisplaySync(npcs, makeAssets(['x']), apply)
    npcs.value[0].x = 5
    await flush()
    const last = apply.mock.calls.at(-1)![0][0]
    expect(last.x).toBe(5)
    expect(last.poseOverride).toBe(poseOverride)
  })
})
