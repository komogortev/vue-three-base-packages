import { describe, it, expect } from 'vitest'
import { usePoseEditor } from '../usePoseEditor'

describe('usePoseEditor', () => {
  it('starts with empty boneList and null selectedBoneName', () => {
    const { boneList, selectedBoneName } = usePoseEditor()
    expect(boneList.value).toEqual([])
    expect(selectedBoneName.value).toBeNull()
  })

  it('setBoneList populates boneList', () => {
    const { boneList, setBoneList } = usePoseEditor()
    setBoneList(['mixamorigSpine', 'mixamorigHead'])
    expect(boneList.value).toEqual(['mixamorigSpine', 'mixamorigHead'])
  })

  it('setBoneList resets selectedBoneName', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList(['mixamorigSpine'])
    selectBone('mixamorigSpine')
    expect(selectedBoneName.value).toBe('mixamorigSpine')
    setBoneList(['mixamorigHead'])
    expect(selectedBoneName.value).toBeNull()
  })

  it('selectBone sets selectedBoneName', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList(['mixamorigRightHand', 'mixamorigLeftHand'])
    selectBone('mixamorigRightHand')
    expect(selectedBoneName.value).toBe('mixamorigRightHand')
  })

  it('selectBone(null) deselects', () => {
    const { selectedBoneName, setBoneList, selectBone } = usePoseEditor()
    setBoneList(['mixamorigSpine'])
    selectBone('mixamorigSpine')
    selectBone(null)
    expect(selectedBoneName.value).toBeNull()
  })

  it('reset clears both boneList and selectedBoneName', () => {
    const { boneList, selectedBoneName, setBoneList, selectBone, reset } = usePoseEditor()
    setBoneList(['mixamorigSpine', 'mixamorigHead'])
    selectBone('mixamorigSpine')
    reset()
    expect(boneList.value).toEqual([])
    expect(selectedBoneName.value).toBeNull()
  })

  it('instances are independent — no shared ref state', () => {
    const a = usePoseEditor()
    const b = usePoseEditor()
    a.setBoneList(['bone-a'])
    b.setBoneList(['bone-b'])
    expect(a.boneList.value).toEqual(['bone-a'])
    expect(b.boneList.value).toEqual(['bone-b'])
  })
})
