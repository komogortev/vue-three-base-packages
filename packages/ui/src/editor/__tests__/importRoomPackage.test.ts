import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  parseRoomPackage,
  uniqueSceneName,
  buildImportedSceneRow,
} from '../importRoomPackage'
import { buildRoomPackageScene } from '../SceneEditorExporter'
import type { RoomPackageScene } from '../roomPackageTypes'

const scene: RoomPackageScene = {
  placedObjects: [{ assetId: 'asset-prop', position: [1, 0, 2] } as never],
  npcs: [{ id: 'npc-1', assetId: 'asset-body', animationPackAssetId: 'asset-pack' } as never],
  zones: [{ id: 'zone-a' } as never],
  spawnPoint: { x: 3, z: 4 },
  ambientAudioAssetId: 'asset-audio',
  ambientAudioVolume: 0.5,
}

function makeZip(opts: {
  manifest?: object | null
  sceneJson?: object | null
  sidecar?: object
  assetIds?: string[]
} = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const manifest = opts.manifest === undefined
    ? { version: 1, exportedAt: 't', packageId: 'room-x', sceneLabel: 'Hall' }
    : opts.manifest
  if (manifest) files['manifest.json'] = strToU8(JSON.stringify(manifest))
  const sc = opts.sceneJson === undefined ? scene : opts.sceneJson
  if (sc) files['scene.json'] = strToU8(JSON.stringify(sc))
  if (opts.sidecar) files['assets.json'] = strToU8(JSON.stringify(opts.sidecar))
  for (const id of opts.assetIds ?? ['asset-prop', 'asset-body', 'asset-pack', 'asset-audio']) {
    const ext = id === 'asset-audio' ? 'mp3' : 'glb'
    files[`assets/${id}.${ext}`] = new Uint8Array([1, 2, 3])
  }
  return zipSync(files, { level: 0 })
}

describe('parseRoomPackage', () => {
  it('reads manifest, scene and all assets', () => {
    const p = parseRoomPackage(makeZip())
    expect(p.manifest.sceneLabel).toBe('Hall')
    expect(p.scene).toEqual(scene)
    expect(p.assets.map(a => a.id).sort()).toEqual(['asset-audio', 'asset-body', 'asset-pack', 'asset-prop'])
    expect(p.missingAssetIds).toEqual([])
    expect(Array.from(p.assets[0].bytes)).toEqual([1, 2, 3])
  })

  it('infers kind from scene usage when there is no sidecar', () => {
    const kinds = Object.fromEntries(parseRoomPackage(makeZip()).assets.map(a => [a.id, a.kind]))
    expect(kinds).toEqual({
      'asset-prop': 'prop',
      'asset-body': 'character',
      'asset-pack': 'animation-pack',
      'asset-audio': 'audio',
    })
  })

  it('prefers the sidecar for name, kind and clip names', () => {
    const p = parseRoomPackage(makeZip({
      sidecar: { 'asset-prop': { name: 'rock.glb', kind: 'environment', clipNames: ['a'] } },
    }))
    const prop = p.assets.find(a => a.id === 'asset-prop')!
    expect(prop).toMatchObject({ name: 'rock.glb', kind: 'environment', clipNames: ['a'] })
  })

  it('reads clip names from the GLB when there is no sidecar (an imported pack must list its clips)', () => {
    const jsonBody = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, animations: [{ name: 's5c-wave' }, { name: 'idle' }] }))
    const pad = (4 - (jsonBody.length % 4)) % 4
    const jsonBytes = new Uint8Array(jsonBody.length + pad).fill(0x20); jsonBytes.set(jsonBody)
    const glb = new Uint8Array(20 + jsonBytes.length)
    const dv = new DataView(glb.buffer)
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true)
    dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true)
    glb.set(jsonBytes, 20)
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify({ version: 1, sceneLabel: 'x' })),
      'scene.json': strToU8(JSON.stringify(scene)),
      'assets/asset-pack.glb': glb,
      'assets/asset-body.glb': new Uint8Array([1, 2, 3]), // not a GLB: must stay without names, not throw
    }
    const p = parseRoomPackage(zipSync(files, { level: 0 }))
    expect(p.assets.find(a => a.id === 'asset-pack')!.clipNames).toEqual(['s5c-wave', 'idle'])
    expect(p.assets.find(a => a.id === 'asset-body')!.clipNames).toBeUndefined()
  })

  it('prefers the sidecar clip names over the file when both exist', () => {
    const p = parseRoomPackage(makeZip({ sidecar: { 'asset-pack': { name: 'kit.glb', kind: 'animation-pack', clipNames: ['from-sidecar'] } } }))
    expect(p.assets.find(a => a.id === 'asset-pack')!.clipNames).toEqual(['from-sidecar'])
  })

  it('reports referenced assets the ZIP does not contain', () => {
    const p = parseRoomPackage(makeZip({ assetIds: ['asset-prop', 'asset-body'] }))
    expect(p.missingAssetIds.sort()).toEqual(['asset-audio', 'asset-pack'])
  })

  // Negative controls: these must throw, or the guards are decorative.
  it('rejects a ZIP without manifest.json', () => {
    expect(() => parseRoomPackage(makeZip({ manifest: null }))).toThrow(/manifest/)
  })
  it('rejects a ZIP without scene.json', () => {
    expect(() => parseRoomPackage(makeZip({ sceneJson: null }))).toThrow(/scene\.json/)
  })
  it('rejects bytes that are not a ZIP with a readable message', () => {
    expect(() => parseRoomPackage(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not a readable ZIP/)
  })
  it('rejects invalid JSON in scene.json with a readable message', () => {
    const files = {
      'manifest.json': strToU8(JSON.stringify({ version: 1, sceneLabel: 'x' })),
      'scene.json': strToU8('{not json'),
    }
    expect(() => parseRoomPackage(zipSync(files))).toThrow(/scene\.json is not valid JSON/)
  })
  it('treats a corrupt assets.json as absent and still infers kinds', () => {
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify({ version: 1, sceneLabel: 'x' })),
      'scene.json': strToU8(JSON.stringify(scene)),
      'assets.json': strToU8('garbage'),
      'assets/asset-body.glb': new Uint8Array([1]),
    }
    const p = parseRoomPackage(zipSync(files))
    expect(p.assets[0]).toMatchObject({ id: 'asset-body', kind: 'character' })
  })
  it('rejects an unknown manifest version', () => {
    expect(() => parseRoomPackage(makeZip({ manifest: { version: 2, sceneLabel: 'x' } })))
      .toThrow(/version/)
  })
})

describe('uniqueSceneName', () => {
  it('keeps a free name', () => {
    expect(uniqueSceneName('Hall', new Set(['Other']))).toBe('Hall')
  })
  it('suffixes on collision and keeps counting', () => {
    expect(uniqueSceneName('Hall', new Set(['Hall']))).toBe('Hall (imported)')
    expect(uniqueSceneName('Hall', new Set(['Hall', 'Hall (imported)']))).toBe('Hall (imported 2)')
  })
})

describe('export → import round trip (pure halves)', () => {
  it('rebuilds the same placed objects, NPCs, zones, spawn and audio', () => {
    const exported = buildRoomPackageScene(scene.placedObjects, {
      npcs: scene.npcs,
      zones: scene.zones,
      spawnPoint: scene.spawnPoint,
      ambientAudioAssetId: scene.ambientAudioAssetId,
      ambientAudioVolume: scene.ambientAudioVolume,
    })
    const parsed = parseRoomPackage(makeZip({ sceneJson: exported }))
    const row = buildImportedSceneRow(parsed, 'saved-1', 'Hall', 't')
    expect(row.placedObjects).toEqual(scene.placedObjects)
    expect(row.config).toEqual({
      npcs: scene.npcs,
      zones: scene.zones,
      spawnPoint: scene.spawnPoint,
      ambientAudioAssetId: scene.ambientAudioAssetId,
      ambientAudioVolume: scene.ambientAudioVolume,
    })
  })
})
