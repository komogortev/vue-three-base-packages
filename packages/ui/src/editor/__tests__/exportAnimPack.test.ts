import { describe, it, expect } from 'vitest'
import { buildAnimPackRow } from '../anim/exportAnimPack'

describe('buildAnimPackRow', () => {
  const blob = new Blob([new Uint8Array(64)], { type: 'model/gltf-binary' })

  it('assembles a valid animation-pack asset row', () => {
    const row = buildAnimPackRow('wave', blob)
    expect(row.id).toMatch(/^asset-/)
    expect(row.name).toBe('wave.glb')
    expect(row.kind).toBe('animation-pack')
    expect(row.size).toBe(64)
    expect(row.contentType).toBe('model/gltf-binary')
    expect(row.blob).toBe(blob)
    expect(row.clipNames).toEqual(['wave'])
    expect(row.thumbnail).toBeUndefined()
    // createdAt is ISO 8601 and parseable
    expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false)
  })

  it('generates a fresh id per call', () => {
    expect(buildAnimPackRow('a', blob).id).not.toBe(buildAnimPackRow('a', blob).id)
  })

  it('carries the optional thumbnail through', () => {
    const thumb = new Blob([new Uint8Array(8)], { type: 'image/png' })
    expect(buildAnimPackRow('wave', blob, thumb).thumbnail).toBe(thumb)
  })

  it('strips path separators from the display name (clipNames untouched)', () => {
    const row = buildAnimPackRow('foo/bar\\baz', blob)
    expect(row.name).toBe('foo_bar_baz.glb')
    expect(row.clipNames).toEqual(['foo/bar\\baz'])
  })
})
