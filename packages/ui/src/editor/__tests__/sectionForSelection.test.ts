import { describe, it, expect } from 'vitest'
import { sectionForSelection, selectionKey } from '../hierarchy/sectionForSelection'

describe('sectionForSelection', () => {
  it('maps each object kind to its own section', () => {
    expect(sectionForSelection({ kind: 'npc', entityId: 'a' })).toBe('npcs')
    expect(sectionForSelection({ kind: 'placed', objectId: 'o' })).toBe('objects')
    expect(sectionForSelection({ kind: 'zone', id: 'z' })).toBe('zones')
  })

  // Negative controls: these must NOT open a section, or "Scene Settings" and
  // "Player View" would pop an unrelated list open on every click.
  it.each([
    [{ kind: 'player' } as const],
    [{ kind: 'scene' } as const],
    [null],
  ])('maps %j to no section', sel => {
    expect(sectionForSelection(sel)).toBeNull()
  })
})

describe('selectionKey', () => {
  it('is stable for the same selection and differs between selections', () => {
    expect(selectionKey({ kind: 'npc', entityId: 'a' })).toBe(selectionKey({ kind: 'npc', entityId: 'a' }))
    expect(selectionKey({ kind: 'npc', entityId: 'a' })).not.toBe(selectionKey({ kind: 'npc', entityId: 'b' }))
  })

  it('does not collide across kinds that share an id', () => {
    const keys = new Set([
      selectionKey({ kind: 'npc', entityId: 'x' }),
      selectionKey({ kind: 'zone', id: 'x' }),
      selectionKey({ kind: 'placed', objectId: 'x' }),
    ])
    expect(keys.size).toBe(3)
  })

  it('keys the id-less selections by kind, and null as empty', () => {
    expect(selectionKey({ kind: 'player' })).toBe('player')
    expect(selectionKey({ kind: 'scene' })).toBe('scene')
    expect(selectionKey(null)).toBe('')
  })
})
