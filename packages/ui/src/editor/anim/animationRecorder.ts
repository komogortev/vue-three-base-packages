import * as THREE from 'three'

/** Matches the `poseOverride` / `capturePoseSnapshot()` bone-sample shape. */
export interface PoseBoneSample {
  bone: string
  q: [number, number, number, number]
}

export interface RecordedKeyframe {
  time: number
  bones: PoseBoneSample[]
}

/** Deep-readonly views handed out by `keyframes` — internal state must only change through recorder methods. */
export interface ReadonlyPoseBoneSample {
  readonly bone: string
  readonly q: readonly [number, number, number, number]
}

export interface ReadonlyRecordedKeyframe {
  readonly time: number
  readonly bones: ReadonlyArray<ReadonlyPoseBoneSample>
}

/** Keyframes closer than this (seconds) are treated as the same timeline slot. */
export const KEYFRAME_TIME_EPSILON = 1e-4

function cloneBones(bones: PoseBoneSample[]): PoseBoneSample[] {
  return bones.map((b) => ({ bone: b.bone, q: [...b.q] as PoseBoneSample['q'] }))
}

/** Outcome of pulling keyframes back out of an existing clip. */
export interface ClipExtraction {
  keyframes: RecordedKeyframe[]
  /**
   * Non-rotation tracks dropped during extraction (position / scale). The
   * recorder is quaternion-only (in-place, OD-4), so a clip carrying root
   * motion loses that translation — surfaced so the UI can warn.
   */
  skippedTracks: number
}

/**
 * Reconstruct recorder keyframes from a `THREE.AnimationClip`, so an existing
 * clip can be loaded back into the timeline for correction or save-as.
 *
 * Only `*.quaternion` tracks are read (in-place clips per OD-4); position/scale
 * tracks are counted into `skippedTracks` and ignored. Bones are sampled at the
 * union of every quaternion track's key times via each track's own linear
 * (slerp) interpolant, so a clip authored by this recorder round-trips exactly
 * and a foreign clip with per-bone time grids is resampled onto the union grid.
 *
 * Duration is re-derived from the last key on rebuild — a foreign clip whose
 * `duration` extends past its final quaternion key (a trailing hold) loses that
 * tail. Recorder-authored clips have `duration === last key`, so they are exact.
 */
export function extractKeyframesFromClip(clip: THREE.AnimationClip): ClipExtraction {
  const qTracks = clip.tracks.filter(
    (t): t is THREE.QuaternionKeyframeTrack =>
      THREE.PropertyBinding.parseTrackName(t.name).propertyName === 'quaternion',
  )
  const skippedTracks = clip.tracks.length - qTracks.length
  if (qTracks.length === 0) return { keyframes: [], skippedTracks }

  const parsed = qTracks.map((t) => ({
    bone: THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? t.name,
    interpolant: t.createInterpolant(),
  }))

  // Union of all sample times, de-duplicated within the keyframe epsilon.
  const times: number[] = []
  for (const t of qTracks) {
    for (const time of t.times) {
      if (!times.some((x) => Math.abs(x - time) < KEYFRAME_TIME_EPSILON)) times.push(time)
    }
  }
  times.sort((a, b) => a - b)

  const keyframes: RecordedKeyframe[] = times.map((time) => ({
    time,
    bones: parsed.map((p) => {
      // Interpolant reuses one result buffer per call — read the 4 quat
      // components immediately before the next evaluate() overwrites it.
      const buf = p.interpolant.evaluate(time)
      return { bone: p.bone, q: [buf[0], buf[1], buf[2], buf[3]] as PoseBoneSample['q'] }
    }),
  }))

  return { keyframes, skippedTracks }
}

function assertValidTime(time: number, label: string): void {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError(`AnimationRecorder: ${label} must be a finite time >= 0, got ${time}`)
  }
}

/**
 * Pure-TS keyframe store + clip assembly for the S5 Animation Recorder.
 *
 * Holds stepped pose keyframes (skeleton quaternions only — in-place clips,
 * no root motion per OD-4) and builds a `THREE.AnimationClip` with one
 * `QuaternionKeyframeTrack` per bone, named `${bone}.quaternion` — the form
 * proven byte-identical through GLTFExporter → GLTFLoader by the S5-a spike.
 *
 * `optimize()` is NOT applied by default: stepped keyframes are already
 * sparse and optimize() would collapse deliberately-held poses. Real-time
 * recording (S5-c optional) opts in via `build(name, { optimize: true })`.
 */
export class AnimationRecorder {
  private _keyframes: RecordedKeyframe[] = []

  /** Keyframes sorted by time. Do not mutate — use the recorder methods. */
  get keyframes(): ReadonlyArray<ReadonlyRecordedKeyframe> {
    return this._keyframes
  }

  /** Last keyframe time, or 0 when empty. */
  get duration(): number {
    return this._keyframes.length === 0 ? 0 : this._keyframes[this._keyframes.length - 1].time
  }

  private indexAt(time: number): number {
    return this._keyframes.findIndex((k) => Math.abs(k.time - time) < KEYFRAME_TIME_EPSILON)
  }

  /** Insert a keyframe at `time`, replacing any existing keyframe within epsilon. */
  addKeyframe(time: number, bones: PoseBoneSample[]): void {
    assertValidTime(time, 'addKeyframe time')
    const copy = cloneBones(bones)
    const existing = this.indexAt(time)
    if (existing !== -1) {
      this._keyframes[existing] = { time: this._keyframes[existing].time, bones: copy }
      return
    }
    this._keyframes.push({ time, bones: copy })
    this._keyframes.sort((a, b) => a.time - b.time)
  }

  /** Remove the keyframe at `time` (epsilon match). Returns false when none matched. */
  removeKeyframe(time: number): boolean {
    const idx = this.indexAt(time)
    if (idx === -1) return false
    this._keyframes.splice(idx, 1)
    return true
  }

  /**
   * Move the keyframe at `from` to `to`. A keyframe already sitting at `to`
   * (epsilon match) is replaced — drag-onto semantics for the timeline UI.
   * Returns false when no keyframe exists at `from`.
   */
  retimeKeyframe(from: number, to: number): boolean {
    assertValidTime(to, 'retimeKeyframe target')
    const idx = this.indexAt(from)
    if (idx === -1) return false
    const [moved] = this._keyframes.splice(idx, 1)
    const clash = this.indexAt(to)
    if (clash !== -1) this._keyframes.splice(clash, 1)
    this._keyframes.push({ time: to, bones: moved.bones })
    this._keyframes.sort((a, b) => a.time - b.time)
    return true
  }

  /**
   * Sample the pose at `time` for scrub preview: slerp between the bracketing
   * keyframes, clamped to first/last outside the recorded range. Bones present
   * in only one bracket hold that bracket's value. Empty recorder → [].
   */
  sampleAt(time: number): PoseBoneSample[] {
    if (!Number.isFinite(time)) {
      throw new RangeError(`AnimationRecorder: sampleAt time must be finite, got ${time}`)
    }
    const kfs = this._keyframes
    if (kfs.length === 0) return []
    if (time <= kfs[0].time) return cloneBones(kfs[0].bones)
    if (time >= kfs[kfs.length - 1].time) return cloneBones(kfs[kfs.length - 1].bones)

    let upper = 1
    while (kfs[upper].time < time) upper++
    const a = kfs[upper - 1]
    const b = kfs[upper]
    // upper is an exact-ish hit when time lands within epsilon of it
    if (Math.abs(b.time - time) < KEYFRAME_TIME_EPSILON) return cloneBones(b.bones)
    const t = (time - a.time) / (b.time - a.time)

    const byName = new Map<string, { qa?: PoseBoneSample['q']; qb?: PoseBoneSample['q'] }>()
    for (const s of a.bones) byName.set(s.bone, { qa: s.q })
    for (const s of b.bones) {
      const entry = byName.get(s.bone)
      if (entry) entry.qb = s.q
      else byName.set(s.bone, { qb: s.q })
    }

    const qA = new THREE.Quaternion()
    const qB = new THREE.Quaternion()
    const out: PoseBoneSample[] = []
    for (const [bone, { qa, qb }] of byName) {
      if (qa && qb) {
        qA.fromArray(qa)
        qB.fromArray(qb)
        qA.slerp(qB, t)
        out.push({ bone, q: [qA.x, qA.y, qA.z, qA.w] })
      } else {
        const held = (qa ?? qb) as PoseBoneSample['q']
        out.push({ bone, q: [...held] as PoseBoneSample['q'] })
      }
    }
    return out
  }

  /**
   * Assemble the recorded keyframes into an AnimationClip — one
   * QuaternionKeyframeTrack per bone (`${bone}.quaternion`). Each bone's track
   * carries only the keyframes that contain that bone. Throws when empty.
   */
  build(clipName: string, options: { optimize?: boolean } = {}): THREE.AnimationClip {
    if (this._keyframes.length === 0) {
      throw new Error('AnimationRecorder.build: no keyframes recorded')
    }

    const perBone = new Map<string, { times: number[]; values: number[] }>()
    for (const kf of this._keyframes) {
      for (const s of kf.bones) {
        let entry = perBone.get(s.bone)
        if (!entry) {
          entry = { times: [], values: [] }
          perBone.set(s.bone, entry)
        }
        entry.times.push(kf.time)
        entry.values.push(s.q[0], s.q[1], s.q[2], s.q[3])
      }
    }

    const tracks: THREE.KeyframeTrack[] = []
    for (const [bone, { times, values }] of perBone) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values))
    }

    const clip = new THREE.AnimationClip(clipName, this.duration, tracks)
    if (options.optimize) clip.optimize()
    return clip
  }

  /**
   * Replace all keyframes with those extracted from an existing clip
   * (correction / save-as flow). Returns the number of non-rotation tracks
   * that were dropped, so the caller can warn about lost root motion.
   */
  loadClip(clip: THREE.AnimationClip): number {
    const { keyframes, skippedTracks } = extractKeyframesFromClip(clip)
    for (const kf of keyframes) assertValidTime(kf.time, 'loadClip keyframe time')
    this._keyframes = keyframes
      .map((k) => ({ time: k.time, bones: cloneBones(k.bones) }))
      .sort((a, b) => a.time - b.time)
    return skippedTracks
  }

  clear(): void {
    this._keyframes = []
  }
}
