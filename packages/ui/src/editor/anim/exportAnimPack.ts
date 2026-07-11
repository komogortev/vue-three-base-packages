import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { nanoid } from 'nanoid'
import type { AssetRow } from '../assetDb'

/**
 * Export a recorded clip as a self-contained animation-pack GLB (OD-1: the
 * pose mesh + skeleton ride along so the clip's `${bone}.quaternion` tracks
 * have real target nodes — the shape the S5-a spike proved round-trips
 * byte-identical through GLTFExporter → GLTFLoader).
 *
 * The exporter writes uncompressed (spike datum: 1.5 MB meshopt source →
 * ~5 MB pack). Acceptable in Dexie; re-compression is a future option.
 */
export function exportAnimationGlb(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (buf) => resolve(new Blob([buf as ArrayBuffer], { type: 'model/gltf-binary' })),
      reject,
      { binary: true, animations: [clip] },
    )
  })
}

/**
 * Assemble the Dexie `assets` row for an exported pack. Kind is explicitly
 * `'animation-pack'` — the upload-path heuristics would classify a skinned
 * GLB with clips as `'character'`, which is not what a recorded pack is for.
 */
export function buildAnimPackRow(clipName: string, blob: Blob, thumbnail?: Blob): AssetRow {
  // Path separators in a display name read as archive paths downstream — strip.
  const safeName = clipName.replace(/[/\\]/g, '_')
  return {
    id: `asset-${nanoid()}`,
    name: `${safeName}.glb`,
    kind: 'animation-pack',
    size: blob.size,
    contentType: 'model/gltf-binary',
    blob,
    clipNames: [clipName],
    thumbnail,
    createdAt: new Date().toISOString(),
  }
}
