/**
 * The space-home seed scene, rebuilt in memory for tests.
 *
 * Mirrors `threejs-engine-dev/src/utils/roomMeshGen.ts` (geometry) and
 * `seedSpaceHome.ts` (layout) at their defaults: a 10 × 10 × 3 m room, vault rise
 * 2.5 m. Only the geometry is copied — no materials, no GLB export — because bounds
 * depend on geometry alone. Ids are fixed (the seed's are random) so the expected
 * description can be written out by hand.
 */
import * as THREE from 'three'
import type { EditorPlacedObject } from '../sceneEditorTypes'

const W = 10, D = 10, H = 3, RISE = 2.5

function sceneOf(geo: THREE.BufferGeometry): THREE.Object3D {
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()))
  return scene
}

function floor(): THREE.BufferGeometry {
  const t = 0.05
  const geo = new THREE.BoxGeometry(W, t, D)
  geo.translate(0, -t / 2, 0)
  return geo
}

function wall(width: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(width, H, 0.1)
  geo.translate(0, H / 2, 0)
  return geo
}

function glassWall(): THREE.BufferGeometry {
  const half = W / 2, bow = 1.6, t = 0.06
  const shape = new THREE.Shape()
  shape.moveTo(-half, 0)
  shape.quadraticCurveTo(0, 2 * bow, half, 0)
  shape.lineTo(half, t)
  shape.quadraticCurveTo(0, 2 * bow + t, -half, t)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  return geo
}

function vault(): THREE.BufferGeometry {
  const halfW = W / 2, t = 0.12
  const shape = new THREE.Shape()
  shape.moveTo(-halfW, 0)
  shape.quadraticCurveTo(0, 2 * RISE, halfW, 0)
  shape.lineTo(halfW, t)
  shape.quadraticCurveTo(0, 2 * (RISE + t), -halfW, t)
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false })
}

function rib(): THREE.BufferGeometry {
  const halfW = W / 2, t = 0.18, ribW = 0.35
  const shape = new THREE.Shape()
  shape.moveTo(-halfW, 0)
  shape.quadraticCurveTo(0, 2 * RISE, halfW, 0)
  shape.lineTo(halfW, -t)
  shape.quadraticCurveTo(0, 2 * (RISE - t), -halfW, -t)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: ribW, bevelEnabled: false })
  geo.translate(0, 0, -ribW / 2)
  return geo
}

/** Asset rows as the seed uploads them (names from roomMeshGen, kind 'environment'). */
export const SPACE_HOME_ASSETS = [
  { id: 'asset-floor', name: 'space-home-floor.glb', geo: floor },
  { id: 'asset-glass', name: 'space-home-glass-wall-10x3.glb', geo: glassWall },
  { id: 'asset-wall-s', name: 'space-home-wall-10x3.glb', geo: () => wall(W) },
  { id: 'asset-wall-ew', name: 'space-home-wall-10x3.glb', geo: () => wall(D) },
  { id: 'asset-vault', name: 'space-home-vault-10x10x2.5.glb', geo: vault },
  { id: 'asset-rib', name: 'space-home-rib-10x2.5.glb', geo: rib },
].map(a => ({ ...a, kind: 'environment' as const, size: 1000, clipNames: undefined as string[] | undefined }))

/** A loader for the registry: the url is `blob:<assetId>`. */
export async function loadSpaceHomeGltf(url: string): Promise<{ scene: THREE.Object3D }> {
  const asset = SPACE_HOME_ASSETS.find(a => `blob:${a.id}` === url)
  if (!asset) throw new Error(`unknown asset url ${url}`)
  return { scene: sceneOf(asset.geo()) }
}

function placed(id: string, assetId: string, label: string, x: number, y: number, z: number, rotY = 0): EditorPlacedObject {
  return {
    id, assetId, label, x, y, z,
    rotationX: 0, rotationY: rotY, rotationZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
  }
}

const P = Math.PI, hw = W / 2, hd = D / 2

/** The seed's nine placed objects, in seed order. */
export const SPACE_HOME_PLACED: EditorPlacedObject[] = [
  placed('placed-floor', 'asset-floor', 'floor', 0, 0, 0),
  placed('placed-wn', 'asset-glass', 'wall-north', 0, 0, -hd),
  placed('placed-ws', 'asset-wall-s', 'wall-south', 0, 0, hd, P),
  placed('placed-we', 'asset-wall-ew', 'wall-east', hw, 0, 0, P / 2),
  placed('placed-ww', 'asset-wall-ew', 'wall-west', -hw, 0, 0, -P / 2),
  placed('placed-vault', 'asset-vault', 'vault', 0, H, -hd),
  placed('placed-rn', 'asset-rib', 'rib-north', 0, H, -hd / 2),
  placed('placed-rc', 'asset-rib', 'rib-center', 0, H, 0),
  placed('placed-rs', 'asset-rib', 'rib-south', 0, H, hd / 2),
]
