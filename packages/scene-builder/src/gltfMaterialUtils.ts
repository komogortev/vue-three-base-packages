import * as THREE from 'three'

/**
 * Sketchfab / game rips often use `KHR_materials_unlit` → `MeshBasicMaterial`, which ignores lights.
 * Replace with `MeshStandardMaterial` so sun / ambient / time-of-day affect the character.
 */
export function convertUnlitToPbrRough(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return

    const replaceOne = (m: THREE.Material): THREE.Material => {
      if (m instanceof THREE.MeshBasicMaterial) {
        const std = new THREE.MeshStandardMaterial({
          map: m.map,
          color: m.color,
          roughness: 0.76,
          metalness: 0.08,
          transparent: m.transparent,
          opacity: m.opacity,
          side: m.side,
          depthWrite: m.depthWrite,
          alphaTest: m.alphaTest,
        })
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
        return std
      }
      return m
    }

    if (Array.isArray(o.material)) {
      o.material = o.material.map(replaceOne)
    } else {
      o.material = replaceOne(o.material)
    }
  })
}
