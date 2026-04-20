import { describe, it, expect } from 'vitest'
import {
  THIRD_PERSON_CAMERA_PRESETS,
  THIRD_PERSON_CAMERA_PRESET_ORDER,
  resolveThirdPersonViewCam,
} from './thirdPersonPresets'
import type { ThirdPersonCameraPreset } from './thirdPersonPresets'

describe('THIRD_PERSON_CAMERA_PRESETS', () => {
  it('defines all four named presets', () => {
    const keys: ThirdPersonCameraPreset[] = ['close-follow', 'shoulder', 'high', 'tactical']
    for (const key of keys) {
      expect(THIRD_PERSON_CAMERA_PRESETS).toHaveProperty(key)
    }
  })

  it('each preset has positive distance, height, and pivotY', () => {
    for (const preset of Object.values(THIRD_PERSON_CAMERA_PRESETS)) {
      expect(preset.distance).toBeGreaterThan(0)
      expect(preset.height).toBeGreaterThan(0)
      expect(preset.pivotY).toBeGreaterThan(0)
    }
  })

  it('PRESET_ORDER covers every defined preset', () => {
    const definedKeys = Object.keys(THIRD_PERSON_CAMERA_PRESETS).sort()
    const orderedKeys = [...THIRD_PERSON_CAMERA_PRESET_ORDER].sort()
    expect(orderedKeys).toEqual(definedKeys)
  })

  it('tactical is further and higher than close-follow', () => {
    const close = THIRD_PERSON_CAMERA_PRESETS['close-follow']
    const tactical = THIRD_PERSON_CAMERA_PRESETS['tactical']
    expect(tactical.distance).toBeGreaterThan(close.distance)
    expect(tactical.height).toBeGreaterThan(close.height)
  })
})

describe('resolveThirdPersonViewCam', () => {
  it('returns base preset values when no overrides given', () => {
    const result = resolveThirdPersonViewCam('shoulder')
    const base = THIRD_PERSON_CAMERA_PRESETS['shoulder']
    expect(result).toEqual(base)
  })

  it('applies a partial override (distance only)', () => {
    const result = resolveThirdPersonViewCam('close-follow', { distance: 99 })
    expect(result.distance).toBe(99)
    expect(result.height).toBe(THIRD_PERSON_CAMERA_PRESETS['close-follow'].height)
  })

  it('applies all four override fields', () => {
    const overrides = { distance: 1, height: 2, lateral: 3, pivotY: 4 }
    const result = resolveThirdPersonViewCam('high', overrides)
    expect(result).toEqual(overrides)
  })

  it('returns a new object — does not mutate the preset table', () => {
    const before = { ...THIRD_PERSON_CAMERA_PRESETS['high'] }
    resolveThirdPersonViewCam('high', { distance: 999 })
    expect(THIRD_PERSON_CAMERA_PRESETS['high']).toEqual(before)
  })

  it('default overrides argument produces base values', () => {
    const result = resolveThirdPersonViewCam('tactical')
    expect(result).toEqual(THIRD_PERSON_CAMERA_PRESETS['tactical'])
  })
})
