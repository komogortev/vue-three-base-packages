import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { nanoid } from 'nanoid'
import type { AssetRow } from '../assetDb'

/**
 * Export one or more clips as a self-contained animation-pack GLB (OD-1: the
 * pose mesh + skeleton ride along so each clip's `${bone}.quaternion` tracks
 * have real target nodes — the shape the S5-a spike proved round-trips
 * byte-identical through GLTFExporter → GLTFLoader).
 *
 * A single-clip export is a "kit of one"; S5-d append passes the existing pack
 * clips plus the new one so a kit grows in place (GLTFExporter writes every
 * entry of `animations`). The exporter writes uncompressed (spike datum:
 * 1.5 MB meshopt source → ~5 MB pack). Acceptable in Dexie.
 */
export function exportAnimationGlb(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (buf) => resolve(new Blob([buf as ArrayBuffer], { type: 'model/gltf-binary' })),
      reject,
      { binary: true, animations: clips },
    )
  })
}

/**
 * How many of the distinct bones a clip's tracks target actually exist on the
 * given skeleton. A recorded clip's track names are `${boneName}.quaternion`;
 * `PropertyBinding.parseTrackName` recovers the node name robustly (it applies
 * the same sanitisation the mixer uses at bind time).
 *
 * `matched === 0` means the clip was authored on a different skeleton — playing
 * it would bind nothing and animate nothing (the silent-nothing failure S5-c
 * documented). Callers check this *before* playing / appending.
 */
export function resolveClipBones(
  clip: THREE.AnimationClip,
  skeleton: THREE.Skeleton,
): { matched: number; total: number } {
  const bones = new Set<string>()
  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    if (parsed.nodeName) bones.add(parsed.nodeName)
  }
  let matched = 0
  for (const name of bones) {
    if (skeleton.getBoneByName(name)) matched++
  }
  return { matched, total: bones.size }
}

/**
 * Guard for appending `newClip` into a kit whose current clips are `existing`,
 * played against `skeleton` (the target NPC's pose mesh). Rejects when:
 *   - a clip of the same name is already in the kit (OD-E: reject, don't suffix)
 *   - the new clip or any existing clip resolves 0 bones on this skeleton
 *     (OD-F: a kit is bound to one skeleton — mixing characters yields a pack
 *     whose tracks target non-existent nodes).
 */
export function validateKitAppend(
  existing: THREE.AnimationClip[],
  newClip: THREE.AnimationClip,
  skeleton: THREE.Skeleton,
): { ok: true } | { ok: false; reason: string } {
  if (existing.some((c) => c.name === newClip.name)) {
    return { ok: false, reason: `Kit already has a clip named "${newClip.name}"` }
  }
  if (resolveClipBones(newClip, skeleton).matched === 0) {
    return { ok: false, reason: "The recorded clip's bones don't match this character" }
  }
  for (const c of existing) {
    if (resolveClipBones(c, skeleton).matched === 0) {
      return { ok: false, reason: `Kit clip "${c.name}" was built for a different character` }
    }
  }
  return { ok: true }
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
