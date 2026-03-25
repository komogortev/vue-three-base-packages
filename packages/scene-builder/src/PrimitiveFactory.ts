import * as THREE from 'three'
import type { PrimitiveType } from './SceneDescriptor'

/**
 * Y offset (in local units, before scale) to add when placing each primitive
 * so its base sits flush with the terrain surface.
 *
 * - rock:    IcosahedronGeometry — centre at 0, we embed 0.2 units for a natural look
 * - tree:    Group pivot is at ground level (y=0), no offset needed
 * - crystal: ConeGeometry(height=2) — pivot at centre, base at y=−1
 * - pillar:  CylinderGeometry(height=3.5) — pivot at centre, base at y=−1.75
 */
export const PRIMITIVE_BASE_OFFSETS: Record<PrimitiveType, number> = {
  rock:    0.3,
  tree:    0.0,
  crystal: 1.0,
  pillar:  1.75,
}

/**
 * PrimitiveFactory — creates stylised Three.js objects for scene population.
 *
 * All methods return THREE.Object3D (either Mesh or Group) scaled to `scale`.
 * Use `build(type, scale, rng)` as the single entry point from SceneBuilder.
 *
 * The `rng` parameter is a seeded random function used for per-vertex rock
 * distortion — passing the scatter seeder ensures fully deterministic output.
 * Other primitives ignore `rng`.
 */
export class PrimitiveFactory {
  static build(type: PrimitiveType, scale: number, rng: () => number): THREE.Object3D {
    switch (type) {
      case 'rock':    return PrimitiveFactory.rock(scale, rng)
      case 'tree':    return PrimitiveFactory.tree(scale)
      case 'crystal': return PrimitiveFactory.crystal(scale)
      case 'pillar':  return PrimitiveFactory.pillar(scale)
    }
  }

  // ─── Rock ───────────────────────────────────────────────────────────────────

  /**
   * Lumpy boulder built from a subdivided icosahedron with per-vertex noise.
   * Noise is drawn from `rng` so scatter fields produce deterministic shapes.
   *
   * Base offset: 0.3 units (rock sits 0.2 units embedded in the ground).
   */
  static rock(scale: number, rng: () => number = Math.random): THREE.Mesh {
    const geo = new THREE.IcosahedronGeometry(0.5, 1)
    const pos = geo.attributes['position'] as THREE.BufferAttribute

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      // Independent XZ and Y noise — rocks are wider than tall on average
      const nXZ = 0.82 + rng() * 0.36
      const nY  = 0.72 + rng() * 0.50
      pos.setXYZ(i, x * nXZ, y * nY, z * nXZ)
    }

    pos.needsUpdate = true
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color:     0x72777f,
      roughness: 0.93,
      metalness: 0.06,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.setScalar(scale)
    return mesh
  }

  // ─── Tree ───────────────────────────────────────────────────────────────────

  /**
   * Stylised cone tree: cylindrical trunk + two stacked cone crowns.
   * Group pivot is at ground level (y = 0). No base offset required.
   */
  static tree(scale: number): THREE.Group {
    const group = new THREE.Group()

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.97, metalness: 0 })
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x1a3a16, roughness: 0.92, metalness: 0 })

    // Trunk
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 1.2, 6), trunkMat)
    trunk.position.y = 0.6
    group.add(trunk)

    // Lower crown
    const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.80, 1.8, 7), crownMat)
    crown1.position.y = 1.80
    group.add(crown1)

    // Upper crown (narrower, slightly overlapping lower)
    const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 7), crownMat)
    crown2.position.y = 2.65
    group.add(crown2)

    group.scale.setScalar(scale)
    return group
  }

  // ─── Crystal ────────────────────────────────────────────────────────────────

  /**
   * Faceted upward-pointing shard with emissive indigo glow.
   * ConeGeometry(height=2): base at y=−1, tip at y=+1. Base offset = 1.0.
   */
  static crystal(scale: number): THREE.Mesh {
    const geo = new THREE.ConeGeometry(0.15, 2.0, 5)

    const mat = new THREE.MeshStandardMaterial({
      color:             0x4f46e5,
      emissive:          0x1e1b7a,
      emissiveIntensity: 0.4,
      roughness:         0.12,
      metalness:         0.75,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.setScalar(scale)
    return mesh
  }

  // ─── Pillar ─────────────────────────────────────────────────────────────────

  /**
   * Stone column / ruin post.
   * CylinderGeometry(height=3.5): base at y=−1.75. Base offset = 1.75.
   */
  static pillar(scale: number): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(0.28, 0.35, 3.5, 8)

    const mat = new THREE.MeshStandardMaterial({
      color:     0x88806e,
      roughness: 0.90,
      metalness: 0.04,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.setScalar(scale)
    return mesh
  }
}
