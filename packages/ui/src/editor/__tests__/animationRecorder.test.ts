import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  AnimationRecorder,
  KEYFRAME_TIME_EPSILON,
  extractKeyframesFromClip,
  type PoseBoneSample,
} from '../anim/animationRecorder'

const IDENTITY: PoseBoneSample['q'] = [0, 0, 0, 1]
/** 90° about Z */
const Z90: PoseBoneSample['q'] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]

function pose(bone: string, q: PoseBoneSample['q']): PoseBoneSample {
  return { bone, q }
}

function quatOf(sample: PoseBoneSample[], bone: string): THREE.Quaternion {
  const s = sample.find((b) => b.bone === bone)
  if (!s) throw new Error(`bone ${bone} missing from sample`)
  return new THREE.Quaternion().fromArray(s.q)
}

describe('AnimationRecorder', () => {
  describe('addKeyframe', () => {
    it('inserts keyframes sorted by time regardless of insertion order', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(2, [pose('Spine', IDENTITY)])
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', IDENTITY)])
      expect(r.keyframes.map((k) => k.time)).toEqual([0, 1, 2])
    })

    it('replaces an existing keyframe within epsilon instead of duplicating', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(1, [pose('Spine', IDENTITY)])
      r.addKeyframe(1 + KEYFRAME_TIME_EPSILON / 2, [pose('Spine', Z90)])
      expect(r.keyframes).toHaveLength(1)
      expect(r.keyframes[0].time).toBe(1)
      expect(r.keyframes[0].bones[0].q).toEqual(Z90)
    })

    it('deep-copies bone samples — later caller mutation does not corrupt the store', () => {
      const r = new AnimationRecorder()
      const bones = [pose('Spine', [0, 0, 0, 1])]
      r.addKeyframe(0, bones)
      bones[0].q[0] = 0.99
      bones.push(pose('Head', IDENTITY))
      expect(r.keyframes[0].bones).toHaveLength(1)
      expect(r.keyframes[0].bones[0].q).toEqual([0, 0, 0, 1])
    })

    it('rejects negative and non-finite times', () => {
      const r = new AnimationRecorder()
      expect(() => r.addKeyframe(-0.5, [])).toThrow(RangeError)
      expect(() => r.addKeyframe(NaN, [])).toThrow(RangeError)
      expect(() => r.addKeyframe(Infinity, [])).toThrow(RangeError)
    })
  })

  describe('removeKeyframe', () => {
    it('removes an epsilon-matched keyframe and reports true', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0.5, [pose('Spine', IDENTITY)])
      expect(r.removeKeyframe(0.5 + KEYFRAME_TIME_EPSILON / 2)).toBe(true)
      expect(r.keyframes).toHaveLength(0)
    })

    it('returns false when nothing matches', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0.5, [pose('Spine', IDENTITY)])
      expect(r.removeKeyframe(0.7)).toBe(false)
      expect(r.keyframes).toHaveLength(1)
    })
  })

  describe('retimeKeyframe', () => {
    it('moves a keyframe and keeps the list sorted', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      expect(r.retimeKeyframe(1, 0.25)).toBe(true)
      expect(r.keyframes.map((k) => k.time)).toEqual([0, 0.25])
      expect(r.keyframes[1].bones[0].q).toEqual(Z90)
    })

    it('replaces an existing keyframe at the target time (drag-onto)', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      expect(r.retimeKeyframe(1, 0)).toBe(true)
      expect(r.keyframes).toHaveLength(1)
      expect(r.keyframes[0].time).toBe(0)
      expect(r.keyframes[0].bones[0].q).toEqual(Z90)
    })

    it('returns false when no keyframe exists at from', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      expect(r.retimeKeyframe(0.5, 1)).toBe(false)
      expect(r.keyframes.map((k) => k.time)).toEqual([0])
    })
  })

  describe('sampleAt', () => {
    it('returns [] when empty', () => {
      expect(new AnimationRecorder().sampleAt(0)).toEqual([])
    })

    it('rejects non-finite times instead of emitting NaN quaternions', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      expect(() => r.sampleAt(Number.NaN)).toThrow(RangeError)
      expect(() => r.sampleAt(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    })

    it('clamps to first and last keyframes outside the range', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(1, [pose('Spine', IDENTITY)])
      r.addKeyframe(2, [pose('Spine', Z90)])
      expect(r.sampleAt(0)[0].q).toEqual(IDENTITY)
      expect(r.sampleAt(5)[0].q).toEqual(Z90)
    })

    it('slerps between bracketing keyframes — 90° Z at midpoint is 45°', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(2, [pose('Spine', Z90)])
      const q = quatOf(r.sampleAt(1), 'Spine')
      const expected = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI / 4,
      )
      expect(q.angleTo(expected)).toBeLessThan(1e-6)
    })

    it('holds the available value for bones present in only one bracket', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY), pose('Head', Z90)])
      r.addKeyframe(2, [pose('Spine', Z90)])
      const sample = r.sampleAt(1)
      expect(quatOf(sample, 'Head').angleTo(new THREE.Quaternion().fromArray(Z90))).toBeLessThan(
        1e-6,
      )
      // Spine still slerps
      expect(quatOf(sample, 'Spine').angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1)
    })

    it('returns the exact keyframe pose when time lands on a keyframe', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      r.addKeyframe(2, [pose('Spine', IDENTITY)])
      expect(r.sampleAt(1)[0].q).toEqual(Z90)
    })
  })

  describe('build', () => {
    it('throws when no keyframes are recorded', () => {
      expect(() => new AnimationRecorder().build('empty')).toThrow(/no keyframes/)
    })

    it('produces one QuaternionKeyframeTrack per bone named `${bone}.quaternion`', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY), pose('Head', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90), pose('Head', Z90)])
      const clip = r.build('wave')
      expect(clip.name).toBe('wave')
      expect(clip.tracks).toHaveLength(2)
      const names = clip.tracks.map((t) => t.name).sort()
      expect(names).toEqual(['Head.quaternion', 'Spine.quaternion'])
      expect(clip.tracks[0]).toBeInstanceOf(THREE.QuaternionKeyframeTrack)
    })

    it('writes times and flattened quaternion values in keyframe order', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(1, [pose('Spine', Z90)])
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      const track = r.build('clip').tracks[0]
      expect(Array.from(track.times)).toEqual([0, 1])
      // KeyframeTrack stores values as Float32Array — compare at float32 precision
      expect(Array.from(track.values)).toEqual(Array.from(new Float32Array([...IDENTITY, ...Z90])))
    })

    it('clip duration equals the last keyframe time', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.addKeyframe(2.5, [pose('Spine', Z90)])
      expect(r.build('clip').duration).toBe(2.5)
    })

    it('a bone missing from some keyframes gets a track with only its own times', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY), pose('Head', IDENTITY)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      r.addKeyframe(2, [pose('Spine', IDENTITY), pose('Head', Z90)])
      const clip = r.build('clip')
      const head = clip.tracks.find((t) => t.name === 'Head.quaternion')!
      const spine = clip.tracks.find((t) => t.name === 'Spine.quaternion')!
      expect(Array.from(head.times)).toEqual([0, 2])
      expect(Array.from(spine.times)).toEqual([0, 1, 2])
    })

    it('does NOT collapse deliberately-held identical poses by default', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', Z90)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      r.addKeyframe(2, [pose('Spine', Z90)])
      const track = r.build('hold').tracks[0]
      expect(Array.from(track.times)).toEqual([0, 1, 2])
    })

    it('optimize: true dedupes redundant keys (real-time mode)', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', Z90)])
      r.addKeyframe(1, [pose('Spine', Z90)])
      r.addKeyframe(2, [pose('Spine', Z90)])
      const track = r.build('hold', { optimize: true }).tracks[0]
      expect(track.times.length).toBeLessThan(3)
    })

    it('a single keyframe builds a valid static clip', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', Z90)])
      const clip = r.build('static')
      expect(clip.tracks[0].times.length).toBe(1)
      expect(clip.duration).toBe(0)
    })
  })

  describe('loadClip / extractKeyframesFromClip', () => {
    it('round-trips a recorder-authored clip byte-for-byte (build → loadClip → build)', () => {
      const src = new AnimationRecorder()
      src.addKeyframe(0, [pose('Spine', IDENTITY), pose('Head', IDENTITY)])
      src.addKeyframe(1, [pose('Spine', Z90), pose('Head', IDENTITY)])
      src.addKeyframe(2, [pose('Spine', IDENTITY), pose('Head', Z90)])
      const clip = src.build('orig')

      const round = new AnimationRecorder()
      const skipped = round.loadClip(clip)
      expect(skipped).toBe(0)
      expect(round.keyframes.map((k) => k.time)).toEqual([0, 1, 2])

      // Every bone quaternion at every keyframe matches within float32 precision.
      const rebuilt = round.build('orig')
      for (const name of ['Spine.quaternion', 'Head.quaternion']) {
        const a = clip.tracks.find((t) => t.name === name)!
        const b = rebuilt.tracks.find((t) => t.name === name)!
        expect(Array.from(b.times)).toEqual(Array.from(a.times))
        for (let i = 0; i < a.values.length; i++) {
          expect(b.values[i]).toBeCloseTo(a.values[i], 5)
        }
      }
    })

    it('replaces any prior keyframes (load is not additive)', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', Z90)])
      r.addKeyframe(9, [pose('Spine', Z90)])
      const clip = new THREE.AnimationClip('c', 1, [
        new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...IDENTITY, ...Z90]),
      ])
      r.loadClip(clip)
      expect(r.keyframes.map((k) => k.time)).toEqual([0, 1])
      expect(r.keyframes[0].bones.map((b) => b.bone)).toEqual(['Hips'])
    })

    it('skips (and counts) position/scale tracks — in-place clips only (OD-4)', () => {
      const clip = new THREE.AnimationClip('rooted', 1, [
        new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...IDENTITY, ...Z90]),
        new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0]),
        new THREE.VectorKeyframeTrack('Hips.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
      ])
      const { keyframes, skippedTracks } = extractKeyframesFromClip(clip)
      expect(skippedTracks).toBe(2)
      expect(keyframes).toHaveLength(2)
      expect(keyframes[0].bones.map((b) => b.bone)).toEqual(['Hips'])
    })

    it('resamples per-bone time grids onto the union of key times', () => {
      // Spine keyed at 0 and 2; Head keyed only at 1 — union is [0, 1, 2].
      const clip = new THREE.AnimationClip('sparse', 2, [
        new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 2], [...IDENTITY, ...Z90]),
        new THREE.QuaternionKeyframeTrack('Head.quaternion', [1], [...Z90]),
      ])
      const { keyframes } = extractKeyframesFromClip(clip)
      expect(keyframes.map((k) => k.time)).toEqual([0, 1, 2])
      // Spine at the union midpoint t=1 is the ~45° interpolation of its own
      // 0→2 track — sampled with three's own track interpolant, so it matches
      // runtime playback exactly (tolerance covers slerp-vs-ideal-math drift).
      const spineAt1 = quatOf(keyframes[1].bones, 'Spine')
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4)
      expect(spineAt1.angleTo(expected)).toBeLessThan(0.01)
    })

    it('returns empty extraction with a skip count for a rotation-free clip', () => {
      const clip = new THREE.AnimationClip('noRot', 1, [
        new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0]),
      ])
      const { keyframes, skippedTracks } = extractKeyframesFromClip(clip)
      expect(keyframes).toHaveLength(0)
      expect(skippedTracks).toBe(1)
    })
  })

  describe('clear / duration', () => {
    it('duration is 0 when empty and tracks the last keyframe', () => {
      const r = new AnimationRecorder()
      expect(r.duration).toBe(0)
      r.addKeyframe(1.5, [pose('Spine', IDENTITY)])
      expect(r.duration).toBe(1.5)
    })

    it('clear empties the store', () => {
      const r = new AnimationRecorder()
      r.addKeyframe(0, [pose('Spine', IDENTITY)])
      r.clear()
      expect(r.keyframes).toHaveLength(0)
      expect(r.duration).toBe(0)
    })
  })
})
