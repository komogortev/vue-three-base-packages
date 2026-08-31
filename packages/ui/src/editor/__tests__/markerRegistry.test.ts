import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

import { createMarkerRegistry } from '../markerRegistry'
import { ZONE_DEFAULT_COLORS } from '../markerStyle'
import type { SceneEditorConfig } from '../sceneEditorTypes'

const CFG = {
  npcs: [
    { entityId: 'npc-a', label: 'A', x: 1, z: 2 },
    { entityId: 'npc-b', label: 'B', x: 3, y: 5, z: 4, proximityRadius: 2 },
  ],
  zones: [
    { id: 'z-exit', type: 'exit', label: 'Door', x: 7, z: 8, radius: 3 },
    { id: 'z-prox', type: 'proximity', label: 'Trigger', x: 9, z: 10, radius: 1, color: 0x00ff88 },
  ],
  spawnPoint: { x: -2, z: -3 },
} as unknown as SceneEditorConfig

function materialColor(mesh: THREE.Mesh): string {
  return '#' + (mesh.material as THREE.MeshBasicMaterial).color.getHexString()
}

describe('createMarkerRegistry — build', () => {
  it('populates roots, click targets and live positions from config', () => {
    const r = createMarkerRegistry()
    const npcLive = r.buildNpcs(CFG)
    const zoneLive = r.buildZones(CFG)

    expect(r.npcRootEntries().map(([id]) => id).sort()).toEqual(['npc-a', 'npc-b'])
    expect(r.npcSphereEntries().map(([id]) => id).sort()).toEqual(['npc-a', 'npc-b'])
    expect(r.zoneRootEntries().map(([id]) => id).sort()).toEqual(['z-exit', 'z-prox'])
    expect(r.zonePipEntries().map(([id]) => id).sort()).toEqual(['z-exit', 'z-prox'])

    expect(npcLive.get('npc-a')).toEqual({ x: 1, y: 0, z: 2 })
    expect(npcLive.get('npc-b')).toEqual({ x: 3, y: 5, z: 4 })
    expect(zoneLive.get('z-exit')).toEqual({ x: 7, z: 8 })
  })

  it('places marker roots at their configured world position, defaulting y to 0', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    expect(r.npcRoot('npc-a')!.position.toArray()).toEqual([1, 0, 2])
    expect(r.npcRoot('npc-b')!.position.toArray()).toEqual([3, 5, 4])
  })

  it('adds a proximity ring only when the NPC declares a radius', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    // sphere + stem, plus a ring only for npc-b
    expect(r.npcRoot('npc-a')!.children).toHaveLength(2)
    expect(r.npcRoot('npc-b')!.children).toHaveLength(3)
  })

  it('applies the zone colour rule to the pip', () => {
    const r = createMarkerRegistry()
    r.buildZones(CFG)
    expect(materialColor(r.zonePip('z-exit')!)).toBe(ZONE_DEFAULT_COLORS.exit)
    expect(materialColor(r.zonePip('z-prox')!)).toBe('#00ff88')
  })

  it('rebuilds idempotently rather than accumulating', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.buildNpcs(CFG)
    expect(r.npcRootEntries()).toHaveLength(2)
    expect(r.npcGroup.children).toHaveLength(2)
  })

  it('tolerates a config with no npcs or zones', () => {
    const r = createMarkerRegistry()
    expect(r.buildNpcs({} as SceneEditorConfig).size).toBe(0)
    expect(r.buildZones({} as SceneEditorConfig).size).toBe(0)
    expect(r.npcGroup.children).toHaveLength(0)
  })
})

describe('createMarkerRegistry — spawn mesh', () => {
  it('returns a positioned mesh the caller owns, not a group child', () => {
    const r = createMarkerRegistry()
    const mesh = r.buildSpawnMesh(CFG)!
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.position.toArray()).toEqual([-2, 0.4, -3])
    expect(r.npcGroup.children).toHaveLength(0)
    expect(r.zoneGroup.children).toHaveLength(0)
  })

  it('returns null when the config declares no spawn point', () => {
    expect(createMarkerRegistry().buildSpawnMesh({} as SceneEditorConfig)).toBeNull()
  })
})

describe('createMarkerRegistry — incremental add/remove (F-11)', () => {
  it('adds a marker into both the group and the lookups', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.addNpc({ entityId: 'npc-c', x: 0, z: 0 } as never)
    expect(r.npcRoot('npc-c')).toBeDefined()
    expect(r.npcGroup.children).toHaveLength(3)
  })

  it('removes a marker from the group and every lookup', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.removeNpc('npc-a')
    expect(r.npcRoot('npc-a')).toBeUndefined()
    expect(r.npcSphere('npc-a')).toBeUndefined()
    expect(r.npcGroup.children).toHaveLength(1)
  })

  it('removing an unknown id is a no-op, not a throw', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    expect(() => r.removeNpc('ghost')).not.toThrow()
    expect(() => r.removeZone('ghost')).not.toThrow()
    expect(r.npcRootEntries()).toHaveLength(2)
  })

  it('removes zones from the group and every lookup', () => {
    const r = createMarkerRegistry()
    r.buildZones(CFG)
    r.removeZone('z-exit')
    expect(r.zoneRoot('z-exit')).toBeUndefined()
    expect(r.zonePip('z-exit')).toBeUndefined()
    expect(r.zoneGroup.children).toHaveLength(1)
  })
})

describe('createMarkerRegistry — clear', () => {
  it('empties both groups and all four lookups', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.buildZones(CFG)
    r.clear()
    expect(r.npcGroup.children).toHaveLength(0)
    expect(r.zoneGroup.children).toHaveLength(0)
    expect(r.npcRootEntries()).toHaveLength(0)
    expect(r.zoneRootEntries()).toHaveLength(0)
    expect(r.npcSphereEntries()).toHaveLength(0)
    expect(r.zonePipEntries()).toHaveLength(0)
  })

  it('supports a clear → rebuild cycle (scene switch)', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.clear()
    const live = r.buildNpcs(CFG)
    expect(live.size).toBe(2)
    expect(r.npcGroup.children).toHaveLength(2)
    expect(r.npcSphere('npc-a')).toBeInstanceOf(THREE.Mesh)
  })
})

describe('createMarkerRegistry — dispose', () => {
  it('drops every lookup so the composable does not have to clear them by hand', () => {
    const r = createMarkerRegistry()
    r.buildNpcs(CFG)
    r.buildZones(CFG)
    r.dispose()
    expect(r.npcRootEntries()).toHaveLength(0)
    expect(r.zoneRootEntries()).toHaveLength(0)
    expect(r.npcSphereEntries()).toHaveLength(0)
    expect(r.zonePipEntries()).toHaveLength(0)
  })
})
