import { describe, it, expect, vi } from 'vitest'
import { glbAnimationNames, readGlbAnimationNames, backfillClipNames } from '../glbAnimationNames'
import { listLoadableClips, splitClipKey, clipKey } from '../anim/loadableClips'

/** A minimal GLB: header + JSON chunk (+ optional trailing bytes standing in for the BIN chunk). */
function makeGlb(json: object, trailing = 0): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(json))
  const pad = (4 - (body.length % 4)) % 4
  const jsonBytes = new Uint8Array(body.length + pad).fill(0x20)
  jsonBytes.set(body)
  const total = 12 + 8 + jsonBytes.length + trailing
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonBytes.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  return out
}

describe('glbAnimationNames', () => {
  it('reads the clip names from the JSON chunk', () => {
    const glb = makeGlb({ asset: { version: '2.0' }, animations: [{ name: 'walk' }, { name: 'wave' }] })
    expect(glbAnimationNames(glb)).toEqual(['walk', 'wave'])
  })

  it('names unnamed clips like three does', () => {
    expect(glbAnimationNames(makeGlb({ animations: [{}, { name: 'b' }, {}] }))).toEqual(['animation_0', 'b', 'animation_2'])
  })

  it('returns [] for a GLB with no animations', () => {
    expect(glbAnimationNames(makeGlb({ asset: { version: '2.0' } }))).toEqual([])
  })

  // Negative controls: unreadable input is null, never a throw and never a guess.
  it('returns null for bytes that are not a GLB', () => {
    expect(glbAnimationNames(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))).toBeNull()
    expect(glbAnimationNames(new Uint8Array(4))).toBeNull()
  })
  it('returns null for a truncated GLB and for invalid JSON', () => {
    const glb = makeGlb({ animations: [{ name: 'x' }] })
    expect(glbAnimationNames(glb.subarray(0, 24))).toBeNull()
    const bad = makeGlb({ animations: [{ name: 'xxxxxxxxxxxx' }] }); bad.set(new TextEncoder().encode('{nope'), 20)
    expect(glbAnimationNames(bad)).toBeNull()
  })

  it('works on a sub-view with a non-zero byteOffset (fflate output)', () => {
    const glb = makeGlb({ animations: [{ name: 'in-view' }] })
    const padded = new Uint8Array(glb.length + 7); padded.set(glb, 7)
    expect(glbAnimationNames(padded.subarray(7))).toEqual(['in-view'])
  })
})

describe('readGlbAnimationNames (Blob)', () => {
  it('reads only the header + JSON chunk of a large file', async () => {
    const glb = makeGlb({ animations: [{ name: 'big' }] }, 5_000_000)
    expect(await readGlbAnimationNames(new Blob([glb as BlobPart]))).toEqual(['big'])
  })
  it('returns null for an empty or non-GLB blob', async () => {
    expect(await readGlbAnimationNames(new Blob([]))).toBeNull()
    expect(await readGlbAnimationNames(new Blob([new Uint8Array(40)]))).toBeNull()
  })
})

describe('backfillClipNames', () => {
  const blobOf = (names: string[]) => new Blob([makeGlb({ animations: names.map(name => ({ name })) }) as BlobPart])

  it('fills only animation packs that lack names, leaving everything else alone', async () => {
    const update = vi.fn(async () => {})
    const n = await backfillClipNames([
      { id: 'pack-missing', kind: 'animation-pack', blob: blobOf(['wave']) },
      { id: 'pack-has', kind: 'animation-pack', clipNames: ['kept'], blob: blobOf(['other']) },
      { id: 'char', kind: 'character', blob: blobOf(['skip']) },
      { id: 'pack-empty', kind: 'animation-pack', blob: blobOf([]) },
    ], update)
    expect(n).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('pack-missing', ['wave'])
  })

  it('skips an unreadable row without aborting the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const update = vi.fn(async () => {})
    const n = await backfillClipNames([
      { id: 'broken', kind: 'animation-pack', blob: { slice() { throw new Error('boom') } } as unknown as Blob },
      { id: 'ok', kind: 'animation-pack', blob: blobOf(['a']) },
    ], update)
    expect(n).toBe(1)
    expect(update).toHaveBeenCalledWith('ok', ['a'])
    warn.mockRestore()
  })
})

describe('listLoadableClips', () => {
  const kits = [
    { id: 'k-new', name: 'wave.glb', kind: 'animation-pack', clipNames: ['wave'] },
    { id: 'k-bound', name: 'locomotion.glb', kind: 'animation-pack', clipNames: ['walk', 'run'] },
    { id: 'char', name: 'body.glb', kind: 'character', clipNames: ['ignored'] },
    { id: 'k-empty', name: 'empty.glb', kind: 'animation-pack' },
  ]

  it('lists the clips of every kit, not only the bound one', () => {
    const labels = listLoadableClips(kits, 'k-bound').map(c => c.label)
    expect(labels).toContain('wave › wave') // an earlier recording the NPC is not bound to
    expect(labels).toContain('locomotion › walk')
  })

  it('puts the bound pack first and keeps library order after it', () => {
    expect(listLoadableClips(kits, 'k-bound').map(c => c.clipName)).toEqual(['walk', 'run', 'wave'])
  })

  it('skips non-kit assets and kits with no clips', () => {
    const ids = new Set(listLoadableClips(kits, undefined).map(c => c.assetId))
    expect(ids.has('char')).toBe(false)
    expect(ids.has('k-empty')).toBe(false)
  })

  it('marks which clips belong to the bound pack', () => {
    expect(listLoadableClips(kits, 'k-bound').filter(c => c.bound).map(c => c.clipName)).toEqual(['walk', 'run'])
    expect(listLoadableClips(kits, undefined).some(c => c.bound)).toBe(false)
  })

  it('round-trips a key, even when the clip name contains the separator', () => {
    expect(splitClipKey(clipKey('asset-1', 'a::b'))).toEqual({ assetId: 'asset-1', clipName: 'a::b' })
    expect(splitClipKey('no-separator')).toBeNull()
  })
})
