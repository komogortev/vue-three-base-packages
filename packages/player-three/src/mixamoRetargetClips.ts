import * as THREE from 'three'
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js'
import { largestSkinnedMesh } from './mixamoSkinnedMeshUtils'

/** Mixamo root translate is usually on this bone. */
export function findMixamoHipBoneName(bones: readonly THREE.Bone[]): string {
  const byMixamo = bones.find((b) => /mixamorigHips/i.test(b.name))
  if (byMixamo) return byMixamo.name
  const byLeaf = bones.find((b) => {
    const leaf = b.name.includes(':') ? (b.name.split(':').pop() ?? b.name) : b.name
    return /^hips$/i.test(leaf)
  })
  return byLeaf?.name ?? bones[0]?.name ?? 'mixamorigHips'
}

/**
 * When an animation FBX has no `SkinnedMesh`, retarget cannot run — remap track
 * node names to the target skeleton bone names (same Mixamo rig, different prefix).
 */
export function remapClipTracksToTargetSkeleton(
  clip: THREE.AnimationClip,
  skeleton: THREE.Skeleton,
): THREE.AnimationClip {
  const boneNames = new Set(skeleton.bones.map((b) => b.name))
  const resolve = (nodeName: string): string | null => {
    if (boneNames.has(nodeName)) return nodeName
    const pipe = nodeName.split('|').pop() ?? nodeName
    const leaf = pipe.includes(':') ? (pipe.split(':').pop() ?? pipe) : pipe
    if (boneNames.has(leaf)) return leaf
    const hit = skeleton.bones.find((b) => {
      const bl = b.name.includes(':') ? (b.name.split(':').pop() ?? b.name) : b.name
      return b.name === leaf || bl === leaf || b.name.endsWith(leaf)
    })
    return hit?.name ?? null
  }

  let changed = false
  const newTracks = clip.tracks.map((track) => {
    const dot = track.name.indexOf('.')
    if (dot <= 0) return track
    const node = track.name.slice(0, dot)
    const prop = track.name.slice(dot)
    const mapped = resolve(node)
    if (!mapped || mapped === node) return track
    changed = true
    const Ctor = track.constructor as typeof THREE.KeyframeTrack
    return new Ctor(mapped + prop, track.times, track.values)
  })
  if (!changed) return clip
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks)
}

/**
 * Bakes each clip onto `targetSkinned` so it plays with `AnimationMixer(targetSkinned)`.
 * Uses `SkeletonUtils.retargetClip` when the source file has a skinned mesh; otherwise
 * remaps track node names to the target skeleton.
 *
 * When the rig has several `SkinnedMesh`es, pass the same mesh `primarySkinnedMeshForRig(root)`
 * would return (tag with `userData.animationPrimary` if needed).
 */
export function retargetMixamoClipsToCharacter(
  targetSkinned: THREE.SkinnedMesh,
  sourceScene: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): THREE.AnimationClip[] {
  const hip = findMixamoHipBoneName(targetSkinned.skeleton.bones)
  const sourceSkinned = largestSkinnedMesh(sourceScene)

  return clips.map((clip) => {
    if (clip.tracks.length === 0) return clip
    try {
      if (sourceSkinned) {
        return retargetClip(targetSkinned, sourceSkinned, clip, {
          hip,
          useFirstFramePosition: false,
        })
      }
      return remapClipTracksToTargetSkeleton(clip, targetSkinned.skeleton)
    } catch (err) {
      console.warn('[mixamoRetargetClips] retarget failed, using remap:', clip.name, err)
      try {
        return remapClipTracksToTargetSkeleton(clip, targetSkinned.skeleton)
      } catch {
        return clip
      }
    }
  })
}
