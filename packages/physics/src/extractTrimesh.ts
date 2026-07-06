import * as THREE from 'three'

/**
 * Walk a THREE.Object3D tree, extract all static mesh geometry (skipping
 * SkinnedMesh), apply each node's world transform, and return a single merged
 * trimesh suitable for Rapier's ColliderDesc.trimesh().
 *
 * Call root.updateWorldMatrix(true, true) before passing if the object was
 * just loaded and hasn't been added to a scene yet.
 *
 * @param filter - optional predicate; return false to exclude a mesh from the trimesh.
 *   Use this to strip rig-visualization helpers (e.g. smd_bone_vis) from OWLib exports
 *   before registering with Rapier.
 */
export function extractTrimesh(
  root: THREE.Object3D,
  filter?: (mesh: THREE.Mesh) => boolean,
): {
  vertices: Float32Array
  indices: Uint32Array
} {
  const allVerts: number[] = []
  const allIndices: number[] = []

  root.updateWorldMatrix(true, true)

  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh) return
    if (filter && !filter(child)) return

    const geo = child.geometry as THREE.BufferGeometry
    const posAttr = geo.attributes.position
    if (!posAttr) return

    const base = allVerts.length / 3
    const mat = child.matrixWorld
    const v = new THREE.Vector3()

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mat)
      allVerts.push(v.x, v.y, v.z)
    }

    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        allIndices.push(base + geo.index.getX(i))
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        allIndices.push(base + i)
      }
    }
  })

  if (allIndices.length === 0) {
    throw new Error('[extractTrimesh] no renderable mesh geometry found in scene root')
  }

  return {
    vertices: new Float32Array(allVerts),
    indices: new Uint32Array(allIndices),
  }
}
