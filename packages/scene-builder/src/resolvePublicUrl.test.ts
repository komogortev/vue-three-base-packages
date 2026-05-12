import { describe, it, expect } from 'vitest'
import { resolveStaticAssetUrl, bindResolvePublicUrl } from './resolvePublicUrl'

describe('resolveStaticAssetUrl', () => {
  it('returns empty string unchanged', () => {
    expect(resolveStaticAssetUrl('', '/base/')).toBe('')
  })

  it('passes through absolute https URLs', () => {
    const url = 'https://cdn.example.com/model.glb'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })

  it('passes through absolute http URLs', () => {
    const url = 'http://localhost:3000/model.glb'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })

  it('passes through blob: URLs', () => {
    const url = 'blob:https://example.com/abc-123'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })

  it('passes through data: URLs', () => {
    const url = 'data:image/png;base64,abc'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })

  it('prepends non-root base to root-relative path', () => {
    expect(resolveStaticAssetUrl('/Remy.fbx', '/three-dreams/')).toBe('/three-dreams/Remy.fbx')
  })

  it('does not double-prepend when path already starts with base', () => {
    const already = '/three-dreams/assets/model-HASH.fbx'
    expect(resolveStaticAssetUrl(already, '/three-dreams/')).toBe(already)
  })

  it('prepends root base "/" leaving path unchanged', () => {
    // base is "/", so /Remy.fbx → /Remy.fbx (slice(1) prepended to "/")
    expect(resolveStaticAssetUrl('/Remy.fbx', '/')).toBe('/Remy.fbx')
  })

  it('returns non-root-relative paths unchanged', () => {
    const url = 'relative/path/model.glb'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })

  it('is case-insensitive for protocol prefix check (HTTPS)', () => {
    const url = 'HTTPS://example.com/file.png'
    expect(resolveStaticAssetUrl(url, '/base/')).toBe(url)
  })
})

describe('bindResolvePublicUrl', () => {
  it('normalises a base without trailing slash', () => {
    const resolve = bindResolvePublicUrl('/app')
    expect(resolve('/model.glb')).toBe('/app/model.glb')
  })

  it('does not double-slash when base already has trailing slash', () => {
    const resolve = bindResolvePublicUrl('/app/')
    expect(resolve('/model.glb')).toBe('/app/model.glb')
  })

  it('returned function passes through absolute URLs', () => {
    const resolve = bindResolvePublicUrl('/app/')
    expect(resolve('https://cdn.example.com/x.glb')).toBe('https://cdn.example.com/x.glb')
  })
})
