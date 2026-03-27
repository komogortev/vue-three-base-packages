export type ConsequenceHazardType = 'wall' | 'pit'
export type ConsequenceLocomotionClass = 'walk_like' | 'sprint'
export type ConsequenceSeverity = 'L1' | 'L2' | 'L3'
export type ConsequenceAction =
  | 'wall_stumble'
  | 'pit_warning'
  | 'pit_fall'
  | 'pit_bypass_fall'

export interface ConsequenceContext {
  hazardType: ConsequenceHazardType
  locomotionClass: ConsequenceLocomotionClass
  bypassActive: boolean
}

export interface ConsequenceResolution {
  action: ConsequenceAction
  severity: ConsequenceSeverity
}

/**
 * First-pass consequence policy for grounded wall/pit reactions.
 * Pure mapping by hazard + locomotion class + bypass state.
 */
export function resolveConsequence(ctx: ConsequenceContext): ConsequenceResolution {
  if (ctx.hazardType === 'wall') return { action: 'wall_stumble', severity: 'L1' }
  if (ctx.bypassActive) return { action: 'pit_bypass_fall', severity: 'L2' }
  if (ctx.locomotionClass === 'sprint') return { action: 'pit_fall', severity: 'L3' }
  return { action: 'pit_warning', severity: 'L1' }
}
