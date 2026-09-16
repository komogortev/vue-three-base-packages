import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { deriveGlbLintInput } from '../glbLintAdapter'

function rootWithBoxChild(opts: {
  name?: string
  scale?: [number, number, number]
  position?: [number, number, number]
  boxHeight?: number
  childY?: number
} = {}) {
  const root = new THREE.Group()
  root.name = opts.name ?? 'crystal_shard'
  if (opts.scale) root.scale.set(...opts.scale)
  if (opts.position) root.position.set(...opts.position)

  const boxHeight = opts.boxHeight ?? 2
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, boxHeight, 1))
  // Box geometry is centred on its own origin — lift it so its base sits at y=0.
  mesh.position.y = opts.childY ?? boxHeight / 2
  root.add(mesh)
  root.updateMatrixWorld(true)
  return root
}

describe('deriveGlbLintInput', () => {
  it('reads the root name and unit scale', () => {
    const root = rootWithBoxChild({ name: 'crystal_shard' })
    const out = deriveGlbLintInput(root, 'asset-1')
    expect(out.assetId).toBe('asset-1')
    expect(out.rootName).toBe('crystal_shard')
    expect(out.rootScale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('measures the base-pivot offset in the root local frame', () => {
    const root = rootWithBoxChild({ boxHeight: 2, childY: 1 })
    const out = deriveGlbLintInput(root, 'asset-1')
    expect(out.localBounds.min.y).toBeCloseTo(0, 6)
    expect(out.localBounds.max.y).toBeCloseTo(2, 6)
  })

  it('is unaffected by the root world position/rotation', () => {
    const root = rootWithBoxChild({ boxHeight: 2, childY: 1, position: [50, 50, 50] })
    root.rotation.set(0.3, 1.2, -0.7)
    root.updateMatrixWorld(true)
    const out = deriveGlbLintInput(root, 'asset-1')
    expect(out.localBounds.min.y).toBeCloseTo(0, 6)
  })

  it('restores the root position/rotation after measuring', () => {
    const root = rootWithBoxChild({ position: [3, 4, 5] })
    root.rotation.set(0.1, 0.2, 0.3)
    root.updateMatrixWorld(true)
    const posBefore = root.position.clone()
    const quatBefore = root.quaternion.clone()
    deriveGlbLintInput(root, 'asset-1')
    expect(root.position.equals(posBefore)).toBe(true)
    expect(root.quaternion.equals(quatBefore)).toBe(true)
  })

  it('reports an un-baked scale as-is (scale-sanity is the linter\'s job)', () => {
    const root = rootWithBoxChild({ scale: [2, 2, 2] })
    const out = deriveGlbLintInput(root, 'asset-1')
    expect(out.rootScale).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('handles an empty root without throwing', () => {
    const root = new THREE.Group()
    root.name = 'empty_root'
    const out = deriveGlbLintInput(root, 'asset-1')
    expect(out.localBounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    })
  })
})
