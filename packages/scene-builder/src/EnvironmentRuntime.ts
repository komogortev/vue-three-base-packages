/**
 * EnvironmentRuntime — time-of-day, sky (physical Preetham or gradient), sun/moon
 * lights, exponential fog sync, optional scrolling cloud layer tied to the same phase.
 *
 * - **Game** (`attachGame`): runs only when `atmosphere.dynamicSky === true`.
 * - **Editor** (`attachEditor`): always; if `dynamicSky` is false, only fog is controllable
 *   (reads initial fog from the scene after SceneBuilder).
 */
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { ThreeContext } from '@base/threejs-engine'
import type {
  AtmosphereDescriptor,
  CloudLayerDescriptor,
  SkyDescriptor,
  SunMoonDescriptor,
  TimeCycleDescriptor,
} from './SceneDescriptor'

const SKY_SCALE = 450000

/** Mutable snapshot for Vue / export (colours as 0xRRGGBB). */
export interface EnvironmentState {
  dynamicSky: boolean
  phase: number
  /** Phase units per real second (0 = static time). */
  phaseSpeed: number
  fogDensity: number
  fogColor: number
  skyModel: 'physical' | 'gradient'
  cloudEnabled: boolean
  cloudOpacity: number
  cloudScrollSpeed: number
  cloudWindX: number
  cloudWindZ: number
  cloudVisibleFrom: number
  cloudVisibleTo: number
  cloudDensityNight: number
  cloudDensityNoon: number
}

function wrapPhase(p: number): number {
  let x = p % 1
  if (x < 0) x += 1
  return x
}

function sunVectorForPhase(phase: number, out: THREE.Vector3): THREE.Vector3 {
  const t = phase * Math.PI * 2
  const elev = Math.asin(Math.max(-1, Math.min(1, -Math.cos(t))))
  const azimuth = t
  const phi = Math.PI / 2 - elev
  return out.setFromSphericalCoords(SKY_SCALE, phi, azimuth)
}

function mergeTime(t?: TimeCycleDescriptor): { phase: number; phaseSpeed: number } {
  return {
    phase:      wrapPhase(t?.initialPhase ?? 0.28),
    phaseSpeed: t?.phaseSpeed ?? 0,
  }
}

function mergeSky(s?: SkyDescriptor): Required<
  Pick<SkyDescriptor, 'model' | 'zenithColor' | 'horizonColor' | 'turbidity' | 'rayleigh' | 'mieCoefficient' | 'mieDirectionalG'>
> {
  return {
    model:           s?.model ?? 'physical',
    zenithColor:     s?.zenithColor ?? 0x4a6fa5,
    horizonColor:    s?.horizonColor ?? 0xc4d4e8,
    turbidity:       s?.turbidity ?? 2,
    rayleigh:        s?.rayleigh ?? 1,
    mieCoefficient:  s?.mieCoefficient ?? 0.005,
    mieDirectionalG: s?.mieDirectionalG ?? 0.8,
  }
}

function mergeSunMoon(s?: SunMoonDescriptor): Required<
  Pick<SunMoonDescriptor, 'sunColor' | 'sunIntensity' | 'moonColor' | 'moonIntensity' | 'moonPhaseOffset' | 'showDiscs'>
> {
  return {
    sunColor:        s?.sunColor ?? 0xfff5e6,
    sunIntensity:    s?.sunIntensity ?? 1.35,
    moonColor:       s?.moonColor ?? 0xb8c8ff,
    moonIntensity:   s?.moonIntensity ?? 0.22,
    moonPhaseOffset: s?.moonPhaseOffset ?? 0.52,
    showDiscs:       s?.showDiscs ?? false,
  }
}

function mergeCloud(c?: CloudLayerDescriptor): Required<CloudLayerDescriptor> {
  return {
    enabled:        c?.enabled ?? true,
    height:         c?.height ?? 120,
    scale:          c?.scale ?? 800,
    windX:          c?.windX ?? 0.35,
    windZ:          c?.windZ ?? 0.12,
    scrollSpeed:    c?.scrollSpeed ?? 0.04,
    opacity:        c?.opacity ?? 0.55,
    visibleFrom:    c?.visibleFrom ?? 0,
    visibleTo:      c?.visibleTo ?? 1,
    densityAtNight: c?.densityAtNight ?? 0.35,
    densityAtNoon:  c?.densityAtNoon ?? 1,
  }
}

export class EnvironmentRuntime {
  private readonly scene: THREE.Scene
  private readonly scratchSun = new THREE.Vector3()
  private readonly sunDir = new THREE.Vector3()
  private readonly moonDir = new THREE.Vector3()

  private phase: number
  private phaseSpeed: number
  private fogColor: number
  private fogDensity: number

  private readonly dynamicSky: boolean
  private readonly fogEditorOnly: boolean

  private skyModel: 'physical' | 'gradient' = 'physical'
  private skyMerge!: ReturnType<typeof mergeSky>
  private sunMoonMerge!: ReturnType<typeof mergeSunMoon>
  private cloudMerge!: ReturnType<typeof mergeCloud>

  private skyPhysical: Sky | null = null
  private skyGradientMesh: THREE.Mesh | null = null
  private sunLight: THREE.DirectionalLight | null = null
  private moonLight: THREE.DirectionalLight | null = null
  private cloudMesh: THREE.Mesh | null = null
  private cloudMat: THREE.ShaderMaterial | null = null

  private constructor(
    scene: THREE.Scene,
    atmo: AtmosphereDescriptor,
    opts: { dynamicSky: boolean; fogEditorOnly: boolean },
  ) {
    this.scene = scene
    this.dynamicSky = opts.dynamicSky
    this.fogEditorOnly = opts.fogEditorOnly

    const tm = mergeTime(atmo.time)
    this.phase      = tm.phase
    this.phaseSpeed = tm.phaseSpeed

    const c0 = Array.isArray(atmo.clouds) ? atmo.clouds[0] : atmo.clouds
    this.cloudMerge = mergeCloud(c0)
    this.skyMerge   = mergeSky(atmo.sky)
    this.skyModel   = this.skyMerge.model === 'gradient' ? 'gradient' : 'physical'
    this.sunMoonMerge = mergeSunMoon(atmo.sunMoon)

    if (this.fogEditorOnly && !this.dynamicSky) {
      if (scene.fog instanceof THREE.FogExp2) {
        this.fogColor   = scene.fog.color.getHex()
        this.fogDensity = scene.fog.density
      } else {
        this.fogColor   = atmo.fogColor ?? 0x080810
        this.fogDensity = atmo.fogDensity ?? 0.012
      }
      return
    }

    this.fogColor   = atmo.fogColor ?? 0x080810
    this.fogDensity = atmo.fogDensity ?? 0.012

    scene.background = null

    if (this.skyModel === 'physical') {
      const sky = new Sky()
      sky.name = 'env-sky-physical'
      sky.scale.setScalar(SKY_SCALE)
      const u = sky.material.uniforms
      u['turbidity'].value        = this.skyMerge.turbidity
      u['rayleigh'].value         = this.skyMerge.rayleigh
      u['mieCoefficient'].value   = this.skyMerge.mieCoefficient
      u['mieDirectionalG'].value  = this.skyMerge.mieDirectionalG
      scene.add(sky)
      this.skyPhysical = sky
    } else {
      const geo = new THREE.SphereGeometry(400, 32, 16)
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith:  { value: new THREE.Color(this.skyMerge.zenithColor) },
          uHorizon: { value: new THREE.Color(this.skyMerge.horizonColor) },
          uSunDir:  { value: new THREE.Vector3(0, 1, 0) },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uSunDir;
          varying vec3 vDir;
          void main() {
            float h = max(0.0, vDir.y);
            vec3 base = mix(uHorizon, uZenith, pow(h, 0.45));
            float glow = pow(max(0.0, dot(normalize(vDir), normalize(uSunDir))), 12.0);
            base += glow * vec3(1.0, 0.92, 0.75) * 0.35;
            gl_FragColor = vec4(base, 1.0);
          }
        `,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.name = 'env-sky-gradient'
      scene.add(mesh)
      this.skyGradientMesh = mesh
    }

    this.sunLight = new THREE.DirectionalLight(this.sunMoonMerge.sunColor, this.sunMoonMerge.sunIntensity)
    this.sunLight.name = 'env-sun'
    this.moonLight = new THREE.DirectionalLight(this.sunMoonMerge.moonColor, this.sunMoonMerge.moonIntensity)
    this.moonLight.name = 'env-moon'
    scene.add(this.sunLight)
    scene.add(this.moonLight)

    if (this.cloudMerge.enabled) {
      this._createCloudLayer()
    }

    this._applyPhaseToLightsAndSky()
  }

  static attachGame(ctx: ThreeContext, atmo: AtmosphereDescriptor): EnvironmentRuntime | null {
    if (atmo.dynamicSky !== true) return null
    return new EnvironmentRuntime(ctx.scene, atmo, { dynamicSky: true, fogEditorOnly: false })
  }

  static attachEditor(ctx: ThreeContext, atmo: AtmosphereDescriptor): EnvironmentRuntime {
    if (atmo.dynamicSky === true) {
      return new EnvironmentRuntime(ctx.scene, atmo, { dynamicSky: true, fogEditorOnly: false })
    }
    return new EnvironmentRuntime(ctx.scene, atmo, { dynamicSky: false, fogEditorOnly: true })
  }

  private _createCloudLayer(): void {
    const geo = new THREE.PlaneGeometry(this.cloudMerge.scale, this.cloudMerge.scale, 1, 1)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime:     { value: 0 },
        uOpacity:  { value: this.cloudMerge.opacity },
        uWind:     { value: new THREE.Vector2(this.cloudMerge.windX, this.cloudMerge.windZ) },
        uPhase:    { value: this.phase },
        uVisFrom:  { value: this.cloudMerge.visibleFrom },
        uVisTo:    { value: this.cloudMerge.visibleTo },
        uDenNight: { value: this.cloudMerge.densityAtNight },
        uDenNoon:  { value: this.cloudMerge.densityAtNoon },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec2 uWind;
        uniform float uPhase;
        uniform float uVisFrom;
        uniform float uVisTo;
        uniform float uDenNight;
        uniform float uDenNoon;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1.0,0.0));
          float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.1;
            a *= 0.5;
          }
          return v;
        }
        void main() {
          float day = uPhase;
          float span = uVisTo - uVisFrom;
          float w = span <= 0.001 ? 1.0 : smoothstep(uVisFrom, uVisFrom + 0.05, day) * (1.0 - smoothstep(uVisTo - 0.05, uVisTo, day));
          float dn = mix(uDenNight, uDenNoon, 0.5 + 0.5 * sin(day * 6.2831853));
          vec2 uv = vUv * 6.0 + uWind * uTime;
          float c = fbm(uv) * 0.65 + fbm(uv * 1.7 + 3.1) * 0.35;
          c = smoothstep(0.35, 0.85, c) * dn;
          float a = c * uOpacity * w;
          gl_FragColor = vec4(vec3(1.0), a);
        }
      `,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'env-cloud-layer'
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = this.cloudMerge.height
    this.scene.add(mesh)
    this.cloudMesh = mesh
    this.cloudMat = mat
  }

  private _applyPhaseToLightsAndSky(): void {
    if (!this.sunLight || !this.moonLight) return

    sunVectorForPhase(this.phase, this.scratchSun)
    this.sunDir.copy(this.scratchSun).normalize()
    sunVectorForPhase(wrapPhase(this.phase + this.sunMoonMerge.moonPhaseOffset), this.scratchSun)
    this.moonDir.copy(this.scratchSun).normalize()

    const sunStr  = Math.max(0, this.sunDir.y)
    const moonStr = Math.max(0, this.moonDir.y)

    // Higher floor when sun is low — keeps subjects readable (with hemisphere + ambient).
    this.sunLight.intensity  = this.sunMoonMerge.sunIntensity * (0.32 + 0.95 * sunStr)
    this.moonLight.intensity = this.sunMoonMerge.moonIntensity * (0.28 + 0.85 * moonStr)

    this.sunLight.position.copy(this.sunDir).multiplyScalar(200)
    this.sunLight.target.position.set(0, 0, 0)
    this.sunLight.target.updateMatrixWorld()

    this.moonLight.position.copy(this.moonDir).multiplyScalar(180)
    this.moonLight.target.position.set(0, 0, 0)
    this.moonLight.target.updateMatrixWorld()

    if (!this.scene.children.includes(this.sunLight.target)) this.scene.add(this.sunLight.target)
    if (!this.scene.children.includes(this.moonLight.target)) this.scene.add(this.moonLight.target)

    if (this.skyPhysical) {
      this.skyPhysical.material.uniforms['sunPosition'].value.copy(this.sunDir).multiplyScalar(SKY_SCALE)
    }
    if (this.skyGradientMesh) {
      const u = (this.skyGradientMesh.material as THREE.ShaderMaterial).uniforms
      u['uSunDir'].value.copy(this.sunDir)
    }

    const fogBlend = THREE.MathUtils.lerp(0.018, this.fogDensity, 0.45 + 0.55 * sunStr)
    const fc = new THREE.Color(this.fogColor)
    fc.lerp(new THREE.Color(0x020308), 1 - sunStr)
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fc)
      this.scene.fog.density = fogBlend
    }
  }

  private _syncFogFlatBackground(): void {
    if (!(this.scene.fog instanceof THREE.FogExp2)) {
      this.scene.fog = new THREE.FogExp2(this.fogColor, this.fogDensity)
    } else {
      this.scene.fog.color.setHex(this.fogColor)
      this.scene.fog.density = this.fogDensity
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(this.fogColor)
    } else if (this.scene.background === null && !this.dynamicSky) {
      this.scene.background = new THREE.Color(this.fogColor)
    }
  }

  update(deltaReal: number): void {
    if (this.fogEditorOnly && !this.dynamicSky) {
      return
    }

    if (this.phaseSpeed !== 0) {
      this.phase = wrapPhase(this.phase + this.phaseSpeed * deltaReal)
    }

    if (this.dynamicSky && this.sunLight) {
      this._applyPhaseToLightsAndSky()
    }

    if (this.cloudMat) {
      this.cloudMat.uniforms['uTime'].value += deltaReal * this.cloudMerge.scrollSpeed * 20
      this.cloudMat.uniforms['uPhase'].value = this.phase
    }
  }

  setPhase(p: number): void {
    this.phase = wrapPhase(p)
    if (this.dynamicSky && this.sunLight) this._applyPhaseToLightsAndSky()
    if (this.cloudMat) this.cloudMat.uniforms['uPhase'].value = this.phase
  }

  setPhaseSpeed(s: number): void {
    this.phaseSpeed = s
  }

  setFogDensity(d: number): void {
    this.fogDensity = Math.max(0, Math.min(0.25, d))
    if (this.fogEditorOnly && !this.dynamicSky) {
      this._syncFogFlatBackground()
    } else if (this.dynamicSky && this.sunLight) {
      this._applyPhaseToLightsAndSky()
    } else {
      this._syncFogFlatBackground()
    }
  }

  setFogColor(hex: number): void {
    this.fogColor = hex >>> 0
    if (this.fogEditorOnly && !this.dynamicSky) {
      this._syncFogFlatBackground()
    } else if (this.dynamicSky && this.sunLight) {
      this._applyPhaseToLightsAndSky()
    } else {
      this._syncFogFlatBackground()
    }
  }

  setCloudOpacity(o: number): void {
    this.cloudMerge.opacity = Math.max(0, Math.min(1, o))
    if (this.cloudMat) this.cloudMat.uniforms['uOpacity'].value = this.cloudMerge.opacity
  }

  setCloudScrollSpeed(s: number): void {
    this.cloudMerge.scrollSpeed = s
  }

  setCloudWind(x: number, z: number): void {
    this.cloudMerge.windX = x
    this.cloudMerge.windZ = z
    if (this.cloudMat) this.cloudMat.uniforms['uWind'].value.set(x, z)
  }

  setCloudVisibilityWindow(fromP: number, toP: number): void {
    this.cloudMerge.visibleFrom = wrapPhase(fromP)
    this.cloudMerge.visibleTo   = wrapPhase(toP)
    if (this.cloudMat) {
      this.cloudMat.uniforms['uVisFrom'].value = this.cloudMerge.visibleFrom
      this.cloudMat.uniforms['uVisTo'].value   = this.cloudMerge.visibleTo
    }
  }

  setCloudDensityCurve(night: number, noon: number): void {
    this.cloudMerge.densityAtNight = Math.max(0, Math.min(2, night))
    this.cloudMerge.densityAtNoon  = Math.max(0, Math.min(2, noon))
    if (this.cloudMat) {
      this.cloudMat.uniforms['uDenNight'].value = this.cloudMerge.densityAtNight
      this.cloudMat.uniforms['uDenNoon'].value  = this.cloudMerge.densityAtNoon
    }
  }

  getState(): EnvironmentState {
    return {
      dynamicSky:        this.dynamicSky,
      phase:               this.phase,
      phaseSpeed:          this.phaseSpeed,
      fogDensity:          this.fogDensity,
      fogColor:            this.fogColor,
      skyModel:            this.skyModel,
      cloudEnabled:        this.cloudMesh !== null,
      cloudOpacity:        this.cloudMerge?.opacity ?? 0,
      cloudScrollSpeed:    this.cloudMerge?.scrollSpeed ?? 0,
      cloudWindX:          this.cloudMerge?.windX ?? 0,
      cloudWindZ:          this.cloudMerge?.windZ ?? 0,
      cloudVisibleFrom:    this.cloudMerge?.visibleFrom ?? 0,
      cloudVisibleTo:      this.cloudMerge?.visibleTo ?? 1,
      cloudDensityNight:   this.cloudMerge?.densityAtNight ?? 0,
      cloudDensityNoon:    this.cloudMerge?.densityAtNoon ?? 1,
    }
  }

  toAtmospherePatch(base: AtmosphereDescriptor): AtmosphereDescriptor {
    const c0 = Array.isArray(base.clouds) ? base.clouds[0] : base.clouds
    return {
      ...base,
      fogColor:   this.fogColor,
      fogDensity: this.fogDensity,
      dynamicSky: this.dynamicSky ? true : base.dynamicSky === true,
      time: {
        ...(base.time ?? {}),
        initialPhase: this.phase,
        phaseSpeed:   this.phaseSpeed,
      },
      sky: {
        ...(base.sky ?? {}),
        model: this.dynamicSky ? this.skyModel : (base.sky?.model ?? 'physical'),
      },
      clouds: {
        ...(c0 ?? {}),
        enabled:        this.cloudMerge?.enabled ?? true,
        opacity:        this.cloudMerge?.opacity ?? 0.55,
        scrollSpeed:    this.cloudMerge?.scrollSpeed ?? 0.04,
        windX:          this.cloudMerge?.windX ?? 0.35,
        windZ:          this.cloudMerge?.windZ ?? 0.12,
        visibleFrom:    this.cloudMerge?.visibleFrom ?? 0,
        visibleTo:      this.cloudMerge?.visibleTo ?? 1,
        densityAtNight: this.cloudMerge?.densityAtNight ?? 0.35,
        densityAtNoon:  this.cloudMerge?.densityAtNoon ?? 1,
      },
    }
  }

  dispose(): void {
    if (this.skyPhysical) {
      this.scene.remove(this.skyPhysical)
      this.skyPhysical.geometry.dispose()
      ;(this.skyPhysical.material as THREE.Material).dispose()
      this.skyPhysical = null
    }
    if (this.skyGradientMesh) {
      this.scene.remove(this.skyGradientMesh)
      this.skyGradientMesh.geometry.dispose()
      ;(this.skyGradientMesh.material as THREE.Material).dispose()
      this.skyGradientMesh = null
    }
    if (this.cloudMesh) {
      this.scene.remove(this.cloudMesh)
      this.cloudMesh.geometry.dispose()
      this.cloudMat?.dispose()
      this.cloudMesh = null
      this.cloudMat = null
    }
    if (this.sunLight) {
      this.scene.remove(this.sunLight.target)
      this.scene.remove(this.sunLight)
      this.sunLight = null
    }
    if (this.moonLight) {
      this.scene.remove(this.moonLight.target)
      this.scene.remove(this.moonLight)
      this.moonLight = null
    }
  }
}
