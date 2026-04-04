import * as THREE from 'three'
import { clone as cloneSkinnedRoot } from 'three/addons/utils/SkeletonUtils.js'
import type { ThreeContext } from '@base/threejs-engine'
import type {
  SceneDescriptor,
  CharacterDescriptor,
  LightDescriptor,
  TerrainDescriptor,
  SceneObject,
  PlacedObject,
  ScatterField,
  GltfObject,
  PrimitiveType,
} from './SceneDescriptor'
import { TerrainSampler } from './TerrainSampler'
import { type HeightmapData, loadHeightmap } from './HeightmapLoader'
import { PrimitiveFactory, PRIMITIVE_BASE_OFFSETS } from './PrimitiveFactory'
import { createSeeder } from './Seeder'
import {
  largestSkinnedMesh,
  PLAYER_CAPSULE_HALF_HEIGHT,
  pruneExtraSkinnedMeshes,
  retargetMixamoClipsToCharacter,
  sampleTerrainFootprintY,
  sanitizeMixamoClips,
} from '@base/player-three'
import { convertUnlitToPbrRough } from './gltfMaterialUtils'
import { attachEmbeddedGltfAnimations, pickEmbeddedGltfLoopClip } from './gltfEmbeddedAnimation'
import { bindResolvePublicUrl } from './resolvePublicUrl'
import type { ResolvePublicUrl } from './HeightmapLoader'

const defaultResolvePublicUrl: ResolvePublicUrl = bindResolvePublicUrl('/')

function isViteDev(): boolean {
  try {
    const im = import.meta as ImportMeta & { env?: { DEV?: boolean } }
    return im.env?.DEV === true
  } catch {
    return false
  }
}

/** Optional hooks for host apps (non-root base URL, custom asset hosts). */
export interface SceneBuildOptions {
  resolvePublicUrl?: ResolvePublicUrl
}

export interface SceneBuilderResult {
  sampler: TerrainSampler
  /** Locomotion root — omitted when `descriptor.skipPlayerCharacter` is true. */
  character?: THREE.Object3D
  /** Passed to `PlayerController.setTerrainYOffset` — set with `character`. */
  characterTerrainYOffset?: number
  terrainMesh: THREE.Mesh
  effectiveRadius: number
  /** All procedural scatter instances live under this group (editor can rebuild in place). */
  scatterRoot: THREE.Group
  /**
   * Unregisters the engine tick that advances mixers for `gltf` objects with
   * `playEmbeddedAnimations: true`. Call from the host module **before** clearing the scene
   * (e.g. `onUnmount`) to avoid updating freed subgraphs.
   */
  disposeEmbeddedGltfAnimations?: () => void
  /**
   * World [x, z] pairs of every `{ type: 'gltf' }` object that loaded successfully.
   * Use to suppress npcStub placeholders that have a real model loaded at the same position.
   */
  loadedGltfXZ: ReadonlyArray<readonly [number, number]>
}

/**
 * SceneBuilder — converts a SceneDescriptor into a live Three.js scene.
 *
 * All geometry is added directly to ctx.scene.
 * Call ctx.scene.clear() in onUnmount to dispose everything in one call.
 *
 * Build order:
 *   1. Atmosphere (background colour, fog, ambient light)
 *   2. Directional / point lights
 *   3. Terrain mesh (height-displaced PlaneGeometry)
 *   4. Water surface (single plane at seaLevel, only when terrain goes negative)
 *   5. Boundary ring (thin emissive torus at playable edge)
 *   6. Character (unless `skipPlayerCharacter`)
 *   7. Scene objects (explicit PlacedObjects + seeded ScatterFields)
 */
export class SceneBuilder {
  private static embeddedGltfAnimBuildSeq = 0

  static async build(
    ctx: ThreeContext,
    descriptor: SceneDescriptor,
    options?: SceneBuildOptions,
  ): Promise<SceneBuilderResult> {
    const resolvePublicUrl = options?.resolvePublicUrl ?? defaultResolvePublicUrl

    const terrain = descriptor.terrain ?? {}
    const atmo = descriptor.atmosphere ?? {}
    const charDesc = descriptor.character ?? {}

    const radius = terrain.radius ?? 50
    const seaLevel = terrain.seaLevel ?? 0

    const heightmapData = await SceneBuilder.loadHeightmaps(terrain, radius, resolvePublicUrl)

    // ── Atmosphere ────────────────────────────────────────────────────────────
    const fogColor = atmo.fogColor ?? 0x080810
    ctx.scene.background = new THREE.Color(fogColor)
    ctx.scene.fog = new THREE.FogExp2(fogColor, atmo.fogDensity ?? 0.012)

    const ambientColor     = atmo.ambientColor     ?? 0x334155
    const ambientIntensity = atmo.ambientIntensity ?? 0.9
    ctx.scene.add(new THREE.AmbientLight(ambientColor, ambientIntensity))

    const dynamicSky = atmo.dynamicSky === true

    if (dynamicSky) {
      const hi = atmo.hemisphereIntensity
      const hemiOn = hi === undefined ? true : hi > 0
      if (hemiOn) {
        const sky    = atmo.hemisphereSkyColor    ?? 0xb8d4f0
        const ground = atmo.hemisphereGroundColor ?? 0x2f3d2c
        const hInt   = hi === undefined ? 0.52 : hi
        const hemi   = new THREE.HemisphereLight(sky, ground, hInt)
        hemi.name    = 'atmosphere-hemisphere-fill'
        ctx.scene.add(hemi)
      }
    }

    if (atmo.lights && atmo.lights.length > 0) {
      for (const l of atmo.lights) {
        if (dynamicSky && l.type === 'directional') continue
        SceneBuilder.addLight(ctx.scene, l)
      }
    }

    if (!dynamicSky && (!atmo.lights || atmo.lights.length === 0)) {
      const key = new THREE.DirectionalLight(0xffeedd, 1.4)
      key.position.set(6, 12, 5)
      ctx.scene.add(key)

      const rim = new THREE.DirectionalLight(0x6d28d9, 1.0)
      rim.position.set(-6, 4, -8)
      ctx.scene.add(rim)
    }

    // ── Terrain ───────────────────────────────────────────────────────────────
    const sampler = new TerrainSampler(terrain.features ?? [], heightmapData)
    const terrainMesh = SceneBuilder.buildTerrain(sampler, terrain)
    ctx.scene.add(terrainMesh)

    // ── Water ─────────────────────────────────────────────────────────────────
    // Add water plane whenever features can produce sub-seaLevel terrain.
    const hasSubmergedFeatures =
      heightmapData.length > 0 ||
      (terrain.features ?? []).some((f) => f.type === 'lake' || f.type === 'river')
    if (hasSubmergedFeatures) {
      ctx.scene.add(
        SceneBuilder.buildWater(
          radius,
          seaLevel,
          terrain.waterColor   ?? 0x0a2040,
          terrain.waterOpacity ?? 0.72,
        ),
      )
    }

    // ── Boundary ring ─────────────────────────────────────────────────────────
    ctx.scene.add(SceneBuilder.buildBoundaryRing(radius))

    // ── Character ─────────────────────────────────────────────────────────────
    let character: THREE.Object3D | undefined
    let characterTerrainYOffset: number | undefined
    if (!descriptor.skipPlayerCharacter) {
      const [startX, startZ] = charDesc.startPosition ?? [0, 0]
      const footprintR =
        charDesc.terrainFootprintRadius ??
        (charDesc.modelUrl?.trim() ? 0.22 : 0)
      const groundY = sampleTerrainFootprintY(sampler, startX, startZ, footprintR)
      const built = await SceneBuilder.buildCharacter(ctx, charDesc, options)
      character = built.object
      characterTerrainYOffset = built.terrainYOffset
      character.position.set(startX, groundY + characterTerrainYOffset, startZ)
      ctx.scene.add(character)
    }

    // ── Objects ───────────────────────────────────────────────────────────────
    const scatterRoot = new THREE.Group()
    scatterRoot.name = 'scene-scatter-root'
    ctx.scene.add(scatterRoot)

    const embeddedGltfMixers: THREE.AnimationMixer[] = []
    const loadedGltfXZ = await SceneBuilder.placeObjects(
      ctx,
      descriptor.objects ?? [],
      sampler,
      radius,
      seaLevel,
      scatterRoot,
      resolvePublicUrl,
      embeddedGltfMixers,
    )

    let disposeEmbeddedGltfAnimations: (() => void) | undefined
    if (embeddedGltfMixers.length > 0) {
      const id = `scene-builder-gltf-embed-${SceneBuilder.embeddedGltfAnimBuildSeq++}`
      disposeEmbeddedGltfAnimations = ctx.registerSystem(id, (delta) => {
        for (const m of embeddedGltfMixers) {
          m.update(delta)
        }
      })
    }

    return {
      sampler,
      character,
      characterTerrainYOffset,
      terrainMesh,
      effectiveRadius: radius,
      scatterRoot,
      disposeEmbeddedGltfAnimations,
      loadedGltfXZ,
    }
  }

  // ─── Terrain mesh ─────────────────────────────────────────────────────────────

  /**
   * Generates a height-displaced PlaneGeometry.
   *
   * The plane is square (radius*2 × radius*2). Vertices beyond `radius` are
   * pushed to Y=-2 so the jagged corners sit below the ground plane and
   * disappear under the boundary ring + fog. No shader clipping needed.
   *
   * Normals are recomputed after displacement for correct lighting on slopes.
   */
  private static buildTerrain(sampler: TerrainSampler, terrain: TerrainDescriptor): THREE.Mesh {
    const radius = terrain.radius     ?? 50
    const res    = terrain.resolution ?? 160
    const color   = terrain.baseColor   ?? 0x1a2a14
    const opacity = terrain.baseOpacity ?? 1
    const transparent = opacity < 1

    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, res, res)
    geo.rotateX(-Math.PI / 2)

    const pos = geo.attributes['position'] as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const outsideDisc = x * x + z * z > (radius + 1) * (radius + 1)
      pos.setY(i, outsideDisc ? -2 : sampler.sample(x, z))
    }

    pos.needsUpdate = true
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0.04,
      transparent,
      opacity,
      // Transparent terrain: avoid writing depth so island GLB behind reads more consistently through the tint.
      depthWrite: !transparent,
    })

    return new THREE.Mesh(geo, mat)
  }

  // ─── Water ────────────────────────────────────────────────────────────────────

  /**
   * A single flat plane at seaLevel covering the full terrain area.
   * Where terrain is above seaLevel the opaque terrain mesh occludes it.
   * Where terrain is below seaLevel the water surface shows on top.
   *
   * Offset by +0.02 to prevent Z-fighting at exactly seaLevel.
   */
  private static buildWater(
    radius: number,
    seaLevel: number,
    color: number,
    opacity: number,
  ): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2)
    geo.rotateX(-Math.PI / 2)

    const mat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      roughness: 0.05,
      metalness: 0.45,
      side: THREE.FrontSide,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = seaLevel + 0.02
    mesh.renderOrder = 1
    return mesh
  }

  // ─── Boundary ring ────────────────────────────────────────────────────────────

  /** Thin emissive torus lying flat at Y=0 marking the playable edge. */
  private static buildBoundaryRing(radius: number): THREE.Mesh {
    const geo = new THREE.TorusGeometry(radius, 0.06, 8, 80)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4f46e5,
      emissive: 0x4f46e5,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    return mesh
  }

  // ─── Character (capsule or glTF / FBX) ─────────────────────────────────────

  private static isFbxUrl(url: string): boolean {
    return /\.fbx(\?.*)?$/i.test(url)
  }

  /**
   * Mixamo FBX often names every clip `mixamo.com`; rename from the file stem so
   * {@link CharacterAnimationRig} can match idle / walk / strafe by label.
   */
  private static labelClipsFromSourceUrl(url: string, clips: THREE.AnimationClip[]): void {
    const tail = url.split(/[/\\]/).pop() ?? url
    const decoded = decodeURIComponent(tail.replace(/\?.*$/, ''))
    const stem = decoded.replace(/\.fbx$/i, '').trim() || 'clip'
    let i = 0
    for (const clip of clips) {
      const n = clip.name.trim().toLowerCase()
      if (
        !n ||
        n === 'mixamo.com' ||
        n === 'default' ||
        n === 'take 001' ||
        n.startsWith('mixamo')
      ) {
        clip.name = clips.length > 1 ? `${stem}_${i}` : stem
      }
      i++
    }
  }

  private static async loadModelWithAnimations(
    ctx: ThreeContext,
    url: string,
    resolvePublicUrl: ResolvePublicUrl,
  ): Promise<{ rootScene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
    const resolved = resolvePublicUrl(url)
    if (SceneBuilder.isFbxUrl(url)) {
      const r = await ctx.assets.loadFBX(resolved)
      const animations = [...r.animations]
      SceneBuilder.labelClipsFromSourceUrl(url, animations)
      return { rootScene: r.group, animations }
    }
    const gltf = await ctx.assets.loadGLTF(resolved)
    return { rootScene: gltf.scene, animations: [...gltf.animations] }
  }

  /** World-space vertical size of an object's axis-aligned bounds (empty ⇒ 0). */
  private static measureWorldAabbHeight(object: THREE.Object3D, precise: boolean): number {
    object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(object, precise)
    if (box.isEmpty()) return 0
    return box.max.y - box.min.y
  }

  /** FBX often leaves bones in a posed state; sizing must match bind pose or fit math disagrees with render. */
  private static resetSkinnedBindPose(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) {
        o.skeleton.pose()
      }
    })
  }

  /**
   * Capsule fallback, or glTF/FBX clone with feet aligned to local Y=0 under a named root group.
   * `terrainPivotYOffset` is world units above sampled ground for the root pivot when grounded.
   */
  /**
   * Capsule fallback, or skinned glTF/FBX (same path as full {@link SceneBuilder.build}).
   * Harnesses (e.g. editor walk) may call this without rebuilding terrain.
   */
  static async buildCharacter(
    ctx: ThreeContext,
    charDesc: CharacterDescriptor,
    options?: SceneBuildOptions,
  ): Promise<{ object: THREE.Object3D; terrainYOffset: number }> {
    const resolvePublicUrl = options?.resolvePublicUrl ?? defaultResolvePublicUrl
    const url = charDesc.modelUrl?.trim()
    if (url) {
      try {
        const { rootScene, animations } = await SceneBuilder.loadModelWithAnimations(
          ctx,
          url,
          resolvePublicUrl,
        )
        const model = cloneSkinnedRoot(rootScene) as THREE.Object3D
        const doPrune = charDesc.pruneExtraSkinnedMeshes !== false
        const skinnedTarget = doPrune
          ? pruneExtraSkinnedMeshes(model)
          : largestSkinnedMesh(model)
        const scale = charDesc.modelScale ?? 1
        model.scale.setScalar(scale)
        SceneBuilder.resetSkinnedBindPose(model)
        const fitH = charDesc.modelFitHeight
        if (isViteDev() && charDesc.debugCharacterBounds) {
          const hBind = SceneBuilder.measureWorldAabbHeight(model, false)
          const hSkin = SceneBuilder.measureWorldAabbHeight(model, true)
          console.info('[SceneBuilder] Character bounds (after modelScale)', {
            url,
            modelScale: scale,
            aabbHeightBindPose: hBind,
            aabbHeightSkinnedPrecise: hSkin,
            modelFitHeight: fitH ?? null,
          })
        }
        if (fitH != null && fitH > 0) {
          // Default Box3 path uses geometry bind-pose AABB × world matrix. For SkinnedMesh that is often
          // far smaller than the posed skeleton → tiny h → enormous fit multiplier → giant character.
          const h = SceneBuilder.measureWorldAabbHeight(model, true)
          if (h > 1e-3 && h < 5e5) {
            model.scale.multiplyScalar(fitH / h)
          } else if (isViteDev()) {
            console.warn('[SceneBuilder] modelFitHeight skipped — degenerate or huge AABB', {
              url,
              h,
              fitH,
            })
          }
        }
        if (isViteDev() && charDesc.debugCharacterBounds) {
          const hAfter = SceneBuilder.measureWorldAabbHeight(model, true)
          console.info('[SceneBuilder] Character bounds (after modelFitHeight, pre-parent)', {
            url,
            finalUniformScale: model.scale.x,
            aabbHeightSkinnedPrecise: hAfter,
          })
        }
        convertUnlitToPbrRough(model)

        const root = new THREE.Group()
        root.name = 'character-root'
        root.add(model)

        const pivotY = charDesc.terrainPivotYOffset ?? 0
        const modelYOffset = charDesc.modelYOffset ?? 0
        /** Visual yaw on mesh only — apply before foot alignment so the AABB matches rendered facing. */
        const ry = charDesc.rotationY ?? 0
        if (ry !== 0) model.rotation.y = ry

        const alignSource = skinnedTarget ?? root
        const alignFeet = (): void => {
          root.updateMatrixWorld(true)
          const b = new THREE.Box3().setFromObject(alignSource, true)
          if (b.isEmpty()) return
          model.position.set(0, -b.min.y + modelYOffset, 0)
        }
        alignFeet()

        let mergedClips: THREE.AnimationClip[] = [...animations]
        if (skinnedTarget) {
          mergedClips = [
            ...retargetMixamoClipsToCharacter(skinnedTarget, rootScene, animations),
          ]
          for (const clipUrl of charDesc.animationClipUrls ?? []) {
            const u = clipUrl.trim()
            if (!u) continue
            try {
              const extra = await SceneBuilder.loadModelWithAnimations(ctx, u, resolvePublicUrl)
              mergedClips.push(
                ...retargetMixamoClipsToCharacter(skinnedTarget, extra.rootScene, extra.animations),
              )
            } catch (err) {
              console.warn('[SceneBuilder] Optional animation clip URL failed:', u, err)
            }
          }
        } else {
          for (const clipUrl of charDesc.animationClipUrls ?? []) {
            const u = clipUrl.trim()
            if (!u) continue
            try {
              const extra = await SceneBuilder.loadModelWithAnimations(ctx, u, resolvePublicUrl)
              mergedClips.push(...extra.animations)
            } catch (err) {
              console.warn('[SceneBuilder] Optional animation clip URL failed:', u, err)
            }
          }
        }
        root.userData['gltfAnimations'] = sanitizeMixamoClips(mergedClips)

        // First fit used `model` off-scene; parenting + yaw can change the world AABB slightly.
        // A second pass scales against `root` so world height matches `modelFitHeight` when it drifted.
        if (fitH != null && fitH > 0) {
          root.updateMatrixWorld(true)
          const hRoot = SceneBuilder.measureWorldAabbHeight(root, true)
          if (hRoot > 1e-3 && Math.abs(hRoot - fitH) / fitH > 0.025) {
            model.scale.multiplyScalar(fitH / hRoot)
            model.position.set(0, 0, 0)
            alignFeet()
            if (isViteDev() && charDesc.debugCharacterBounds) {
              console.info('[SceneBuilder] Character bounds (after root-space correction)', {
                url,
                heightBefore: hRoot,
                heightAfter: SceneBuilder.measureWorldAabbHeight(root, true),
                finalUniformScale: model.scale.x,
              })
            }
          }
        }

        return { object: root, terrainYOffset: pivotY }
      } catch (err) {
        console.warn('[SceneBuilder] Character model failed, using capsule:', url, err)
      }
    }

    const geo = new THREE.CapsuleGeometry(0.35, 1.0, 8, 16)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      roughness: 0.5,
      metalness: 0.2,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'character-capsule'
    const ry = charDesc.rotationY ?? 0
    if (ry !== 0) mesh.rotation.y = ry
    const pivotY = charDesc.terrainPivotYOffset ?? PLAYER_CAPSULE_HALF_HEIGHT
    return { object: mesh, terrainYOffset: pivotY }
  }

  // ─── Lights ───────────────────────────────────────────────────────────────────

  // ─── Heightmap pre-loading ────────────────────────────────────────────────────

  private static async loadHeightmaps(
    terrain: TerrainDescriptor,
    radius: number,
    resolvePublicUrl: ResolvePublicUrl,
  ): Promise<HeightmapData[]> {
    const features = terrain.features ?? []
    const diameter = radius * 2

    const loads = features
      .filter((f) => f.type === 'heightmap')
      .map((f) =>
        loadHeightmap(f as import('./SceneDescriptor').HeightmapFeature, diameter, resolvePublicUrl),
      )

    return Promise.all(loads)
  }

  // ─── Object placement ─────────────────────────────────────────────────────────

  /**
   * Iterates the objects array and dispatches each entry to the appropriate placer.
   * GLTF loads run in parallel via Promise.all for fast scene build.
   * Returns the [x, z] pairs of every GltfObject that loaded without error.
   */
  private static async placeObjects(
    ctx: ThreeContext,
    objects: SceneObject[],
    sampler: TerrainSampler,
    terrainRadius: number,
    seaLevel: number,
    scatterRoot: THREE.Group,
    resolvePublicUrl: ResolvePublicUrl,
    embeddedGltfMixers: THREE.AnimationMixer[],
  ): Promise<ReadonlyArray<readonly [number, number]>> {
    const gltfObjects: GltfObject[] = []
    const gltfTasks: Promise<boolean>[] = []

    for (const obj of objects) {
      if (obj.type === 'scatter') {
        SceneBuilder.placeScatter(scatterRoot, obj as ScatterField, sampler, terrainRadius, seaLevel)
      } else if (obj.type === 'gltf') {
        const gltfObj = obj as GltfObject
        gltfObjects.push(gltfObj)
        gltfTasks.push(
          SceneBuilder.placeGltf(
            ctx,
            gltfObj,
            sampler,
            seaLevel,
            resolvePublicUrl,
            embeddedGltfMixers,
          ),
        )
      } else {
        SceneBuilder.placeExplicit(ctx.scene, obj as PlacedObject, sampler, seaLevel)
      }
    }

    const results = await Promise.all(gltfTasks)
    return gltfObjects
      .filter((_, i) => results[i])
      .map((o) => [o.x, o.z] as const)
  }

  /**
   * Removes and re-fills all scatter meshes under `scatterRoot` from the given fields.
   * Used by the scene editor when seed/count/radii/etc. change.
   */
  static rebuildScatter(
    scatterRoot: THREE.Group,
    fields: ScatterField[],
    sampler: TerrainSampler,
    terrainRadius: number,
    seaLevel: number,
  ): void {
    while (scatterRoot.children.length > 0) {
      const c = scatterRoot.children[0]!
      scatterRoot.remove(c)
      SceneBuilder.disposeObject3D(c)
    }
    for (const f of fields) {
      SceneBuilder.placeScatter(scatterRoot, f, sampler, terrainRadius, seaLevel)
    }
  }

  private static disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of mats) {
          if (m && typeof (m as THREE.Material).dispose === 'function') {
            ;(m as THREE.Material).dispose()
          }
        }
      }
    })
  }

  /** Places a single explicitly-positioned primitive. */
  private static placeExplicit(
    scene: THREE.Scene,
    obj: PlacedObject,
    sampler: TerrainSampler,
    seaLevel: number,
  ): void {
    const terrainY = sampler.sample(obj.x, obj.z)
    if (terrainY < seaLevel) return

    const scale  = obj.scale     ?? 1
    const offset = PRIMITIVE_BASE_OFFSETS[obj.type as PrimitiveType] ?? 0
    const mesh   = PrimitiveFactory.build(obj.type as PrimitiveType, scale, Math.random)
    mesh.position.set(obj.x, terrainY + offset * scale, obj.z)
    mesh.rotation.y = obj.rotationY ?? 0
    scene.add(mesh)
  }

  /**
   * Loads a GLTF/GLB model and places it at the given world position.
   * On load failure, drops a red wireframe box as a visible error indicator.
   * Returns true if the model was placed successfully, false on skip or error.
   */
  private static async placeGltf(
    ctx: ThreeContext,
    obj: GltfObject,
    sampler: TerrainSampler,
    seaLevel: number,
    resolvePublicUrl: ResolvePublicUrl,
    embeddedGltfMixers: THREE.AnimationMixer[],
  ): Promise<boolean> {
    const terrainY = sampler.sample(obj.x, obj.z)
    const useExplicitY = obj.y !== undefined
    const placeY = useExplicitY ? obj.y! : terrainY

    if (!useExplicitY && terrainY < seaLevel && !obj.allowBelowSeaLevel) {
      console.warn(
        `[SceneBuilder] GLTF skipped (terrain below seaLevel=${seaLevel}) at x=${obj.x} z=${obj.z} → y=${terrainY.toFixed(2)} — move the object or raise seaLevel.`,
      )
      return false
    }

    const scale = obj.scale ?? 1

    try {
      const gltf  = await ctx.assets.loadGLTF(resolvePublicUrl(obj.url))
      // SkeletonUtils.clone properly rebinds SkinnedMesh bone references on the cloned
      // hierarchy. gltf.scene.clone(true) leaves SkinnedMesh pointing at the original
      // bones, causing AnimationMixer to animate them while the visible clone stays in T-pose.
      const model = cloneSkinnedRoot(gltf.scene)
      convertUnlitToPbrRough(model)
      model.scale.setScalar(scale)
      model.rotation.y  = obj.rotationY ?? 0
      model.position.set(obj.x, placeY, obj.z)
      attachEmbeddedGltfAnimations(model, gltf.animations, obj, embeddedGltfMixers)
      if (isViteDev() && obj.playEmbeddedAnimations && (!gltf.animations || gltf.animations.length === 0)) {
        console.warn('[SceneBuilder] playEmbeddedAnimations ignored — no clips in GLB:', obj.url)
      }

      // ── External animation packs (NPC shared packs) ───────────────────────
      // Mirrors the character `animationClipUrls` path: loads each pack GLB,
      // retargets clips to the model's SkinnedMesh skeleton, creates a mixer,
      // and starts a looping action. `embeddedGltfMixers` drives the tick.
      if (obj.animationPackUrls?.length) {
        const skinnedTarget = largestSkinnedMesh(model)
        if (skinnedTarget) {
          const packClips: THREE.AnimationClip[] = []
          await Promise.all(
            obj.animationPackUrls.map(async (packUrl) => {
              const u = packUrl.trim()
              if (!u) return
              try {
                const pack = await SceneBuilder.loadModelWithAnimations(ctx, u, resolvePublicUrl)
                packClips.push(...retargetMixamoClipsToCharacter(skinnedTarget, pack.rootScene, pack.animations))
              } catch (err) {
                console.warn('[SceneBuilder] NPC animation pack failed:', u, err)
              }
            }),
          )
          if (packClips.length) {
            const sanitized = sanitizeMixamoClips(packClips)
            model.userData['gltfAnimations'] = sanitized
            const mixer  = new THREE.AnimationMixer(model)
            const clip   = pickEmbeddedGltfLoopClip(sanitized, obj.loopClipNameContains)
            if (clip) {
              mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play()
            }
            embeddedGltfMixers.push(mixer)
          }
        } else if (isViteDev()) {
          console.warn('[SceneBuilder] animationPackUrls ignored — no SkinnedMesh found in:', obj.url)
        }
      }

      ctx.scene.add(model)
      return true
    } catch (err) {
      // Typical causes: 404 (missing scene.bin / textures next to a .gltf), wrong path
      // (use `/models/foo.glb` from /public), or terrain sample below seaLevel (skipped above).
      console.warn(`[SceneBuilder] GLTF load failed: ${obj.url}`, err)
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshStandardMaterial({ color: 0xff2222, wireframe: true }),
      )
      box.position.set(obj.x, placeY + 1, obj.z)
      ctx.scene.add(box)
      return false
    }
  }

  /**
   * Scatters `field.count` instances within a donut zone.
   *
   * Distribution:
   *   - Uniform area distribution: √(u * (outerR² − innerR²) + innerR²)
   *     ensures density is even across the annulus, not clustered at the centre.
   *   - Seeded PRNG guarantees identical layouts across reloads.
   *   - Placement is retried (up to count×10 attempts) when a candidate lands
   *     outside the terrain disc or below sea level.
   *   - Scale and rotation are also seeded so each instance is deterministic.
   */
  private static placeScatter(
    parent: THREE.Object3D,
    field: ScatterField,
    sampler: TerrainSampler,
    terrainRadius: number,
    seaLevel: number,
  ): void {
    const rng      = createSeeder(field.seed ?? 0)
    const cx       = field.centerX    ?? 0
    const cz       = field.centerZ    ?? 0
    const innerR   = field.innerRadius ?? 0
    const outerR   = field.outerRadius
    const scaleMin = field.scaleMin   ?? 0.75
    const scaleMax = field.scaleMax   ?? 1.25
    const discR2   = (terrainRadius - 2) * (terrainRadius - 2)
    const outerR2  = outerR  * outerR
    const innerR2  = innerR  * innerR

    let placed   = 0
    let attempts = 0
    const maxAttempts = field.count * 10

    while (placed < field.count && attempts < maxAttempts) {
      attempts++

      // Uniform area distribution within the annulus
      const angle = rng() * 2 * Math.PI
      const r     = Math.sqrt(rng() * (outerR2 - innerR2) + innerR2)
      const x     = cx + Math.cos(angle) * r
      const z     = cz + Math.sin(angle) * r

      // Reject if outside the playable terrain disc
      if (x * x + z * z > discR2) continue

      const terrainY = sampler.sample(x, z)

      // Skip submerged positions (lakes, ocean floor)
      if (terrainY < seaLevel) continue

      const scale  = scaleMin + rng() * (scaleMax - scaleMin)
      const rotY   = rng() * Math.PI * 2
      const offset = PRIMITIVE_BASE_OFFSETS[field.primitive] ?? 0

      const obj = PrimitiveFactory.build(field.primitive, scale, rng)
      obj.position.set(x, terrainY + offset * scale, z)
      obj.rotation.y = rotY
      parent.add(obj)
      placed++
    }
  }

  // ─── Lights ───────────────────────────────────────────────────────────────────

  private static addLight(scene: THREE.Scene, l: LightDescriptor): void {
    const color     = l.color     ?? 0xffffff
    const intensity = l.intensity ?? 1.0
    const pos       = l.position

    let light: THREE.Light
    if (l.type === 'directional') {
      light = new THREE.DirectionalLight(color, intensity)
    } else {
      light = new THREE.PointLight(color, intensity)
    }

    light.position.set(pos[0], pos[1], pos[2])
    scene.add(light)
  }
}
