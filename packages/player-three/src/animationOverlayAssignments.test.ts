import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  computeLandImpactTier,
  resolveCharacterOverlayClips,
  resolveWaterClips,
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

  it('resolves failJump from Straight Landing clip', () => {
    const clips = [clip('Straight Landing'), clip('Stand Up')]
    const o = resolveCharacterOverlayClips(clips)
    expect(o.failJump?.name).toBe('Straight Landing')
    expect(o.recoverFromFail?.name).toBe('Stand Up')
  })

  it('returns undefined failJump when no matching clip', () => {
    const clips = [clip('Jumping'), clip('Running')]
    const o = resolveCharacterOverlayClips(clips)
    expect(o.failJump).toBeUndefined()
  })
})

describe('resolveWaterClips', () => {
  it('resolves tread from Floating clip name', () => {
    const clips = [clip('Floating'), clip('Swimming'), clip('Falling Into Pool')]
    const w = resolveWaterClips(clips)
    expect(w.tread?.name).toBe('Floating')
    expect(w.swimForward?.name).toBe('Swimming')
    expect(w.entryFall?.name).toBe('Falling Into Pool')
  })

  it('resolves tread from convention-renamed clip (water tread idle)', () => {
    const clips = [clip('water__tread__idle'), clip('water__swim__forward')]
    const w = resolveWaterClips(clips)
    expect(w.tread?.name).toBe('water__tread__idle')
    expect(w.swimForward?.name).toBe('water__swim__forward')
  })

  it('returns undefined for missing water clips', () => {
    const clips = [clip('Idle'), clip('Walking')]
    const w = resolveWaterClips(clips)
    expect(w.tread).toBeUndefined()
    expect(w.swimForward).toBeUndefined()
    expect(w.entryFall).toBeUndefined()
  })
})
