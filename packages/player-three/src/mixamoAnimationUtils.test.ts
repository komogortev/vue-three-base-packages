import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { stripMixamoHipsPositionTracks, sanitizeMixamoClips } from './mixamoAnimationUtils'

function makeClip(trackNames: string[]): THREE.AnimationClip {
  const tracks = trackNames.map(
    (name) => new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  )
  return new THREE.AnimationClip('TestClip', 1, tracks)
}

// Override track name (QuaternionKeyframeTrack forces .quaternion suffix — use VectorKeyframeTrack for .position)
function posTrack(name: string): THREE.VectorKeyframeTrack {
  return new THREE.VectorKeyframeTrack(name, [0, 1], [0, 0, 0, 0, 0, 0])
}

function clipWithTracks(tracks: THREE.KeyframeTrack[]): THREE.AnimationClip {
  return new THREE.AnimationClip('TestClip', 1, tracks)
}

describe('stripMixamoHipsPositionTracks', () => {
  it('returns the same clip instance when no hips tracks are present', () => {
    const clip = makeClip(['mixamorigSpine.quaternion', 'mixamorigLeftArm.quaternion'])
    expect(stripMixamoHipsPositionTracks(clip)).toBe(clip)
  })

  it('strips a bare mixamorigHips.position track', () => {
    const hips = posTrack('mixamorigHips.position')
    const spine = posTrack('mixamorigSpine.position')
    const clip = clipWithTracks([hips, spine])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result).not.toBe(clip)
    expect(result.tracks.map((t) => t.name)).toEqual(['mixamorigSpine.position'])
  })

  it('strips a retarget-output .bones[mixamorigHips].position track', () => {
    const hips = posTrack('.bones[mixamorigHips].position')
    const clip = clipWithTracks([hips])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result.tracks).toHaveLength(0)
  })

  it('strips .bones[Hips].position (case-insensitive hips match)', () => {
    const hips = posTrack('.bones[Hips].position')
    const other = posTrack('.bones[Spine].position')
    const clip = clipWithTracks([hips, other])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result.tracks.map((t) => t.name)).toEqual(['.bones[Spine].position'])
  })

  it('strips piped names like "Armature|mixamorigHips.position"', () => {
    const hips = posTrack('Armature|mixamorigHips.position')
    const clip = clipWithTracks([hips])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result.tracks).toHaveLength(0)
  })

  it('strips namespace:prefixed names like "root:Hips.position"', () => {
    const hips = posTrack('root:Hips.position')
    const clip = clipWithTracks([hips])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result.tracks).toHaveLength(0)
  })

  it('does NOT strip a non-hips .position track', () => {
    const spine = posTrack('mixamorigSpine.position')
    const clip = clipWithTracks([spine])
    expect(stripMixamoHipsPositionTracks(clip)).toBe(clip)
  })

  it('does NOT strip a .quaternion track named "mixamorigHips"', () => {
    const rot = new THREE.QuaternionKeyframeTrack(
      'mixamorigHips.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    )
    const clip = clipWithTracks([rot])
    expect(stripMixamoHipsPositionTracks(clip)).toBe(clip)
  })

  it('preserves clip name and duration when creating a new clip', () => {
    const hips = posTrack('mixamorigHips.position')
    const clip = new THREE.AnimationClip('RunFwd', 2.5, [hips])
    const result = stripMixamoHipsPositionTracks(clip)
    expect(result.name).toBe('RunFwd')
    expect(result.duration).toBe(2.5)
  })
})

describe('sanitizeMixamoClips', () => {
  it('maps stripMixamoHipsPositionTracks over every clip', () => {
    const hip1 = posTrack('mixamorigHips.position')
    const hip2 = posTrack('mixamorigHips.position')
    const c1 = clipWithTracks([hip1, posTrack('mixamorigSpine.position')])
    const c2 = clipWithTracks([hip2])
    const results = sanitizeMixamoClips([c1, c2])
    expect(results[0]!.tracks).toHaveLength(1)
    expect(results[1]!.tracks).toHaveLength(0)
  })

  it('returns same instance for clips with nothing to strip', () => {
    const c = makeClip(['mixamorigSpine.quaternion'])
    const [result] = sanitizeMixamoClips([c])
    expect(result).toBe(c)
  })

  it('returns an empty array for empty input', () => {
    expect(sanitizeMixamoClips([])).toEqual([])
  })
})
