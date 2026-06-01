import { describe, it, expect } from 'vitest'
import { buildRoomPackageScene, serializeEditorConfigTS } from '../SceneEditorExporter'
import type { SavedPlacedObject } from '../sandboxSceneSchema'
import type { SceneEditorConfig, EditorNpcEntry, EditorZoneEntry } from '../sceneEditorTypes'

const placedObj: SavedPlacedObject = {
  id: 'placed-abc', assetId: 'asset-001', label: 'desk.glb',
  x: 1, y: 0, z: 2,
  rotationX: 0, rotationY: 0, rotationZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1,
}

const npc: EditorNpcEntry = { entityId: 'npc-dad', x: 0, z: 0 }

const zone: EditorZoneEntry = { id: 'zone-exit', type: 'exit', x: 5, z: 5, radius: 1.5 }

// ─── buildRoomPackageScene ────────────────────────────────────────────────────

describe('buildRoomPackageScene', () => {
  it('returns empty arrays for a bare config', () => {
    const result = buildRoomPackageScene([], {})
    expect(result.placedObjects).toEqual([])
    expect(result.npcs).toEqual([])
    expect(result.zones).toEqual([])
    expect(result.spawnPoint).toBeUndefined()
    expect(result.ambientAudioAssetId).toBeUndefined()
    expect(result.ambientAudioVolume).toBeUndefined()
  })

  it('passes placedObjects through unchanged', () => {
    const result = buildRoomPackageScene([placedObj], {})
    expect(result.placedObjects).toEqual([placedObj])
  })

  it('passes npcs, zones, spawnPoint, and audio fields from config', () => {
    const config: SceneEditorConfig = {
      npcs: [npc],
      zones: [zone],
      spawnPoint: { x: 2, z: 3 },
      ambientAudioAssetId: 'asset-audio-007',
      ambientAudioVolume: 0.6,
    }
    const result = buildRoomPackageScene([], config)
    expect(result.npcs).toEqual([npc])
    expect(result.zones).toEqual([zone])
    expect(result.spawnPoint).toEqual({ x: 2, z: 3 })
    expect(result.ambientAudioAssetId).toBe('asset-audio-007')
    expect(result.ambientAudioVolume).toBe(0.6)
  })

  it('includes poseOverride on NPC when present', () => {
    const posed: EditorNpcEntry = {
      ...npc,
      poseOverride: [{ bone: 'mixamorigRightHand', q: [0, 0, 0, 1] }],
    }
    const result = buildRoomPackageScene([], { npcs: [posed] })
    expect(result.npcs[0].poseOverride).toEqual([{ bone: 'mixamorigRightHand', q: [0, 0, 0, 1] }])
  })

  it('omits npcs/zones when config fields are absent', () => {
    const result = buildRoomPackageScene([], { spawnPoint: { x: 0, z: 0 } })
    expect(result.npcs).toEqual([])
    expect(result.zones).toEqual([])
  })
})

// ─── serializeEditorConfigTS ─────────────────────────────────────────────────

describe('serializeEditorConfigTS', () => {
  it('produces a TypeScript import and const export', () => {
    const out = serializeEditorConfigTS([], [], {})
    expect(out).toContain("import type { SceneEditorConfig } from '@base/ui'")
    expect(out).toContain('export const SCENE_EDITOR_CONFIG: SceneEditorConfig = {')
  })

  it('renders empty npcs and zones arrays', () => {
    const out = serializeEditorConfigTS([], [], {})
    expect(out).toContain('npcs: []')
    expect(out).toContain('zones: []')
  })

  it('formats NPC rotationY to 3 decimal places (strips trailing zeros)', () => {
    const n: EditorNpcEntry = { entityId: 'n', x: 0, z: 0, rotationY: 45.5 }
    const out = serializeEditorConfigTS([n], [], {})
    expect(out).toContain('rotationY: 45.5')
    expect(out).not.toContain('45.500')
  })

  it('omits NPC rotationY when it is 0', () => {
    const n: EditorNpcEntry = { entityId: 'n', x: 0, z: 0, rotationY: 0 }
    const out = serializeEditorConfigTS([n], [], {})
    expect(out).not.toContain('rotationY')
  })

  it('wraps NPC labels in JSON string quotes', () => {
    const n: EditorNpcEntry = { entityId: 'npc-x', x: 0, z: 0, label: 'Father NPC' }
    const out = serializeEditorConfigTS([n], [], {})
    expect(out).toContain('label: "Father NPC"')
  })

  it('includes zone targetSceneId when set', () => {
    const z: EditorZoneEntry = { id: 'z1', type: 'exit', x: 0, z: 0, radius: 1, targetSceneId: 'scene-02' }
    const out = serializeEditorConfigTS([], [z], {})
    expect(out).toContain('targetSceneId: "scene-02"')
  })

  it('includes spawnPoint when present in config', () => {
    const out = serializeEditorConfigTS([], [], { spawnPoint: { x: 3, z: -1 } })
    expect(out).toContain('spawnPoint:')
    expect(out).toContain('x: 3')
    expect(out).toContain('z: -1')
  })
})
