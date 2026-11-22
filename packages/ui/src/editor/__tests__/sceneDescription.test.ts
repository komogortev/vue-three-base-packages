import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  describeScene, listAssets, roundBounds, roundDeg, roundLen, toPromptJson,
  type PlacedInput,
} from '../describe/sceneDescription'
import { createAssetBoundsCache, MEASURE_CONCURRENCY } from '../describe/assetBoundsCache'
import type { EditorPlacedObject } from '../sceneEditorTypes'
import type { PlacedAttachment } from '../sandboxSceneSchema'
import type { Aabb } from '../gate/verdict'

function rec(id: string, extra: Partial<EditorPlacedObject> = {}): EditorPlacedObject {
  return { id, assetId: 'asset-a', label: id, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra }
}
const box = (min: [number, number, number], max: [number, number, number]): Aabb =>
  ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } })
const kindProp = () => 'prop' as const

const ATTACHMENT: PlacedAttachment = {
  parentId: 'placed-table', localStart: { x: 0, y: 0, z: 0 }, localEnd: { x: 0, y: 1, z: 0 },
  contactType: 'surface-contact', gapTolerance: 0.01,
}

describe('describeScene — attachment parent', () => {
  it('emits `parent` when the object carries an attachment', () => {
    const d = describeScene({ placed: [{ record: rec('placed-lamp', { attachment: ATTACHMENT }), worldBounds: null }], assetKind: kindProp })
    expect(d.objects[0].parent).toBe('placed-table')
    // After bounds: parent is the last placed key.
    expect(Object.keys(d.objects[0])).toEqual(['id', 'kind', 'label', 'asset', 'pos', 'yaw', 'scale', 'bounds', 'parent'])
  })

  it('omits the key entirely for a free placement (no attachment)', () => {
    const d = describeScene({ placed: [{ record: rec('placed-lamp'), worldBounds: null }], assetKind: kindProp })
    expect('parent' in d.objects[0]).toBe(false)
    expect(toPromptJson(d)).not.toContain('parent')
  })

  it('passes a scene sentinel parent through', () => {
    const d = describeScene({ placed: [{ record: rec('placed-rug', { attachment: { ...ATTACHMENT, parentId: 'room-root' } }), worldBounds: null }], assetKind: kindProp })
    expect(d.objects[0].parent).toBe('room-root')
  })
})

describe('describeScene — transforms and kinds', () => {
  it('yaw in degrees, tilt only when turned about X or Z, non-uniform scale as a triple', () => {
    const plain = describeScene({ placed: [{ record: rec('p', { rotationY: Math.PI / 4 }), worldBounds: null }], assetKind: kindProp }).objects[0]
    expect(plain.yaw).toBe(45)
    expect('tilt' in plain).toBe(false)
    expect(plain.scale).toBe(1)

    const tilted = describeScene({
      placed: [{ record: rec('p', { rotationX: Math.PI / 2, rotationZ: -0.1, scaleX: 2, scaleY: 1, scaleZ: 2 }), worldBounds: null }],
      assetKind: kindProp,
    }).objects[0]
    expect(tilted.tilt).toEqual([90, -5.7])
    expect(tilted.scale).toEqual([2, 1, 2])
    const tiny = describeScene({ placed: [{ record: rec('p', { scaleX: 0.004, scaleY: 0.004, scaleZ: 0.004 }), worldBounds: null }], assetKind: kindProp }).objects[0]
    expect(tiny.scale).toBe(0.004)
    expect(Object.keys(tilted)).toEqual(['id', 'kind', 'label', 'asset', 'pos', 'yaw', 'tilt', 'scale', 'bounds'])
  })

  it('a placed object whose asset left the library is kind "missing-asset", bounds null when unmeasured', () => {
    const o = describeScene({ placed: [{ record: rec('p'), worldBounds: null }], assetKind: () => undefined }).objects[0]
    expect(o.kind).toBe('missing-asset')
    expect(o.bounds).toBeNull()
  })

  it('NPCs and zones follow the placed objects, with their own fields', () => {
    const d = describeScene({
      placed: [{ record: rec('placed-a'), worldBounds: null }],
      npcs: [
        { entry: { entityId: 'npc-dad', label: 'Dad', x: 1.234, z: -2, rotationY: 270, scale: 1, assetId: 'asset-dad', proximityRadius: 2.5 }, worldBounds: box([0.9, 0, -2.3], [1.5, 1.8, -1.7]) },
        { entry: { entityId: 'npc-bare', x: 0, z: 0 }, worldBounds: null },
      ],
      zones: [
        { id: 'zone-door', type: 'exit', label: 'Door', x: 4, z: 0, radius: 1, targetSceneId: 'scene-02' },
        { id: 'zone-talk', type: 'proximity', x: 0, z: 1, radius: 3 },
      ],
      spawn: { x: 0.5, z: 4 },
      assetKind: kindProp,
    })
    expect(toPromptJson(d)).toBe('{"v":1,"units":"m,deg","objects":[' + [
      '{"id":"placed-a","kind":"prop","label":"placed-a","asset":"asset-a","pos":[0,0,0],"yaw":0,"scale":1,"bounds":null}',
      '{"id":"npc-dad","kind":"npc","label":"Dad","asset":"asset-dad","pos":[1.23,0,-2],"yaw":-90,"scale":1,"bounds":[[0.9,0,-2.3],[1.5,1.8,-1.7]],"radius":2.5}',
      '{"id":"npc-bare","kind":"npc","label":"npc-bare","pos":[0,0,0],"yaw":0,"scale":1,"bounds":null}',
      '{"id":"zone-door","kind":"zone-exit","label":"Door","pos":[4,0,0],"radius":1,"target":"scene-02"}',
      '{"id":"zone-talk","kind":"zone-proximity","label":"zone-talk","pos":[0,0,1],"radius":3}',
    ].join(',') + '],"spawn":[0.5,4]}')
  })
})

describe('rounding', () => {
  it('bounds round outward to 1 cm', () => {
    expect(roundBounds(box([-0.175, 0.001, 0], [0.175, 2.999, 1.004]))).toEqual([[-0.18, 0, 0], [0.18, 3, 1.01]])
  })

  it('float noise cannot push an outward rounding a whole step (negative control on the naive form)', () => {
    // The trap: 0.07 * 100 is 7.000000000000001 in binary floating point.
    expect(Math.ceil(0.07 * 100) / 100).toBe(0.08)
    expect(Math.floor(-0.28 * 100) / 100).toBe(-0.29)
    // The µm snap keeps both on their own centimetre.
    expect(roundBounds(box([-0.28, 0, 0], [0.07, 1, 1]))).toEqual([[-0.28, 0, 0], [0.07, 1, 1]])
    // Float32 geometry noise on a half-centimetre edge still rounds outward, both sides.
    expect(roundBounds(box([-2.674999997, 0, 0], [-2.325000003, 1, 1]))).toEqual([[-2.68, 0, 0], [-2.32, 1, 1]])
  })

  it('positions to the nearest centimetre, never -0', () => {
    expect(roundLen(1.234)).toBe(1.23)
    expect(roundLen(-0.001)).toBe(0)
    expect(Object.is(roundLen(-0.001), 0)).toBe(true)
  })

  it('angles wrap into (-180, 180] at 0.1°', () => {
    expect(roundDeg(180)).toBe(180)
    expect(roundDeg(-180)).toBe(180)
    expect(roundDeg(270)).toBe(-90)
    expect(roundDeg(359.96)).toBe(0)
    expect(roundDeg(12.345)).toBe(12.3)
  })
})

describe('listAssets', () => {
  it('sorts by name then id; audio has no bounds; clips only when present', () => {
    const cat = listAssets([
      { id: 'asset-2', name: 'b.glb', kind: 'prop' },
      { id: 'asset-9', name: 'music.mp3', kind: 'audio' },
      { id: 'asset-1', name: 'b.glb', kind: 'prop', clipNames: [] },
      { id: 'asset-0', name: 'anims.glb', kind: 'animation-pack', clipNames: ['Idle', 'Walk'] },
    ], id => (id === 'asset-1' ? box([-0.5, 0, -0.5], [0.5, 1, 0.5]) : undefined))
    expect(toPromptJson(cat)).toBe('{"v":1,"units":"m","assets":[' + [
      '{"id":"asset-0","name":"anims.glb","kind":"animation-pack","clips":["Idle","Walk"]}',
      '{"id":"asset-1","name":"b.glb","kind":"prop","bounds":[[-0.5,0,-0.5],[0.5,1,0.5]]}',
      '{"id":"asset-2","name":"b.glb","kind":"prop","bounds":null}',
      '{"id":"asset-9","name":"music.mp3","kind":"audio"}',
    ].join(',') + ']}')
  })
})

describe('assetBoundsCache', () => {
  const unitBox = () => {
    const g = new THREE.Group()
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial())
    m.position.y = 1
    g.add(m)
    return { scene: g as THREE.Object3D }
  }

  it('measures once per id and size, re-measures a grown blob, never loads audio', async () => {
    const loadGltf = vi.fn(async () => unitBox())
    const cache = createAssetBoundsCache({ loadGltf, urlFor: a => `blob:${a.id}` })
    const assets = [{ id: 'a', kind: 'prop' as const, size: 10 }, { id: 's', kind: 'audio' as const, size: 5 }]
    await Promise.all([cache.measureAll(assets), cache.measureAll(assets)])
    expect(loadGltf).toHaveBeenCalledTimes(1)
    expect(cache.get('a')).toEqual(box([-0.5, 0, -0.5], [0.5, 2, 0.5]))
    expect(cache.get('s')).toBeUndefined()

    await cache.measureAll([{ id: 'a', kind: 'prop', size: 10 }])
    expect(loadGltf).toHaveBeenCalledTimes(1)
    await cache.measureAll([{ id: 'a', kind: 'prop', size: 11 }])
    expect(loadGltf).toHaveBeenCalledTimes(2)
  })

  /** A loader whose loads resolve when the test says so, in any order. */
  function manualLoader() {
    const pending: { url: string; resolve: () => void }[] = []
    let inFlight = 0, maxInFlight = 0
    const load = (url: string) => new Promise<{ scene: THREE.Object3D }>(res => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      pending.push({ url, resolve: () => { inFlight--; res(unitBox()) } })
    })
    return { pending, load, max: () => maxInFlight }
  }
  const flush = () => new Promise(r => setTimeout(r, 0))

  it('a slower measurement of an older blob does not overwrite a newer one', async () => {
    const l = manualLoader()
    const cache = createAssetBoundsCache({ loadGltf: l.load, urlFor: a => `${a.id}@${a.size}` })
    const old = cache.measureAll([{ id: 'a', kind: 'prop', size: 10 }])
    await flush()
    const grown = cache.measureAll([{ id: 'a', kind: 'prop', size: 11 }])
    await flush()
    // The newer blob finishes first, then the older one.
    l.pending.find(p => p.url === 'a@11')!.resolve()
    await grown
    l.pending.find(p => p.url === 'a@10')!.resolve()
    await old
    // A newer listing at size 11 must not re-load: the size-11 result is still the one held.
    await cache.measureAll([{ id: 'a', kind: 'prop', size: 11 }])
    expect(l.pending).toHaveLength(2)
  })

  it('clear() drops measurements still loading', async () => {
    const l = manualLoader()
    const cache = createAssetBoundsCache({ loadGltf: l.load, urlFor: a => a.id })
    const job = cache.measureAll([{ id: 'a', kind: 'prop', size: 1 }])
    await flush()
    cache.clear()
    l.pending[0].resolve()
    await job
    expect(cache.get('a')).toBeUndefined()
  })

  it('a load that finishes after clear() does not unregister the newer in-flight load', async () => {
    const l = manualLoader()
    const cache = createAssetBoundsCache({ loadGltf: l.load, urlFor: a => a.id })
    const a = [{ id: 'a', kind: 'prop' as const, size: 1 }]
    const first = cache.measureAll(a)
    await flush()
    cache.clear()
    const second = cache.measureAll(a)
    await flush()
    l.pending[0].resolve()   // the pre-clear load finishes
    await first
    const third = cache.measureAll(a)   // must join the second load, not start a third
    await flush()
    expect(l.pending).toHaveLength(2)
    l.pending[1].resolve()
    await Promise.all([second, third])
    expect(cache.get('a')).not.toBeUndefined()
  })

  it('never loads animation packs, and loads at most MEASURE_CONCURRENCY at once', async () => {
    const l = manualLoader()
    const cache = createAssetBoundsCache({ loadGltf: l.load, urlFor: a => a.id })
    const assets = [
      { id: 'pack', kind: 'animation-pack' as const, size: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, kind: 'prop' as const, size: 1 })),
    ]
    const job = cache.measureAll(assets)
    for (let i = 0; i < 20; i++) { await flush(); l.pending.forEach(p => p.resolve()) }
    await job
    expect(l.pending.map(p => p.url)).not.toContain('pack')
    expect(l.pending).toHaveLength(10)
    expect(l.max()).toBe(MEASURE_CONCURRENCY)
  })

  it('caches a failed load as null (unmeasured) and does not reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = createAssetBoundsCache({ loadGltf: async () => { throw new Error('bad glb') }, urlFor: a => a.id })
    await expect(cache.measureAll([{ id: 'x', kind: 'prop', size: 1 }])).resolves.toBeUndefined()
    expect(cache.get('x')).toBeNull()
    warn.mockRestore()
  })

  it('disposes what it loaded', async () => {
    const scene = unitBox()
    const geo = (scene.scene.children[0] as THREE.Mesh).geometry
    const disposed = vi.fn()
    geo.addEventListener('dispose', disposed)
    const cache = createAssetBoundsCache({ loadGltf: async () => scene, urlFor: a => a.id })
    await cache.measureAll([{ id: 'a', kind: 'prop', size: 1 }])
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})

describe('PP-2 output size — 200 placed objects (measured)', () => {
  /** Deterministic pseudo-random in [0, 1). */
  function rng(seed: number) {
    let s = seed >>> 0
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  }
  const ID = 'abcdefghijklmnopqrstuvwxyz0123456789'

  it('states the size of a realistic 200-object scene', () => {
    const r = rng(42)
    const token = (n: number) => Array.from({ length: n }, () => ID[Math.floor(r() * ID.length)]).join('')
    const assetIds = Array.from({ length: 20 }, () => `asset-${token(21)}`)
    const names = ['chair', 'table', 'lamp', 'sofa', 'shelf', 'plant', 'crate', 'rug', 'bed', 'desk']
    const placed: PlacedInput[] = Array.from({ length: 200 }, (_, i) => {
      const x = (r() - 0.5) * 40, z = (r() - 0.5) * 40, y = r() < 0.7 ? 0 : r() * 2
      const w = 0.3 + r() * 2, h = 0.3 + r() * 2, d = 0.3 + r() * 2
      return {
        record: rec(`placed-${token(6)}`, {
          assetId: assetIds[i % assetIds.length],
          label: `${names[i % names.length]}-${String(i).padStart(2, '0')}`,
          x, y, z, rotationY: (r() - 0.5) * 2 * Math.PI,
          ...(i % 3 === 0 ? { attachment: { ...ATTACHMENT, parentId: 'placed-abcdef' as const } } : {}),
        }),
        worldBounds: box([x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2]),
      }
    })
    const json = toPromptJson(describeScene({ placed, assetKind: kindProp }))
    const chars = json.length
    // Method: characters / 4 (the usual English-text rule of thumb) and characters / 3
    // (number-dense JSON tokenizes denser than prose). Not a tokenizer count.
    const est4 = Math.round(chars / 4), est3 = Math.round(chars / 3)
    console.log(`[PP-2 size] 200 objects: ${chars} chars ≈ ${est4}–${est3} tokens (chars/4 – chars/3)`)
    // Measured 38,430 chars (2026-11-21). Regression band, not a target: fails if the
    // format bloats by ~20 % or loses fields.
    expect(chars).toBeLessThan(46_000)
    expect(chars).toBeGreaterThan(30_000)
  })
})
