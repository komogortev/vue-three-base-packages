import { describe, it, expect } from 'vitest'
import { useAnimRecorder, DEFAULT_TIMELINE_DURATION } from '../anim/useAnimRecorder'
import type { PoseBoneSample } from '../anim/animationRecorder'

const IDENTITY: PoseBoneSample['q'] = [0, 0, 0, 1]

function pose(bone: string): PoseBoneSample {
  return { bone, q: [...IDENTITY] as PoseBoneSample['q'] }
}

describe('useAnimRecorder', () => {
  it('starts empty with the default timeline range', () => {
    const anim = useAnimRecorder()
    expect(anim.keyframeTimes.value).toEqual([])
    expect(anim.scrubTime.value).toBe(0)
    expect(anim.timelineDuration.value).toBe(DEFAULT_TIMELINE_DURATION)
  })

  it('mirrors keyframe times sorted after addKeyframe', () => {
    const anim = useAnimRecorder()
    anim.addKeyframe(2, [pose('Hips')])
    anim.addKeyframe(0.5, [pose('Hips')])
    anim.addKeyframe(1, [pose('Hips')])
    expect(anim.keyframeTimes.value).toEqual([0.5, 1, 2])
  })

  it('auto-expands timelineDuration when a keyframe lands past it', () => {
    const anim = useAnimRecorder()
    anim.addKeyframe(8, [pose('Hips')])
    expect(anim.timelineDuration.value).toBe(8)
    // …but a keyframe inside the range never shrinks it
    anim.addKeyframe(1, [pose('Hips')])
    expect(anim.timelineDuration.value).toBe(8)
  })

  it('mirrors removal', () => {
    const anim = useAnimRecorder()
    anim.addKeyframe(0, [pose('Hips')])
    anim.addKeyframe(1, [pose('Hips')])
    anim.removeKeyframe(0)
    expect(anim.keyframeTimes.value).toEqual([1])
  })

  it('setTimelineDuration never shrinks below the last keyframe', () => {
    const anim = useAnimRecorder()
    anim.addKeyframe(4, [pose('Hips')])
    anim.setTimelineDuration(2)
    expect(anim.timelineDuration.value).toBe(4)
    anim.setTimelineDuration(10)
    expect(anim.timelineDuration.value).toBe(10)
  })

  it('setTimelineDuration clamps scrubTime into the new range', () => {
    const anim = useAnimRecorder()
    anim.scrubTime.value = 9
    anim.setTimelineDuration(6)
    expect(anim.scrubTime.value).toBe(6)
  })

  it('setTimelineDuration enforces a positive floor when empty', () => {
    const anim = useAnimRecorder()
    anim.setTimelineDuration(0)
    expect(anim.timelineDuration.value).toBe(0.1)
  })

  it('setTimelineDuration ignores non-finite input', () => {
    const anim = useAnimRecorder()
    anim.setTimelineDuration(NaN)
    expect(anim.timelineDuration.value).toBe(DEFAULT_TIMELINE_DURATION)
    anim.setTimelineDuration(Infinity)
    expect(anim.timelineDuration.value).toBe(DEFAULT_TIMELINE_DURATION)
  })

  it('clear resets recorder and all mirrors', () => {
    const anim = useAnimRecorder()
    anim.addKeyframe(7, [pose('Hips')])
    anim.scrubTime.value = 3
    anim.clear()
    expect(anim.recorder.keyframes.length).toBe(0)
    expect(anim.keyframeTimes.value).toEqual([])
    expect(anim.scrubTime.value).toBe(0)
    expect(anim.timelineDuration.value).toBe(DEFAULT_TIMELINE_DURATION)
  })
})
