import * as THREE from 'three'
import type { Aabb } from './gate/verdict'
import type { GlbLintInput } from './gate/glbLinter'

/**
 * THREE adapter for F-G5 (`lintGlb`) — reads a parsed GLB's root node and
 * produces the plain-number `GlbLintInput` the engine-agnostic linter expects.
 * Mirrors how F-G3's `runPlacementGate` keeps THREE specifics out of `gate/`.
 *
 * Bounds are measured in the root's own local frame: its position/rotation are
 * temporarily zeroed (scale is left as-is, since an un-baked scale should show
 * up in the same measurement the pivot check reads) so a root placed anywhere
 * in a scene graph still reports a pivot-to-geometry offset, not a world one.
 */
export function deriveGlbLintInput(scene: THREE.Object3D, assetId: string): GlbLintInput {
  const rootScale = { x: scene.scale.x, y: scene.scale.y, z: scene.scale.z }

  const origPos = scene.position.clone()
  const origQuat = scene.quaternion.clone()
  scene.position.set(0, 0, 0)
  scene.quaternion.identity()
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  scene.position.copy(origPos)
  scene.quaternion.copy(origQuat)
  scene.updateMatrixWorld(true)

  const localBounds: Aabb = box.isEmpty()
    ? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
    : {
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z },
      }

  return { assetId, rootName: scene.name, rootScale, localBounds }
}
