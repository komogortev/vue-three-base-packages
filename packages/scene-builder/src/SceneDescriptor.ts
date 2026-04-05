/**
 * SceneDescriptor — pure TypeScript types, no Three.js imports.
 *
 * A SceneDescriptor is a plain data object that fully describes a 3D scene.
 * Hand it to SceneBuilder to get a live Three.js scene.
 * Host modules pass the same object into their engine wiring (e.g. third-person scene).
 *
 * Design principles:
 * - Author in world-space coordinates (X right, Y up, Z toward viewer)
 * - groundRadius = 50 means a 100-unit diameter playable disc
 * - seaLevel = 0 by default; water renders at this Y, terrain can go negative
 * - All features are additive / subtractive from a flat Y=0 baseline
 */

// ─── Path types ───────────────────────────────────────────────────────────────

/**
 * A 2D point [x, z]. Y is automatically computed as:
 *   baseTerrainAt(x, z) − feature.depth
 * Use for rivers that stay on the terrain surface.
 */
export type PathPoint2D = [number, number]

/**
 * A 3D point [x, y, z] with an explicit world-space Y.
 * Use for rivers that descend below sea level (ocean floors, dive scenes).
 */
export type PathPoint3D = [number, number, number]

export type PathPoint = PathPoint2D | PathPoint3D

// ─── Terrain features ─────────────────────────────────────────────────────────

/**
 * Gaussian hill centred at (x, z).
 * Height falls off as exp(-dist² / radius²) — roughly flat beyond 2×radius.
 */
export interface HillFeature {
  type: 'hill'
  x: number
  z: number
  /** Influence radius — controls how broad the base is, not a hard edge. */
  radius: number
  /** Peak height above the baseline in world units. */
  height: number
}

/**
 * Smooth bowl depression centred at (x, z).
 * Uses a cosine cross-section so the edge blends seamlessly into surrounding terrain.
 * Any part of the bowl below seaLevel fills with water automatically.
 */
export interface LakeFeature {
  type: 'lake'
  x: number
  z: number
  /** Hard radius — depression reaches 0 exactly at this distance. */
  radius: number
  /** Maximum depth at the centre in world units. */
  depth: number
}

/**
 * River channel carved along a CatmullRom spline.
 *
 * Path points can be 2D [x, z] or 3D [x, y, z]:
 * - 2D: river floor Y = baseTerrainAt(x, z) − depth  (surface river, ergonomic)
 * - 3D: river floor Y = explicit value                (for sub-sea-level sections)
 * Mixed arrays are supported — each point is evaluated independently.
 *
 * The cross-section is a cosine arch (smooth banks, no hard walls).
 */
export interface RiverFeature {
  type: 'river'
  path: PathPoint[]
  /** Full channel width in world units. */
  width: number
  /** How deep the channel floor sits below the river-floor Y at the centreline. */
  depth: number
}

/**
 * Grayscale image-driven heightmap.
 *
 * Pixel encoding:
 *   White  (255) → +amplitude  world units above baseline
 *   Mid-grey (128) → 0          (no displacement)
 *   Black  (0)   → −amplitude  world units below baseline (depression / ocean floor)
 *
 * Image orientation:
 *   Image top    → world −Z (north)
 *   Image left   → world −X (west)
 *   Image bottom → world +Z (south)
 *   Image right  → world +X (east)
 *
 * Sampling is bilinear — smooth slopes regardless of image resolution.
 * Composes additively with all other features.
 */
export interface HeightmapFeature {
  type: 'heightmap'
  /** Path relative to /public, e.g. '/terrains/valley.png' */
  url: string
  /** World units corresponding to a fully white or fully black pixel. */
  amplitude: number
  /** World-space width the image covers. Defaults to terrain diameter (radius×2). */
  worldWidth?: number
  /** World-space depth the image covers. Defaults to terrain diameter (radius×2). */
  worldDepth?: number
  /** World X of the image centre. Defaults to 0. */
  offsetX?: number
  /** World Z of the image centre. Defaults to 0. */
  offsetZ?: number
}

export type TerrainFeature = HillFeature | LakeFeature | RiverFeature | HeightmapFeature

// ─── Terrain ─────────────────────────────────────────────────────────────────

export interface TerrainDescriptor {
  /** Playable disc half-diameter. Terrain is square under the hood; fog hides corners. */
  radius?: number          // default 50
  /** Vertex grid resolution per axis. Higher = smoother hills but slower build. */
  resolution?: number      // default 160
  /** Y at which the water surface renders. Terrain below this value is submerged. */
  seaLevel?: number        // default 0
  /** Base terrain mesh colour. */
  baseColor?: number       // default 0x1a2a14
  /**
   * Terrain mesh opacity [0–1]. Default 1 (opaque).
   * Values below 1 blend the displaced ground with GLB scenery underneath (heightmap still drives collision/sampling).
   */
  baseOpacity?: number
  /** Water surface colour. */
  waterColor?: number      // default 0x0a2040
  /** Water surface opacity [0–1]. */
  waterOpacity?: number    // default 0.72
  features?: TerrainFeature[]
}

// ─── Atmosphere ───────────────────────────────────────────────────────────────

export interface DirectionalLight {
  type: 'directional'
  color?: number
  intensity?: number
  position: [number, number, number]
}

export interface PointLight {
  type: 'point'
  color?: number
  intensity?: number
  position: [number, number, number]
}

export type LightDescriptor = DirectionalLight | PointLight

// ─── Time / sky / clouds (optional; see docs/atmosphere-time-sky.md) ─────────

/**
 * Day-night phase on a 0→1 loop: 0 ≈ midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 */
export interface TimeCycleDescriptor {
  /** Starting phase when the scene loads. Default ~0.28 (morning). */
  initialPhase?: number
  /**
   * How fast phase advances in **real time** (phase units per second).
   * `0` = frozen (static lighting). Example: `1 / 600` ≈ one full day per 10 minutes.
   */
  phaseSpeed?: number
}

export type SkyModel = 'physical' | 'gradient'

/**
 * `physical` = Three.js Preetham analytic sky (sun-driven).
 * `gradient` = cheap zenith/horizon sphere + sun disc highlight.
 */
export interface SkyDescriptor {
  model?: SkyModel
  zenithColor?: number
  horizonColor?: number
  /** Preetham tuning (physical only). */
  turbidity?: number
  rayleigh?: number
  mieCoefficient?: number
  mieDirectionalG?: number
}

export interface SunMoonDescriptor {
  sunColor?: number
  sunIntensity?: number
  moonColor?: number
  moonIntensity?: number
  /** Phase offset of moon vs sun (default ~0.5 = opposite). */
  moonPhaseOffset?: number
  showDiscs?: boolean
}

/**
 * Procedural scrolling cloud sheet; opacity/density can vary with day phase.
 */
export interface CloudLayerDescriptor {
  enabled?: boolean
  height?: number
  scale?: number
  /** Wind direction weights for UV scroll (stream direction). */
  windX?: number
  windZ?: number
  /** Multiplier on scroll animation speed. */
  scrollSpeed?: number
  opacity?: number
  /** Phase range [0,1) where layer is visible (wrap-aware blend at edges). */
  visibleFrom?: number
  visibleTo?: number
  /** Density multiplier at night vs noon (shader blend). */
  densityAtNight?: number
  densityAtNoon?: number
}

export interface AtmosphereDescriptor {
  /** Scene background and fog colour (flat mode; overridden by dynamic sky fog tint). */
  fogColor?: number        // default 0x080810
  /** Exponential fog density — 0.012 reaches fog at ~60 units. */
  fogDensity?: number      // default 0.012
  /** Flat ambient tint (see `AmbientLight`). */
  ambientColor?: number    // default 0x334155
  ambientIntensity?: number // default 0.9
  /**
   * Sky/ground fill when `dynamicSky` — softens N·L “hard shadow” look on characters.
   * Defaults applied in `SceneBuilder` when `dynamicSky` is true (unless intensity is 0).
   */
  hemisphereSkyColor?: number
  hemisphereGroundColor?: number
  /** Set to 0 to disable hemisphere fill; default when omitted with dynamic sky is 0.52. */
  hemisphereIntensity?: number
  /** Custom lights. If omitted, a default key + rim rig is added. */
  lights?: LightDescriptor[]

  /**
   * When `true`, SceneBuilder skips built-in directional key/rim and **directional**
   * entries in `lights` (point lights still added). Sun/moon + sky come from
   * `EnvironmentRuntime` (time / sky / clouds).
   */
  dynamicSky?: boolean
  time?: TimeCycleDescriptor
  sky?: SkyDescriptor
  sunMoon?: SunMoonDescriptor
  /** One layer for now; array reserved for future stacking. */
  clouds?: CloudLayerDescriptor | CloudLayerDescriptor[]
}

// ─── Character ───────────────────────────────────────────────────────────────

export interface CharacterDescriptor {
  /** [x, z] spawn point. Y is clamped to terrain surface automatically. */
  startPosition?: [number, number]
  /**
   * Public URL to a **GLTF/GLB** or **FBX** (e.g. Mixamo download under `/public/...`).
   * FBX uses `FBXLoader` in `@base/threejs-engine`; glTF is usually smaller and PBR-friendlier.
   */
  modelUrl?: string
  /** Uniform scale applied before bounding-box alignment. Default 1. */
  modelScale?: number
  /**
   * If set (> 0), multiplies scale again so axis-aligned **height** of the loaded character **clone**
   * matches this many world units (after `modelScale`). Uses the full model subtree so multi-mesh rigs
   * (body + legs + boots) size correctly; foot alignment still uses the primary mesh only.
   * Measurement uses **precise** `Box3` (skinned vertices) so FBX bind-pose boxes do not under-estimate height.
   */
  modelFitHeight?: number
  /**
   * In dev, logs measured AABB heights and scale factors after load (see browser console).
   */
  debugCharacterBounds?: boolean
  /**
   * When `true` (default), drop extra `SkinnedMesh`es and keep one “primary” body mesh (avoids duplicate
   * bind-pose bodies on some Mixamo exports). Set `false` to keep boots/feet/extra parts as separate meshes
   * (they usually share the same skeleton; one `AnimationMixer` still drives the rig).
   */
  pruneExtraSkinnedMeshes?: boolean
  /**
   * Terrain height under the character uses the **lowest** sample in a small + pattern (see
   * `sampleTerrainFootprintY` in `@base/player-three`). Omitted ⇒ `0.22` when `modelUrl` is set, else `0`.
   * Set `0` to force a single centre sample only.
   */
  terrainFootprintRadius?: number
  /** Extra local Y offset after foot alignment (up/down tweak). Default 0. */
  modelYOffset?: number
  /** World-space Y offset from sampled terrain to character **root** when grounded (feet pivot ⇒ 0). Capsule uses capsule half-height. */
  terrainPivotYOffset?: number
  /** Added to root `rotation.y` after load (model forward vs engine −Z). Default 0. */
  rotationY?: number
  /**
   * Extra glTF/GLB URLs whose **animation clips** are merged onto the player (same skeleton / bone names).
   * Quaternius **Universal Animation Library** Godot/Unreal exports match **Universal Base Characters**.
   * Each URL may be **.gltf/.glb** or **.fbx** (Mixamo); all clips are merged.
   */
  animationClipUrls?: string[]
}

// ─── Objects ─────────────────────────────────────────────────────────────────

/**
 * Built-in primitive types. No asset loading needed — geometry is built in code.
 * Swap any for a GLTF model in Step 4d without changing the descriptor structure.
 */
export type PrimitiveType = 'rock' | 'tree' | 'crystal' | 'pillar'

/**
 * A single explicitly-placed primitive object.
 * Y is auto-snapped to the terrain surface; objects placed below sea level are skipped.
 */
export interface PlacedObject {
  type: PrimitiveType
  x: number
  z: number
  /** Uniform scale multiplier. Default 1. */
  scale?: number
  /** Y-axis rotation in radians. Default 0. */
  rotationY?: number
}

/**
 * A density field that scatters primitives within a donut zone.
 *
 * Placement algorithm:
 *   - Uniform area distribution (no clustering at inner radius).
 *   - Fully deterministic: same `seed` → same layout every time.
 *   - Objects that land below sea level or outside the terrain disc are skipped
 *     and retried, up to count × 10 attempts.
 *
 * @example
 * // Ring of trees around a lake
 * { type: 'scatter', primitive: 'tree', count: 24,
 *   centerX: -14, centerZ: -8, innerRadius: 12, outerRadius: 20, seed: 7 }
 */
export interface ScatterField {
  type: 'scatter'
  primitive: PrimitiveType
  count: number
  /** World X of the scatter zone centre. Default 0. */
  centerX?: number
  /** World Z of the scatter zone centre. Default 0. */
  centerZ?: number
  /** Inner exclusion radius — no objects within this distance from centre. Default 0. */
  innerRadius?: number
  /** Outer radius of the scatter zone. */
  outerRadius: number
  /** Minimum scale applied to each instance. Default 0.75. */
  scaleMin?: number
  /** Maximum scale applied to each instance. Default 1.25. */
  scaleMax?: number
  /** PRNG seed for deterministic layout. Change to get a different arrangement. Default 0. */
  seed?: number
}

/**
 * A GLTF/GLB model placed at an explicit world position.
 * The model's pivot sits at terrain Y (no automatic base offset — set `scale`
 * and inspect the loaded model to determine any manual Y adjustment needed).
 *
 * @example
 * { type: 'gltf', url: '/models/lantern.glb', x: 12, z: -8, scale: 0.5 }
 */
export interface GltfObject {
  type: 'gltf'
  /** Path served from /public, e.g. '/models/tree.glb' */
  url: string
  x: number
  z: number
  /** Uniform scale multiplier. Default 1. */
  scale?: number
  /** Y-axis rotation in radians. Default 0. */
  rotationY?: number
  /**
   * World Y for the model pivot. When set, overrides terrain sampling for height and skips
   * the “below seaLevel” placement rejection.
   */
  y?: number
  /**
   * When true, place the model even if {@link TerrainSampler} is below `seaLevel` at (x,z)
   * (e.g. heightmap dips). Uses sampled Y. Default false — props underwater are skipped.
   */
  allowBelowSeaLevel?: boolean
  /**
   * When true and the GLB includes embedded animation clips, {@link SceneBuilder} starts a
   * looping clip on an {@link THREE.AnimationMixer} and registers a tick (gameplay) or expects
   * the editor frame loop to call `mixer.update` — see {@link SceneBuilderResult.disposeEmbeddedGltfAnimations}.
   */
  playEmbeddedAnimations?: boolean
  /**
   * Substring match (case-insensitive) on clip name; first match loops when
   * {@link playEmbeddedAnimations} is true or {@link animationPackUrls} are present.
   * Takes priority over {@link loopClipIndex}.
   */
  loopClipNameContains?: string
  /**
   * Fallback clip index when {@link loopClipNameContains} is not set.
   * Default 0 (first clip in the pack).
   */
  loopClipIndex?: number
  /**
   * External GLB URLs whose animation clips are merged onto this model's skeleton.
   * Loaded in parallel after the mesh GLB; clips are retargeted to the model's SkinnedMesh rig.
   *
   * Use `npcAnimPacks()` (from `npcUrls.ts`) to compose the correct URL list — base by default,
   * base + extended when a scene needs social/emote clips.
   *
   * @example
   * // NPC with default base locomotion only
   * { type: 'gltf', url: NPC_CHARACTER_URLS.man40yOutdoors, animationPackUrls: npcAnimPacks() }
   *
   * @example
   * // NPC that needs extended emotes (scene-05 bench conversation)
   * { type: 'gltf', url: NPC_CHARACTER_URLS.man60yCasual, animationPackUrls: npcAnimPacks({ extended: true }) }
   */
  animationPackUrls?: string[]
}

export type SceneObject = PlacedObject | ScatterField | GltfObject

// ─── Root ─────────────────────────────────────────────────────────────────────

/**
 * An explicit swimmable volume — a rectangular XZ area with its own water surface Y.
 *
 * Use this instead of relying on `terrain.seaLevel` alone when:
 *  - The scene has multiple water bodies at different elevations (elevated pools, sunken lakes).
 *  - Only part of the terrain is swimmable (a river, a pool, an ocean bay).
 *  - The water surface Y differs from the global `terrain.seaLevel` (e.g. a raised fountain).
 *
 * The `PlayerController` activates water physics when the character's feet enter any volume's
 * XZ bounds and dip below `surfaceY`. `surfaceY` acts as the buoyancy target for that body.
 *
 * @example
 * // A pool at the world center, sea-level surface
 * { bounds: { minX: -5, maxX: 5, minZ: -25, maxZ: 25 }, surfaceY: 0, label: 'main-pool' }
 *
 * @example
 * // Elevated fountain basin 3 m above ground
 * { bounds: { minX: 8, maxX: 14, minZ: -3, maxZ: 3 }, surfaceY: 3, label: 'fountain' }
 */
export interface SwimmableVolume {
  /** World-space XZ axis-aligned bounding rectangle. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Water surface world Y within this volume. The character floats at this Y. */
  surfaceY: number
  /** Optional human-readable label for debugging and editor display. */
  label?: string
}

export interface SceneDescriptor {
  terrain?: TerrainDescriptor
  atmosphere?: AtmosphereDescriptor
  character?: CharacterDescriptor
  objects?: SceneObject[]
  /**
   * Explicit swimmable volumes for water physics. Preferred over the implicit `terrain.seaLevel`
   * approach when the scene has multiple water bodies or non-global water surfaces.
   *
   * When present, `PlayerController` uses these volumes for water entry/exit detection.
   * When absent, falls back to a single global volume derived from `terrain.seaLevel` (if > 0
   * or explicitly configured on the controller via `waterSurfaceY`).
   */
  swimmableVolumes?: SwimmableVolume[]
  /**
   * When true, {@link SceneBuilder.build} skips spawning the player character (editor orbit view;
   * walk mode adds a temporary avatar via {@link SceneBuilder.buildCharacter}).
   */
  skipPlayerCharacter?: boolean
}
