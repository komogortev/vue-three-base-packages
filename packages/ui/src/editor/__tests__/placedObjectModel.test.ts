import { describe, it, expect } from 'vitest'

import type { Aabb } from '../gate/verdict'
import type { PlacedAttachment } from '../sandboxSceneSchema'
import {
  FALLBACK_LOCAL_BBOX,
  HITBOX_PADDING,
  IDENTITY_PLACED_TRANSFORM,
  hitBoxDims,
  isEmptyBbox,
  makePlacedObject,
  resolveLocalBbox,
  transformOf,
  withTransform,
  type PlacedTransform,
} from '../placement/placedObjectModel'

const IDENTITY = { id: 'placed-abc123', assetId: 'asset-xyz', label: 'crate.glb' }

const ATTACHMENT: PlacedAttachment = {
  parentId: 'room-root',
  localStart: { x: 0, y: 0, z: 0 },
  localEnd: { x: 0, y: 1, z: 0 },
  contactType: 'surface-contact',
  gapTolerance: 0.01,
}

const TRANSFORM: PlacedTransform = {
  position: { x: 1, y: 2, z: 3 },
  rotation: { x: 0.1, y: 0.2, z: 0.3 },
  scale: { x: 2, y: 2, z: 2 },
}

// ─── bounds ───────────────────────────────────────────────────────────────────

describe('isEmptyBbox / resolveLocalBbox', () => {
  it('treats an inverted box as empty (THREE.Box3 semantics)', () => {
    expect(isEmptyBbox({ min: { x: 1, y: 1, z: 1 }, max: { x: -1, y: -1, z: -1 } })).toBe(true)
  })

  it('treats a real box as non-empty', () => {
    expect(isEmptyBbox({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } })).toBe(false)
  })

  it('substitutes the fallback for null, undefined and empty bounds', () => {
    expect(resolveLocalBbox(null)).toBe(FALLBACK_LOCAL_BBOX)
    expect(resolveLocalBbox(undefined)).toBe(FALLBACK_LOCAL_BBOX)
    expect(resolveLocalBbox({ min: { x: 1, y: 1, z: 1 }, max: { x: -1, y: -1, z: -1 } })).toBe(
      FALLBACK_LOCAL_BBOX,
    )
  })

  it('passes real bounds through untouched', () => {
    const b: Aabb = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } }
    expect(resolveLocalBbox(b)).toBe(b)
  })
})

describe('hitBoxDims', () => {
  it('pads the extent on every axis', () => {
    const { size } = hitBoxDims({ min: { x: -1, y: 0, z: -2 }, max: { x: 1, y: 3, z: 2 } })
    expect(size.x).toBeCloseTo(2 + HITBOX_PADDING, 6)
    expect(size.y).toBeCloseTo(3 + HITBOX_PADDING, 6)
    expect(size.z).toBeCloseTo(4 + HITBOX_PADDING, 6)
  })

  it('centres on the bounds, not the pivot — geometry with an off-centre pivot still wraps', () => {
    // Base-pivot prop: origin at the floor, geometry rising 1.8 m above it.
    const { center } = hitBoxDims({ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1.8, z: 0.5 } })
    expect(center).toEqual({ x: 0, y: 0.9, z: 0 })
  })
})

// ─── record construction ──────────────────────────────────────────────────────

describe('makePlacedObject', () => {
  it('writes identity and transform into the flat record shape', () => {
    const o = makePlacedObject(IDENTITY, TRANSFORM)
    expect(o).toMatchObject({
      id: 'placed-abc123',
      assetId: 'asset-xyz',
      label: 'crate.glb',
      x: 1, y: 2, z: 3,
      rotationX: 0.1, rotationY: 0.2, rotationZ: 0.3,
      scaleX: 2, scaleY: 2, scaleZ: 2,
    })
  })

  it('omits the attachment key entirely for a free placement', () => {
    const o = makePlacedObject(IDENTITY, IDENTITY_PLACED_TRANSFORM)
    expect('attachment' in o).toBe(false)
  })

  it('carries an attachment through when one is supplied', () => {
    const o = makePlacedObject(IDENTITY, TRANSFORM, ATTACHMENT)
    expect(o.attachment).toEqual(ATTACHMENT)
  })

  it('a fresh drop is identity-transformed apart from its drop position', () => {
    const o = makePlacedObject(IDENTITY, {
      ...IDENTITY_PLACED_TRANSFORM,
      position: { x: 4, y: 0, z: -4 },
    })
    expect([o.rotationX, o.rotationY, o.rotationZ]).toEqual([0, 0, 0])
    expect([o.scaleX, o.scaleY, o.scaleZ]).toEqual([1, 1, 1])
    expect([o.x, o.y, o.z]).toEqual([4, 0, -4])
  })
})

describe('withTransform', () => {
  it('re-stamps the transform and preserves everything else', () => {
    const saved = makePlacedObject(IDENTITY, TRANSFORM, ATTACHMENT)
    const moved = withTransform(saved, IDENTITY_PLACED_TRANSFORM)
    expect([moved.x, moved.y, moved.z]).toEqual([0, 0, 0])
    expect(moved.attachment).toEqual(ATTACHMENT)
    expect(moved.label).toBe('crate.glb')
  })
})

describe('transformOf', () => {
  it('round-trips a record through transformOf → makePlacedObject', () => {
    const a = makePlacedObject(IDENTITY, TRANSFORM, ATTACHMENT)
    const b = makePlacedObject(IDENTITY, transformOf(a), a.attachment)
    expect(b).toEqual(a)
  })
})

// ─── regression ───────────────────────────────────────────────────────────────

describe('F-G3 regression — attachment survives the save/load boundary', () => {
  it('survives a full place → save → restore → save cycle', () => {
    // 1. authored: a placement that carries attachment metadata
    const authored = makePlacedObject(IDENTITY, TRANSFORM, ATTACHMENT)

    // 2. saved: snapshot re-stamps the live transform
    const saved = withTransform(authored, {
      position: { x: 9, y: 0, z: 9 },
      rotation: { x: 0, y: 1.57, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    expect(saved.attachment).toEqual(ATTACHMENT)

    // 3. restored: rebuilt from the saved record — this is the step that used to
    //    drop `attachment`, making runPlacementGate() a permanent no-op.
    const restored = makePlacedObject(
      { id: saved.id, assetId: saved.assetId, label: saved.label },
      transformOf(saved),
      saved.attachment,
    )
    expect(restored.attachment).toEqual(ATTACHMENT)

    // 4. saved again: still there
    expect(withTransform(restored, transformOf(restored)).attachment).toEqual(ATTACHMENT)
  })
})
