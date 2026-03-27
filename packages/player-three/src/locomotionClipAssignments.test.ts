import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  normalizeClipLabelForMatch,
  pickClipByPatterns,
  resolveCharacterLocomotionClips,
  resolveStandRunFwdClip,
  resolveSteadyLocomotionClip,
} from './locomotionClipAssignments'

function clip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [])
}

describe('normalizeClipLabelForMatch', () => {
  it('treats scenario-style filenames like Mixamo labels', () => {
    expect(normalizeClipLabelForMatch('locomotion__run__slow')).toBe('locomotion run slow')
  })
})

describe('resolveStandRunFwdClip', () => {
  it('picks a single run clip; prefers sprint name when both exist', () => {
    const clips = [clip('Walking'), clip('Running slow'), clip('Running sprint')]
    const walk = pickClipByPatterns(clips, [/^walking$/i])
    const run = resolveStandRunFwdClip(clips, walk)
    expect(run?.name).toBe('Running sprint')
  })

  it('does not use forward walk clip as run', () => {
    const clips = [clip('Walking')]
    const run = resolveStandRunFwdClip(clips, clips[0])
    expect(run).toBeUndefined()
  })

  it('falls back to generic running when sprint/slow names missing', () => {
    const clips = [clip('Walking'), clip('Jog')]
    const walk = pickClipByPatterns(clips, [/^walking$/i])
    expect(resolveStandRunFwdClip(clips, walk)?.name).toBe('Jog')
  })

  it('matches renamed run clip (sprint) via normalized label', () => {
    const clips = [clip('locomotion__run__sprint')]
    expect(resolveStandRunFwdClip(clips, undefined)?.name).toBe('locomotion__run__sprint')
  })
})

describe('resolveCharacterLocomotionClips', () => {
  it('resolves one run forward clip with walk', () => {
    const clips = [
      clip('Neutral Idle'),
      clip('Walking'),
      clip('Running slow'),
      clip('Running sprint'),
    ]
    const out = resolveCharacterLocomotionClips(clips)
    expect(out.idleStand?.name).toBe('Neutral Idle')
    expect(out.walkFwdStand?.name).toBe('Walking')
    expect(out.runFwdStand?.name).toBe('Running sprint')
  })
})

describe('resolveSteadyLocomotionClip', () => {
  it('finds crouch walk by slot key', () => {
    const clips = [clip('Crouched Walking')]
    expect(resolveSteadyLocomotionClip(clips, 'locomotion.crouch.walk_forward')?.name).toBe(
      'Crouched Walking',
    )
  })
})
