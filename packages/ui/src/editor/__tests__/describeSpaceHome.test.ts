/**
 * PP-2 known positive: the space-home seed scene, described.
 *
 * The expected strings below were derived by hand from `roomMeshGen.ts` geometry,
 * not from running the code:
 * - floor slab 10 × 0.05 × 10, top at y=0 → y ∈ [-0.05, 0];
 * - glass wall: outer arc peak = ¼·0.06 + ½·3.26 + ¼·0.06 = 1.66 m outward (−Z), placed at z=−5;
 * - walls 10 × 3 × 0.1, centred on z; east/west turned ±90° so thickness lies on X;
 * - vault: outer arc peak = ¼·0.12 + ½·5.24 + ¼·0.12 = 2.68, at y=3 → [3, 5.68], z ∈ [−5, 5];
 * - rib: y ∈ [−0.18, 2.5] at y=3 → [2.82, 5.5]; 0.35 m deep centred → ±0.175, which the
 *   outward rounding turns into ±0.18 around each rib's z.
 *
 * Runs through the real placed registry (hit boxes excluded from bounds), so the
 * reader path is the one the editor uses.
 */
import { describe, it, expect } from 'vitest'
import { createPlacedRegistry } from '../placement/placedRegistry'
import { readSceneDescription, describeAssets } from '../describe/readScene'
import { toPromptJson } from '../describe/sceneDescription'
import { createAssetBoundsCache } from '../describe/assetBoundsCache'
import { SPACE_HOME_ASSETS, SPACE_HOME_PLACED, loadSpaceHomeGltf } from './spaceHomeFixture'

const EXPECTED_SCENE = '{"v":1,"units":"m,deg","objects":[' + [
  '{"id":"placed-floor","kind":"environment","label":"floor","asset":"asset-floor","pos":[0,0,0],"yaw":0,"scale":1,"bounds":[[-5,-0.05,-5],[5,0,5]]}',
  '{"id":"placed-wn","kind":"environment","label":"wall-north","asset":"asset-glass","pos":[0,0,-5],"yaw":0,"scale":1,"bounds":[[-5,0,-6.66],[5,3,-5]]}',
  '{"id":"placed-ws","kind":"environment","label":"wall-south","asset":"asset-wall-s","pos":[0,0,5],"yaw":180,"scale":1,"bounds":[[-5,0,4.95],[5,3,5.05]]}',
  '{"id":"placed-we","kind":"environment","label":"wall-east","asset":"asset-wall-ew","pos":[5,0,0],"yaw":90,"scale":1,"bounds":[[4.95,0,-5],[5.05,3,5]]}',
  '{"id":"placed-ww","kind":"environment","label":"wall-west","asset":"asset-wall-ew","pos":[-5,0,0],"yaw":-90,"scale":1,"bounds":[[-5.05,0,-5],[-4.95,3,5]]}',
  '{"id":"placed-vault","kind":"environment","label":"vault","asset":"asset-vault","pos":[0,3,-5],"yaw":0,"scale":1,"bounds":[[-5,3,-5],[5,5.68,5]]}',
  '{"id":"placed-rn","kind":"environment","label":"rib-north","asset":"asset-rib","pos":[0,3,-2.5],"yaw":0,"scale":1,"bounds":[[-5,2.82,-2.68],[5,5.5,-2.32]]}',
  '{"id":"placed-rc","kind":"environment","label":"rib-center","asset":"asset-rib","pos":[0,3,0],"yaw":0,"scale":1,"bounds":[[-5,2.82,-0.18],[5,5.5,0.18]]}',
  '{"id":"placed-rs","kind":"environment","label":"rib-south","asset":"asset-rib","pos":[0,3,2.5],"yaw":0,"scale":1,"bounds":[[-5,2.82,2.32],[5,5.5,2.68]]}',
].join(',') + ']}'

// Sorted by name, then id (the two wall assets share a name).
const EXPECTED_ASSETS = '{"v":1,"units":"m","assets":[' + [
  '{"id":"asset-floor","name":"space-home-floor.glb","kind":"environment","bounds":[[-5,-0.05,-5],[5,0,5]]}',
  '{"id":"asset-glass","name":"space-home-glass-wall-10x3.glb","kind":"environment","bounds":[[-5,0,-1.66],[5,3,0]]}',
  '{"id":"asset-rib","name":"space-home-rib-10x2.5.glb","kind":"environment","bounds":[[-5,-0.18,-0.18],[5,2.5,0.18]]}',
  '{"id":"asset-vault","name":"space-home-vault-10x10x2.5.glb","kind":"environment","bounds":[[-5,0,0],[5,2.68,10]]}',
  '{"id":"asset-wall-ew","name":"space-home-wall-10x3.glb","kind":"environment","bounds":[[-5,0,-0.05],[5,3,0.05]]}',
  '{"id":"asset-wall-s","name":"space-home-wall-10x3.glb","kind":"environment","bounds":[[-5,0,-0.05],[5,3,0.05]]}',
].join(',') + ']}'

async function seededRegistry() {
  const reg = createPlacedRegistry({ loadGltf: loadSpaceHomeGltf })
  const ok = await reg.restore(SPACE_HOME_PLACED.map(record => ({ record, blobUrl: `blob:${record.assetId}` })))
  expect(ok).toBe(true)
  return reg
}

const kindOf = (id: string) => SPACE_HOME_ASSETS.find(a => a.id === id)?.kind

describe('PP-2 describeScene on the space-home seed (known positive)', () => {
  it('gives the hand-derived description, byte for byte', async () => {
    const reg = await seededRegistry()
    const json = toPromptJson(readSceneDescription({ placed: reg, assetKind: kindOf }))
    expect(json).toBe(EXPECTED_SCENE)
  })

  it('is deterministic: a second read of the same scene gives the same bytes', async () => {
    const reg = await seededRegistry()
    const a = toPromptJson(readSceneDescription({ placed: reg, assetKind: kindOf }))
    const b = toPromptJson(readSceneDescription({ placed: reg, assetKind: kindOf }))
    expect(b).toBe(a)
  })

  it('follows a live move: bounds come from the scene, not the saved record', async () => {
    const reg = await seededRegistry()
    const t = reg.transformOf('placed-floor')!
    reg.setTransform('placed-floor', { ...t, position: { x: 1, y: 0, z: 0 } })
    const d = readSceneDescription({ placed: reg, assetKind: kindOf })
    const floor = d.objects.find(o => o.id === 'placed-floor')!
    expect(floor.pos).toEqual([1, 0, 0])
    expect(floor.bounds).toEqual([[-4, -0.05, -5], [6, 0, 5]])
  })
})

describe('PP-2 listAssets on the space-home seed (known positive)', () => {
  it('gives the hand-derived catalog, byte for byte', async () => {
    const cache = createAssetBoundsCache({
      loadGltf: loadSpaceHomeGltf,
      urlFor: a => `blob:${a.id}`,
    })
    const json = toPromptJson(await describeAssets(SPACE_HOME_ASSETS, cache))
    expect(json).toBe(EXPECTED_ASSETS)
  })
})
