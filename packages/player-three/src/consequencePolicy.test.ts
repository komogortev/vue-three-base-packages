import { describe, expect, it } from 'vitest'
import { resolveConsequence, type ConsequenceContext } from './consequencePolicy'

describe('resolveConsequence', () => {
  it('maps wall contact to L1 stumble', () => {
    const input: ConsequenceContext = {
      hazardType: 'wall',
      locomotionClass: 'walk_like',
      bypassActive: false,
    }
    expect(resolveConsequence(input)).toEqual({ action: 'wall_stumble', severity: 'L1' })
  })

  it('maps pit walk to L1 warning', () => {
    const input: ConsequenceContext = {
      hazardType: 'pit',
      locomotionClass: 'walk_like',
      bypassActive: false,
    }
    expect(resolveConsequence(input)).toEqual({ action: 'pit_warning', severity: 'L1' })
  })

  it('maps pit sprint to L3 fall', () => {
    const input: ConsequenceContext = {
      hazardType: 'pit',
      locomotionClass: 'sprint',
      bypassActive: false,
    }
    expect(resolveConsequence(input)).toEqual({ action: 'pit_fall', severity: 'L3' })
  })

  it('maps bypass-active pit to L2 bypass fall', () => {
    const input: ConsequenceContext = {
      hazardType: 'pit',
      locomotionClass: 'walk_like',
      bypassActive: true,
    }
    expect(resolveConsequence(input)).toEqual({ action: 'pit_bypass_fall', severity: 'L2' })
  })
})
