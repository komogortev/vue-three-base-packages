// @base/scene-builder — SceneDescriptor → Three.js scene construction

export type { HeightmapData, ResolvePublicUrl } from './HeightmapLoader'
export { loadHeightmap, sampleHeightmap } from './HeightmapLoader'

export { bindResolvePublicUrl, resolveStaticAssetUrl } from './resolvePublicUrl'

export * from './SceneDescriptor'

export { TerrainSampler } from './TerrainSampler'
export { PrimitiveFactory, PRIMITIVE_BASE_OFFSETS } from './PrimitiveFactory'
export { createSeeder } from './Seeder'
export { convertUnlitToPbrRough } from './gltfMaterialUtils'
export {
  attachEmbeddedGltfAnimations,
  pickEmbeddedGltfLoopClip,
  type GltfEmbeddedAnimationOptions,
} from './gltfEmbeddedAnimation'

export {
  SceneBuilder,
  type SceneBuilderResult,
  type SceneBuildOptions,
  type NpcGltfEntry,
} from './SceneBuilder'

export { EnvironmentRuntime, type EnvironmentState } from './EnvironmentRuntime'
