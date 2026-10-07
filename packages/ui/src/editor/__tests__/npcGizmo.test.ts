import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  gizmoAxes,
  yawDegrees,
  entryScaleFor,
  roundYaw,
  roundScale,
  uniformScaleFrom,
  changedYaw,
  changedScale,
  entriesToApply,
  MIN_ENTRY_SCALE,
} from '../pose/npcGizmo'

describe('gizmoAxes', () => {
  it('limits an NPC model to ground-plane translate, Y rotate and uniform scale', () => {
    expect(gizmoAxes('translate', 'npc-model')).toEqual({ x: true, y: false, z: true })
    expect(gizmoAxes('rotate', 'npc-model')).toEqual({ x: false, y: true, z: false })
    expect(gizmoAxes('scale', 'npc-model')).toEqual({ x: true, y: true, z: true })
  })

  it('lets the marker pin move on the ground plane only, never rotate or scale', () => {
    expect(gizmoAxes('translate', 'npc-marker')).toEqual({ x: true, y: false, z: true })
    expect(gizmoAxes('rotate', 'npc-marker')).toEqual({ x: false, y: false, z: false })
    expect(gizmoAxes('scale', 'npc-marker')).toEqual({ x: false, y: false, z: false })
  })

  // Negative control: anything that is not an NPC must keep every handle, or
  // selecting a bone / zone / placed object after an NPC would inherit the limits.
  it.each(['translate', 'rotate', 'scale'] as const)('%s keeps all axes off an NPC', mode => {
    expect(gizmoAxes(mode, 'other')).toEqual({ x: true, y: true, z: true })
  })
})

describe('yawDegrees', () => {
  const yawQ = (deg: number) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180)

  it.each([0, 45, 90, 150, 180, 270, 359])('recovers a %i° yaw from the quaternion', deg => {
    expect(yawDegrees(yawQ(deg))).toBeCloseTo(deg, 6)
  })

  it('normalises negative angles into [0, 360)', () => {
    expect(yawDegrees(yawQ(-90))).toBeCloseTo(270, 6)
  })

  it('is right where Euler.y is wrong (a pure yaw past 90°)', () => {
    // Known positive for the reason this helper exists.
    const q = yawQ(150)
    const euler = new THREE.Euler().setFromQuaternion(q)
    expect((euler.y * 180) / Math.PI).not.toBeCloseTo(150, 3) // three returns 30° with x,z = 180°
    expect(yawDegrees(q)).toBeCloseTo(150, 6)
  })
})

describe('entryScaleFor', () => {
  it('divides the model scale by the fit-rescue base', () => {
    expect(entryScaleFor(2, 1)).toBe(2)
    expect(entryScaleFor(0.034, 0.017)).toBeCloseTo(2, 9)
  })
  it('falls back to 1 for a degenerate base', () => {
    expect(entryScaleFor(3, 0)).toBe(1)
    expect(entryScaleFor(3, NaN)).toBe(1)
  })
})

describe('rounding', () => {
  it('rounds yaw to 0.01° and scale to 0.001', () => {
    expect(roundYaw(150.123456)).toBe(150.12)
    expect(roundScale(1.23456)).toBe(1.2346)
  })
  it('keeps a rounded yaw inside [0, 360)', () => {
    expect(roundYaw(359.996)).toBe(0) // rounds to 360 first; must wrap, not return 360
    expect(roundYaw(-0.001)).toBe(0)
  })
  it('never lets a dragged scale reach zero or go negative', () => {
    expect(roundScale(0)).toBe(MIN_ENTRY_SCALE)
    expect(roundScale(-2)).toBe(MIN_ENTRY_SCALE)
  })
})

describe('uniformScaleFrom', () => {
  const start = { x: 0.5, y: 0.5, z: 0.5 }

  it('follows whichever single axis handle moved, not only X', () => {
    expect(uniformScaleFrom({ x: 1, y: 0.5, z: 0.5 }, start)).toBeCloseTo(1)
    expect(uniformScaleFrom({ x: 0.5, y: 1, z: 0.5 }, start)).toBeCloseTo(1) // Y handle: used to do nothing
    expect(uniformScaleFrom({ x: 0.5, y: 0.5, z: 1 }, start)).toBeCloseTo(1) // Z handle: used to do nothing
  })

  it('follows the centre handle, which moves all three together', () => {
    expect(uniformScaleFrom({ x: 1.5, y: 1.5, z: 1.5 }, start)).toBeCloseTo(1.5)
  })

  it('shrinks as well as grows', () => {
    expect(uniformScaleFrom({ x: 0.5, y: 0.25, z: 0.5 }, start)).toBeCloseTo(0.25)
  })

  it('picks the axis that moved furthest when several differ', () => {
    expect(uniformScaleFrom({ x: 0.6, y: 1.0, z: 0.55 }, start)).toBeCloseTo(1.0)
  })

  it('is the start scale when nothing moved', () => {
    expect(uniformScaleFrom(start, start)).toBeCloseTo(0.5)
  })

  it('falls back to x when the start scale is degenerate', () => {
    expect(uniformScaleFrom({ x: 2, y: 2, z: 2 }, { x: 0, y: 0, z: 0 })).toBe(2)
  })
})

describe('changedYaw / changedScale (publish only what the gesture changed)', () => {
  it('leaves an authored yaw alone when the drag did not change it', () => {
    expect(changedYaw(315, -45)).toBeUndefined() // same angle, different spelling
    expect(changedYaw(33.333, 33.333)).toBeUndefined() // not rewritten as 33.33
    expect(changedYaw(0, undefined)).toBeUndefined() // undefined stays undefined
  })
  it('publishes a yaw that really changed, across the 0/360 seam', () => {
    expect(changedYaw(150, 180)).toBe(150)
    expect(changedYaw(1, 359)).toBe(1)
  })
  it('leaves an authored scale alone, publishes a changed one', () => {
    expect(changedScale(1.23456, 1.23456)).toBeUndefined()
    expect(changedScale(1, undefined)).toBeUndefined()
    expect(changedScale(2, 1)).toBe(2)
  })
})

describe('entriesToApply (the live map is replaced wholesale on every publish)', () => {
  it('returns only the ids published since last time', () => {
    const a1 = { v: 1 }, b1 = { v: 1 }
    const seen = new Map<string, { v: number }>()
    expect(entriesToApply(new Map([['a', a1], ['b', b1]]), seen).map(e => e[0]).sort()).toEqual(['a', 'b'])
    // b is republished (new object); a is carried over by reference
    const b2 = { v: 2 }
    expect(entriesToApply(new Map([['a', a1], ['b', b2]]), seen).map(e => e[0])).toEqual(['b'])
  })

  it('does not re-apply a stale entry when only another id changed (the inspector-edit overwrite)', () => {
    // A was gizmo-scaled to 2, then the author typed 3 in the inspector. Dragging B
    // replaces the map; A's old entry must not be applied again.
    const aStale = { scale: 2 }
    const seen = new Map<string, { scale: number }>()
    entriesToApply(new Map([['A', aStale]]), seen) // A's gizmo publish, applied
    const bNew = { scale: 1 }
    const again = entriesToApply(new Map([['A', aStale], ['B', bNew]]), seen)
    expect(again.map(e => e[0])).toEqual(['B'])
  })

  it('forgets ids that left the map, so a re-added NPC applies again', () => {
    const seen = new Map<string, { v: number }>()
    const a = { v: 1 }
    entriesToApply(new Map([['a', a]]), seen)
    entriesToApply(new Map(), seen)
    expect(entriesToApply(new Map([['a', a]]), seen).map(e => e[0])).toEqual(['a'])
  })
})
