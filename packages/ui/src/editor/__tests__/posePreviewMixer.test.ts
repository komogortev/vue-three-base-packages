import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { PosePreviewMixer } from '../anim/posePreviewMixer'

/** 90° about Z */
const Z90 = new THREE.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2)

/**
 * Angle tolerance (rad). KeyframeTrack stores values as Float32Array and
 * angleTo = 2·acos(dot) amplifies that rounding near identity (≈2√(2ε)), so
 * even exact poses read back ~5e-4 rad. 2e-3 ≈ 0.11° — far below visible.
 */
const ANGLE_EPS = 2e-3

/** Root with one named bone — the minimal graph PropertyBinding can resolve. */
function makeRig(): { root: THREE.Object3D; bone: THREE.Bone } {
  const root = new THREE.Object3D()
  const bone = new THREE.Bone()
  bone.name = 'Hips'
  root.add(bone)
  return { root, bone }
}

/** 1-second clip rotating Hips from identity to Z90. */
function makeClip(): THREE.AnimationClip {
  const track = new THREE.QuaternionKeyframeTrack(
    'Hips.quaternion',
    [0, 1],
    [0, 0, 0, 1, Z90.x, Z90.y, Z90.z, Z90.w],
  )
  return new THREE.AnimationClip('test', 1, [track])
}

describe('PosePreviewMixer', () => {
  it('is inert before attach — play() is a no-op', () => {
    const mixer = new PosePreviewMixer()
    mixer.play(makeClip())
    expect(mixer.playing).toBe(false)
    mixer.update(0.5) // must not throw
  })

  it('drives the bone quaternion during playback', () => {
    const { root, bone } = makeRig()
    const mixer = new PosePreviewMixer()
    mixer.attach(root)
    mixer.play(makeClip())
    expect(mixer.playing).toBe(true)

    mixer.update(0.5)
    // Halfway: slerp(identity, Z90, 0.5) = 45° about Z
    const expected = new THREE.Quaternion().slerp(Z90, 0.5)
    expect(bone.quaternion.angleTo(expected)).toBeLessThan(ANGLE_EPS)
  })

  it('LoopOnce clamps at the final pose and fires onFinished', () => {
    const { root, bone } = makeRig()
    const mixer = new PosePreviewMixer()
    let finished = 0
    mixer.onFinished = () => { finished++ }
    mixer.attach(root)
    mixer.play(makeClip())

    mixer.update(1.5) // past duration
    expect(finished).toBe(1)
    expect(mixer.playing).toBe(false)
    // clampWhenFinished holds the last keyframe instead of wrapping to t=0
    expect(bone.quaternion.angleTo(Z90)).toBeLessThan(ANGLE_EPS)
  })

  it('does not advance after the finished clamp', () => {
    const { root, bone } = makeRig()
    const mixer = new PosePreviewMixer()
    mixer.attach(root)
    mixer.play(makeClip())
    mixer.update(1.5)
    const held = bone.quaternion.toArray()
    mixer.update(1.0) // playing=false → update is a no-op
    expect(bone.quaternion.toArray()).toEqual(held)
  })

  it('stop() halts playback and restarting play() works', () => {
    const { root, bone } = makeRig()
    const mixer = new PosePreviewMixer()
    mixer.attach(root)
    mixer.play(makeClip())
    mixer.update(0.25)
    mixer.stop()
    expect(mixer.playing).toBe(false)

    mixer.play(makeClip())
    expect(mixer.playing).toBe(true)
    mixer.update(1.5)
    expect(bone.quaternion.angleTo(Z90)).toBeLessThan(ANGLE_EPS)
  })

  it('dispose() tears down and a new attach()+play() still works', () => {
    const { root } = makeRig()
    const mixer = new PosePreviewMixer()
    mixer.attach(root)
    mixer.play(makeClip())
    mixer.dispose()
    expect(mixer.playing).toBe(false)

    const rig2 = makeRig()
    mixer.attach(rig2.root)
    mixer.play(makeClip())
    expect(mixer.playing).toBe(true)
    mixer.update(1.5)
    expect(rig2.bone.quaternion.angleTo(Z90)).toBeLessThan(ANGLE_EPS)
  })

  it('attach() with the same root keeps the mixer; a new root resets it', () => {
    const { root } = makeRig()
    const mixer = new PosePreviewMixer()
    mixer.attach(root)
    mixer.play(makeClip())
    mixer.attach(root) // same root — playback untouched
    expect(mixer.playing).toBe(true)

    const rig2 = makeRig()
    mixer.attach(rig2.root) // different root — full reset
    expect(mixer.playing).toBe(false)
  })
})
