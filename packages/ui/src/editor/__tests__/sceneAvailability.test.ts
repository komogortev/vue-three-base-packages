import { describe, it, expect } from 'vitest'
import {
  collectSceneAssetIds,
  classifyScene,
  classifyScenes,
  isSceneLoadable,
} from '../scenes/sceneAvailability'
import type { SceneRow } from '../assetDb'
import type { SavedPlacedObject } from '../sandboxSceneSchema'

function placed(id: string, assetId: string): SavedPlacedObject {
  return {
    id, assetId, label: `${assetId}.glb`,
    x: 0, y: 0, z: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
  }
}

function row(partial: Partial<SceneRow> = {}): SceneRow {
  return {
    id: 'scene-1',
    name: 'Test Scene',
    savedAt: '2026-09-04T00:00:00.000Z',
    placedObjects: [],
    ...partial,
  } as SceneRow
}

/** Library containing exactly the given ids. */
const libraryOf = (...ids: string[]) => (id: string) => ids.includes(id)

// ─── collectSceneAssetIds ─────────────────────────────────────────────────────

describe('collectSceneAssetIds', () => {
  it('returns placed-object asset ids', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1'), placed('placed-b', 'asset-2')] })
    expect(collectSceneAssetIds(r)).toEqual(['asset-1', 'asset-2'])
  })

  it('de-duplicates ids shared by several placed objects', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1'), placed('placed-b', 'asset-1')] })
    expect(collectSceneAssetIds(r)).toEqual(['asset-1'])
  })

  it('includes NPC body and animation-pack ids', () => {
    const r = row({
      config: {
        npcs: [{ entityId: 'npc-1', x: 0, z: 0, assetId: 'asset-body', animationPackAssetId: 'asset-pack' }],
      },
    })
    expect(collectSceneAssetIds(r)).toEqual(['asset-body', 'asset-pack'])
  })

  it('includes the ambient audio track', () => {
    const r = row({ config: { ambientAudioAssetId: 'asset-audio' } })
    expect(collectSceneAssetIds(r)).toEqual(['asset-audio'])
  })

  // v1/v2 rows predate `config` — a legacy row must not throw.
  it('tolerates a row with no config', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1')], config: undefined })
    expect(collectSceneAssetIds(r)).toEqual(['asset-1'])
  })

  it('tolerates an NPC with no asset binding', () => {
    const r = row({ config: { npcs: [{ entityId: 'npc-1', x: 0, z: 0 }] } })
    expect(collectSceneAssetIds(r)).toEqual([])
  })
})

// ─── classifyScene ────────────────────────────────────────────────────────────

describe('classifyScene', () => {
  it('is ok when every referenced asset resolves', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1'), placed('placed-b', 'asset-2')] })
    const a = classifyScene(r, libraryOf('asset-1', 'asset-2'))
    expect(a.status).toBe('ok')
    expect(a.missing).toEqual([])
  })

  it('is partial when some assets resolve', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1'), placed('placed-b', 'asset-2')] })
    const a = classifyScene(r, libraryOf('asset-1'))
    expect(a.status).toBe('partial')
    expect(a.missing).toEqual(['asset-2'])
  })

  it('is unloadable when no referenced asset resolves', () => {
    const r = row({ placedObjects: [placed('placed-a', 'asset-1'), placed('placed-b', 'asset-2')] })
    const a = classifyScene(r, libraryOf())
    expect(a.status).toBe('unloadable')
    expect(a.missing).toEqual(['asset-1', 'asset-2'])
  })

  // An empty scene is a legitimate starting point. Classifying it unloadable
  // would hide every freshly-created scene from the switcher.
  it('is ok for a scene that references no assets at all', () => {
    const a = classifyScene(row(), libraryOf())
    expect(a.status).toBe('ok')
    expect(a.referenced).toEqual([])
  })

  it('counts a missing NPC body toward unloadability', () => {
    const r = row({ config: { npcs: [{ entityId: 'npc-1', x: 0, z: 0, assetId: 'asset-body' }] } })
    expect(classifyScene(r, libraryOf()).status).toBe('unloadable')
    expect(classifyScene(r, libraryOf('asset-body')).status).toBe('ok')
  })
})

// ─── isSceneLoadable ──────────────────────────────────────────────────────────

describe('isSceneLoadable', () => {
  it('accepts ok and partial, rejects unloadable', () => {
    expect(isSceneLoadable({ status: 'ok', referenced: [], missing: [] })).toBe(true)
    expect(isSceneLoadable({ status: 'partial', referenced: ['a', 'b'], missing: ['b'] })).toBe(true)
    expect(isSceneLoadable({ status: 'unloadable', referenced: ['a'], missing: ['a'] })).toBe(false)
  })

  // Negative control: a library that resolves everything must never produce a
  // hidden scene. If this ever fails, the dropdown is filtering healthy rows.
  it('never hides a scene whose assets all resolve', () => {
    const r = row({
      placedObjects: [placed('placed-a', 'asset-1')],
      config: {
        npcs: [{ entityId: 'npc-1', x: 0, z: 0, assetId: 'asset-2', animationPackAssetId: 'asset-3' }],
        ambientAudioAssetId: 'asset-4',
      },
    })
    const a = classifyScene(r, libraryOf('asset-1', 'asset-2', 'asset-3', 'asset-4'))
    expect(isSceneLoadable(a)).toBe(true)
    expect(a.status).toBe('ok')
  })
})

// ─── classifyScenes — the not-yet-loaded guard ────────────────────────────────
//
// This is the regression guard for the one irreversible action in the feature.
// The asset library arrives asynchronously and its "not yet" value is an empty
// array, indistinguishable from a genuinely empty library. Judging against that
// seed marks every asset-bearing scene unloadable — hiding healthy scenes and
// offering a permanent delete on intact ones.

describe('classifyScenes', () => {
  const withAsset = row({ id: 'scene-a', placedObjects: [placed('placed-a', 'asset-1')] })
  const empty = row({ id: 'scene-b' })

  it('asserts nothing while the library has not loaded, even though nothing resolves', () => {
    const out = classifyScenes([withAsset, empty], libraryOf(), /* libraryLoaded */ false)
    expect(out.map(e => e.availability.status)).toEqual(['ok', 'ok'])
    expect(out.every(e => isSceneLoadable(e.availability))).toBe(true)
  })

  // The failure this guard exists to prevent: same inputs, loaded=true, and the
  // scene becomes a delete candidate. If these two tests ever agree, the guard
  // is gone.
  it('does classify once the library has loaded', () => {
    const out = classifyScenes([withAsset, empty], libraryOf(), /* libraryLoaded */ true)
    expect(out.map(e => e.availability.status)).toEqual(['unloadable', 'ok'])
    expect(isSceneLoadable(out[0].availability)).toBe(false)
  })

  it('classifies normally when the library has loaded and resolves', () => {
    const out = classifyScenes([withAsset], libraryOf('asset-1'), true)
    expect(out[0].availability.status).toBe('ok')
  })

  it('preserves row order and identity', () => {
    const out = classifyScenes([withAsset, empty], libraryOf('asset-1'), true)
    expect(out.map(e => e.scene.id)).toEqual(['scene-a', 'scene-b'])
    expect(out[0].scene).toBe(withAsset)
  })

  it('returns an empty list for no rows, loaded or not', () => {
    expect(classifyScenes([], libraryOf(), false)).toEqual([])
    expect(classifyScenes([], libraryOf(), true)).toEqual([])
  })
})
