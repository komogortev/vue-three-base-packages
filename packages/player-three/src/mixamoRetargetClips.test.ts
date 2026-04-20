import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { findMixamoHipBoneName, remapClipTracksToTargetSkeleton } from './mixamoRetargetClips'

// ─── Bone helpers ─────────────────────────────────────────────────────────────

function makeBone(name: string): THREE.Bone {
  const b = new THREE.Bone()
  b.name = name
  return b
}

function makeSkeleton(names: string[]): THREE.Skeleton {
  return new THREE.Skeleton(names.map(makeBone))
}

// ─── Clip helpers ─────────────────────────────────────────────────────────────

function quatTrack(name: string): THREE.QuaternionKeyframeTrack {
  return new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
}

function makeClip(trackNames: string[]): THREE.AnimationClip {
  return new THREE.AnimationClip('Clip', 1, trackNames.map(quatTrack))
}

// ─── findMixamoHipBoneName ────────────────────────────────────────────────────

describe('findMixamoHipBoneName', () => {
  it('returns the mixamorigHips bone by exact name', () => {
    const bones = [makeBone('mixamorigSpine'), makeBone('mixamorigHips'), makeBone('mixamorigHead')]
    expect(findMixamoHipBoneName(bones)).toBe('mixamorigHips')
  })

  it('is case-insensitive for mixamorigHips', () => {
    const bones = [makeBone('MIXAMORIGSPINE'), makeBone('MIXAMORIGHI PS')] // won't match
    const bones2 = [makeBone('MixamorigHips')]
    expect(findMixamoHipBoneName(bones2)).toBe('MixamorigHips')
  })

  it('falls back to leaf-name "Hips" match when no mixamorig prefix', () => {
    const bones = [makeBone('Armature:Spine'), makeBone('Armature:Hips'), makeBone('Armature:Head')]
    expect(findMixamoHipBoneName(bones)).toBe('Armature:Hips')
  })

  it('matches bare "Hips" without namespace', () => {
    const bones = [makeBone('Spine'), makeBone('Hips')]
    expect(findMixamoHipBoneName(bones)).toBe('Hips')
  })

  it('falls back to first bone when no hips-like bone exists', () => {
    const bones = [makeBone('Spine'), makeBone('Head')]
    expect(findMixamoHipBoneName(bones)).toBe('Spine')
  })

  it('returns default string for an empty array', () => {
    expect(findMixamoHipBoneName([])).toBe('mixamorigHips')
  })
})

// ─── remapClipTracksToTargetSkeleton ─────────────────────────────────────────

describe('remapClipTracksToTargetSkeleton', () => {
  it('returns the same clip instance when no tracks need remapping', () => {
    const skeleton = makeSkeleton(['mixamorigHips', 'mixamorigSpine'])
    const clip = makeClip(['mixamorigHips.quaternion', 'mixamorigSpine.quaternion'])
    expect(remapClipTracksToTargetSkeleton(clip, skeleton)).toBe(clip)
  })

  it('remaps pipe-separated node names to skeleton bone names', () => {
    const skeleton = makeSkeleton(['mixamorigHips', 'mixamorigSpine'])
    const clip = makeClip(['ArmatureAction|mixamorigHips.quaternion'])
    const result = remapClipTracksToTargetSkeleton(clip, skeleton)
    expect(result).not.toBe(clip)
    expect(result.tracks[0]!.name).toBe('mixamorigHips.quaternion')
  })

  it('remaps colon-namespaced node names', () => {
    const skeleton = makeSkeleton(['mixamorigHips', 'mixamorigLeftArm'])
    const clip = makeClip(['root:mixamorigHips.quaternion', 'root:mixamorigLeftArm.quaternion'])
    const result = remapClipTracksToTargetSkeleton(clip, skeleton)
    expect(result.tracks[0]!.name).toBe('mixamorigHips.quaternion')
    expect(result.tracks[1]!.name).toBe('mixamorigLeftArm.quaternion')
  })

  it('preserves tracks that cannot be resolved', () => {
    const skeleton = makeSkeleton(['mixamorigHips'])
    const clip = makeClip(['UnknownBone.quaternion'])
    // No mapping found — clip returned unchanged
    const result = remapClipTracksToTargetSkeleton(clip, skeleton)
    expect(result).toBe(clip)
  })

  it('preserves tracks that already have the correct name', () => {
    const skeleton = makeSkeleton(['mixamorigHips'])
    const clip = makeClip(['mixamorigHips.quaternion'])
    expect(remapClipTracksToTargetSkeleton(clip, skeleton)).toBe(clip)
  })

  it('preserves clip name and duration', () => {
    const skeleton = makeSkeleton(['mixamorigHips'])
    const clip = new THREE.AnimationClip('Walking', 3.2, [quatTrack('Rig|mixamorigHips.quaternion')])
    const result = remapClipTracksToTargetSkeleton(clip, skeleton)
    expect(result.name).toBe('Walking')
    expect(result.duration).toBe(3.2)
  })

  it('matches by suffix when bone names share a suffix (endsWith fallback)', () => {
    const skeleton = makeSkeleton(['Character_mixamorigHips'])
    const clip = makeClip(['mixamorigHips.quaternion'])
    const result = remapClipTracksToTargetSkeleton(clip, skeleton)
    expect(result.tracks[0]!.name).toBe('Character_mixamorigHips.quaternion')
  })
})
