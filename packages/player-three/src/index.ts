export type { TerrainSurfaceSampler } from './terrainSurface'
export {
  PlayerController,
  DEFAULT_SKINNED_CROUCH_TERRAIN_Y_DELTA,
  PLAYER_CAPSULE_HALF_HEIGHT,
  sampleTerrainFootprintY,
  type PlayerControllerConfig,
  type PlayerControllerEvent,
  type PlayerControllerState,
  type PlayerControllerTickContext,
  type PlayerMode,
  type WaterMode,
  type AirMode,
  type HazardMode,
  type RecoveryMode,
} from './PlayerController'
export {
  resolveConsequence,
  type ConsequenceAction,
  type ConsequenceContext,
  type ConsequenceHazardType,
  type ConsequenceLocomotionClass,
  type ConsequenceResolution,
  type ConsequenceSeverity,
} from './consequencePolicy'
export { CharacterAnimationRig, type CharacterAnimationRigConfig } from './CharacterAnimationRig'
export {
  computeLandImpactTier,
  resolveCharacterOverlayClips,
  resolveWaterClips,
  type AnimationOverlaySlot,
  type CharacterOverlayClipSet,
  type CharacterWaterClipSet,
  type LandImpactTier,
  LAND_IMPACT_MEDIUM_MAX_FALL_M,
  LAND_IMPACT_HARD_MAX_FALL_M,
  LAND_IMPACT_CRITICAL_MAX_FALL_M,
  LAND_IMPACT_SKIP_AIR_S,
  LAND_IMPACT_SKIP_FALL_M,
  LAND_IMPACT_SOFT_MAX_FALL_M,
} from './animationOverlayAssignments'
export {
  normalizeClipLabelForMatch,
  pickClipByPatterns,
  resolveCharacterLocomotionClips,
  resolveStandRunFwdClip,
  resolveSteadyLocomotionClip,
  type CharacterLocomotionClipSet,
  type LocomotionSteadySlot,
} from './locomotionClipAssignments'
export {
  stripMixamoHipsPositionTracks,
  sanitizeMixamoClips,
} from './mixamoAnimationUtils'
export {
  largestSkinnedMesh,
  primarySkinnedMeshForRig,
  pruneExtraSkinnedMeshes,
} from './mixamoSkinnedMeshUtils'
export {
  findMixamoHipBoneName,
  remapClipTracksToTargetSkeleton,
  retargetMixamoClipsToCharacter,
} from './mixamoRetargetClips'
export { MIXAMO_FBX_CLIP_URLS } from './mixamoFbxClipUrls'
