import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { resolveClipBones, validateKitAppend } from '../anim/exportAnimPack'

/** A skeleton whose bones are named — matches the runtime pose-mesh skeleton. */
function skeletonWith(names: string[]): THREE.Skeleton {
  const bones = names.map((n) => {
    const b = new THREE.Bone()
    b.name = n
    return b
  })
  return new THREE.Skeleton(bones)
}

/** A clip with one identity-quaternion track per named bone. */
function clipTargeting(name: string, boneNames: string[]): THREE.AnimationClip {
  const tracks = boneNames.map(
    (bn) => new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  )
  return new THREE.AnimationClip(name, -1, tracks)
}

describe('resolveClipBones', () => {
  it('counts all bones when every track resolves', () => {
    const skel = skeletonWith(['Hips', 'Spine', 'Head'])
    const clip = clipTargeting('idle', ['Hips', 'Spine'])
    expect(resolveClipBones(clip, skel)).toEqual({ matched: 2, total: 2 })
  })

  it('counts partial matches', () => {
    const skel = skeletonWith(['Hips'])
    const clip = clipTargeting('idle', ['Hips', 'L_Clavicle'])
    expect(resolveClipBones(clip, skel)).toEqual({ matched: 1, total: 2 })
  })

  it('returns matched:0 for a clip authored on a different skeleton', () => {
    const skel = skeletonWith(['Hips', 'Spine'])
    // Colon-free foreign name — `mixamorig:` prefixes get special-cased by
    // PropertyBinding.parseTrackName and would confuse the fixture (see the
    // node-name sanitization pitfall).
    const clip = clipTargeting('idle', ['ForeignRoot'])
    expect(resolveClipBones(clip, skel)).toEqual({ matched: 0, total: 1 })
  })

  it('de-duplicates bones referenced by multiple tracks', () => {
    const skel = skeletonWith(['Hips'])
    const clip = new THREE.AnimationClip('idle', -1, [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ])
    expect(resolveClipBones(clip, skel)).toEqual({ matched: 1, total: 1 })
  })
})

describe('validateKitAppend', () => {
  const skel = skeletonWith(['Hips', 'Spine', 'Head'])

  it('accepts a new clip on the same skeleton', () => {
    const existing = [clipTargeting('idle', ['Hips'])]
    const next = clipTargeting('wave', ['Spine'])
    expect(validateKitAppend(existing, next, skel)).toEqual({ ok: true })
  })

  it('rejects a duplicate clip name', () => {
    const existing = [clipTargeting('wave', ['Hips'])]
    const next = clipTargeting('wave', ['Spine'])
    const result = validateKitAppend(existing, next, skel)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already has a clip named/)
  })

  it('rejects a new clip whose bones do not match this character (OD-F)', () => {
    const existing = [clipTargeting('idle', ['Hips'])]
    const next = clipTargeting('wave', ['ForeignRoot'])
    const result = validateKitAppend(existing, next, skel)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/don't match this character/)
  })

  it('rejects when an existing kit clip was built for a different character (OD-F)', () => {
    const existing = [clipTargeting('foreign', ['someOtherRigRoot'])]
    const next = clipTargeting('wave', ['Hips'])
    const result = validateKitAppend(existing, next, skel)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/different character/)
  })
})
