import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  computeLandImpactTier,
  resolveCharacterOverlayClips,
} from './animationOverlayAssignments'

function clip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [])
}

describe('computeLandImpactTier', () => {
  it('returns none for tiny hops', () => {
    expect(computeLandImpactTier(0.2, 0.05)).toBe('none')
  })

  it('returns soft for moderate fall', () => {
    expect(computeLandImpactTier(1.0, 0.5)).toBe('soft')
  })

  it('returns medium then hard', () => {
    expect(computeLandImpactTier(2.5, 0.6)).toBe('medium')
    expect(computeLandImpactTier(5, 1)).toBe('hard')
  })
})

describe('resolveCharacterOverlayClips', () => {
  it('prefers Jumping Up for rise', () => {
    const clips = [clip('Jumping'), clip('Jumping Up')]
    const o = resolveCharacterOverlayClips(clips)
    expect(o.jumpRise?.name).toBe('Jumping Up')
  })

  it('resolves edge catch before generic reaction', () => {
    const clips = [clip('Reaction'), clip('Edge Slip')]
    const o = resolveCharacterOverlayClips(clips)
    expect(o.edgeCatch?.name).toBe('Edge Slip')
  })

  it('resolves landing tiers', () => {
    const clips = [
      clip('Falling To Landing'),
      clip('Hard Landing'),
      clip('Falling Heavy'),
    ]
    const o = resolveCharacterOverlayClips(clips)
    expect(o.landSoft?.name).toBe('Falling To Landing')
    expect(o.landMedium?.name).toBe('Hard Landing')
    expect(o.landHeavy?.name).toBe('Falling Heavy')
  })
})
