import { describe, it, expect } from 'vitest'
import { usePoseEditor } from '../usePoseEditor'
import type { PoseBoneNode } from '../sceneEditorTypes'

function node(name: string, depth = 0, parent: string | null = null, hasChildren = false): PoseBoneNode {
  return { name, depth, parent, hasChildren }
}

describe('usePoseEditor', () => {
  it('starts with empty boneList and null selectedBoneName', () => {
    const { boneList, selectedBoneName } = usePoseEditor()
    expect(boneList.value).toEqual([])
    expect(selectedBoneName.value).toBeNull()
  })

  it('setBoneList populates boneList', () => {
    const { boneList, setBoneList } = usePoseEditor()
    const nodes = [node('mixamorigSpine', 0, null, true), node('mixamorigHead', 1, 'mixamorigSpine')]
    setBoneList(nodes)
    expect(boneList.value).toEqual(nodes)
  })

  it('setBoneList resets selectedBoneName', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList([node('mixamorigSpine')])
    selectBone('mixamorigSpine')
    expect(selectedBoneName.value).toBe('mixamorigSpine')
    setBoneList([node('mixamorigHead')])
    expect(selectedBoneName.value).toBeNull()
  })

  it('selectBone sets selectedBoneName', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList([node('mixamorigRightHand'), node('mixamorigLeftHand')])
    selectBone('mixamorigRightHand')
    expect(selectedBoneName.value).toBe('mixamorigRightHand')
  })

  it('selectBone(null) deselects', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList([node('mixamorigSpine')])
    selectBone('mixamorigSpine')
    selectBone(null)
    expect(selectedBoneName.value).toBeNull()
  })

  it('reset clears both boneList and selectedBoneName', () => {
    const { boneList, selectedBoneName, setBoneList, selectBone, reset } = usePoseEditor()
    setBoneList([node('mixamorigSpine', 0, null, true), node('mixamorigHead', 1, 'mixamorigSpine')])
    selectBone('mixamorigSpine')
    reset()
    expect(boneList.value).toEqual([])
    expect(selectedBoneName.value).toBeNull()
  })

  it('instances are independent — no shared ref state', () => {
    const a = usePoseEditor()
    const b = usePoseEditor()
    a.setBoneList([node('bone-a')])
    b.setBoneList([node('bone-b')])
    expect(a.boneList.value.map(n => n.name)).toEqual(['bone-a'])
    expect(b.boneList.value.map(n => n.name)).toEqual(['bone-b'])
  })
})
