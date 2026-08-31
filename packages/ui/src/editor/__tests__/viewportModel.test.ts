import { describe, it, expect } from 'vitest'

import { describeSelection, sceneStatus } from '../selectionText'
import { fitScaleFor, FIT_TARGET_HEIGHT, FIT_MIN_HEIGHT, FIT_MAX_HEIGHT } from '../characterFit'
import { CAM_MODE_ORDER, nextCamMode } from '../camModes'
import { ZONE_DEFAULT_COLORS, zoneColorHex } from '../markerStyle'
import type { EditorPlacedObject, SceneEditorConfig } from '../sceneEditorTypes'

// ─── selectionText ────────────────────────────────────────────────────────────

const CONFIG = {
  npcs: [{ entityId: 'npc-dad', label: 'Dad', x: 0, z: 0 }],
  zones: [{ id: 'z1', type: 'exit' as const, label: 'Door', x: 1, z: 1, radius: 2 }],
} as unknown as SceneEditorConfig

const PLACED = [{ id: 'placed-a', assetId: 'asset-1', label: 'crate.glb' }] as EditorPlacedObject[]
const ctx = (pathEditActive = false) => ({ config: CONFIG, placedObjects: PLACED, pathEditActive })

describe('sceneStatus', () => {
  it('pluralises independently for NPCs and zones', () => {
    expect(sceneStatus({ npcs: [], zones: [] } as unknown as SceneEditorConfig)).toBe(
      'Scene loaded — 0 NPCs, 0 zones',
    )
    expect(sceneStatus(CONFIG)).toBe('Scene loaded — 1 NPC, 1 zone')
  })

  it('treats absent collections as empty', () => {
    expect(sceneStatus({} as SceneEditorConfig)).toBe('Scene loaded — 0 NPCs, 0 zones')
  })
})

describe('describeSelection', () => {
  it('falls back to the scene status for scene/null selections', () => {
    expect(describeSelection({ kind: 'scene' }, ctx())).toBe(sceneStatus(CONFIG))
    expect(describeSelection(null as never, ctx())).toBe(sceneStatus(CONFIG))
  })

  it('names an NPC by label, and adds the waypoint hint only in path-edit mode', () => {
    expect(describeSelection({ kind: 'npc', entityId: 'npc-dad' }, ctx(false))).toBe('NPC: Dad')
    expect(describeSelection({ kind: 'npc', entityId: 'npc-dad' }, ctx(true))).toBe(
      'NPC: Dad — click floor to add waypoint',
    )
  })

  it('falls back to the raw id when the entity is missing from config (stale selection)', () => {
    expect(describeSelection({ kind: 'npc', entityId: 'ghost' }, ctx())).toBe('NPC: ghost')
    expect(describeSelection({ kind: 'zone', id: 'ghost' }, ctx())).toBe(
      'Zone: ghost (unknown, r=?m)',
    )
    expect(describeSelection({ kind: 'placed', objectId: 'ghost' }, ctx())).toBe('Object: ghost')
  })

  it('describes zones and placed objects', () => {
    expect(describeSelection({ kind: 'zone', id: 'z1' }, ctx())).toBe('Zone: Door (exit, r=2m)')
    expect(describeSelection({ kind: 'placed', objectId: 'placed-a' }, ctx())).toBe(
      'Object: crate.glb',
    )
  })
})

// ─── characterFit ─────────────────────────────────────────────────────────────

describe('fitScaleFor', () => {
  it('leaves a correctly-sized mesh alone (no double-scaling)', () => {
    expect(fitScaleFor(1.8)).toBeNull()
    expect(fitScaleFor(FIT_MIN_HEIGHT)).toBeNull()
    expect(fitScaleFor(FIT_MAX_HEIGHT)).toBeNull()
  })

  it('rescues a centimetre-authored mesh to the target height', () => {
    const f = fitScaleFor(180)!
    expect(f).not.toBeNull()
    expect(180 * f).toBeCloseTo(FIT_TARGET_HEIGHT, 6)
  })

  it('rescues an undersized mesh to the target height', () => {
    const f = fitScaleFor(0.018)!
    expect(0.018 * f).toBeCloseTo(FIT_TARGET_HEIGHT, 6)
  })

  it('declines to act on unmeasurable bounds', () => {
    expect(fitScaleFor(0)).toBeNull()
    expect(fitScaleFor(-1)).toBeNull()
    expect(fitScaleFor(NaN)).toBeNull()
  })
})

// ─── camModes ─────────────────────────────────────────────────────────────────

describe('nextCamMode', () => {
  it('cycles through every mode and wraps back to the head', () => {
    let m = CAM_MODE_ORDER[0]!
    const seen = [m]
    for (let i = 0; i < CAM_MODE_ORDER.length - 1; i++) {
      m = nextCamMode(m)
      seen.push(m)
    }
    expect(seen).toEqual([...CAM_MODE_ORDER])
    expect(nextCamMode(m)).toBe(CAM_MODE_ORDER[0])
  })

  it('restarts the cycle on an unknown mode rather than wrapping backwards', () => {
    expect(nextCamMode('nonsense' as never)).toBe(CAM_MODE_ORDER[0])
  })
})

// ─── markerStyle ──────────────────────────────────────────────────────────────

describe('zoneColorHex', () => {
  it('uses the per-type default when no override is set', () => {
    expect(zoneColorHex({ type: 'exit' })).toBe(ZONE_DEFAULT_COLORS.exit)
    expect(zoneColorHex({ type: 'proximity' })).toBe(ZONE_DEFAULT_COLORS.proximity)
  })

  it('zero-pads a numeric override to six digits', () => {
    // 0x00ff88 unpadded renders as "#ff88" — a valid but different CSS colour.
    expect(zoneColorHex({ type: 'exit', color: 0x00ff88 })).toBe('#00ff88')
    expect(zoneColorHex({ type: 'exit', color: 0xffdd44 })).toBe('#ffdd44')
  })

  it('honours black as an override rather than falling back to the default', () => {
    expect(zoneColorHex({ type: 'exit', color: 0x000000 })).toBe('#000000')
  })
})
