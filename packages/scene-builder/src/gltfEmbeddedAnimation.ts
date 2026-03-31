import * as THREE from 'three'
import { sanitizeMixamoClips } from '@base/player-three'

/**
 * Options for scene `gltf` objects that ship **embedded** {@link THREE.AnimationClip}s
 * (same file as the skinned mesh). Distinct from {@link CharacterDescriptor.animationClipUrls},
 * which merges **external** clips onto the player.
 */
export type GltfEmbeddedAnimationOptions = {
  /**
   * When true and the file contains at least one clip, creates an {@link THREE.AnimationMixer}
   * on this instance and starts a looping action. Host must call {@link THREE.AnimationMixer.update}
   * each frame (SceneBuilder registers one system; editor merges into its frame loop).
   */
  playEmbeddedAnimations?: boolean
  /**
   * Case-insensitive substring match on clip **name**; first hit loops.
   * When omitted, the **first** clip in the glTF `animations` array is used.
   */
  loopClipNameContains?: string
}

/**
 * Pick which clip to loop for an embedded-animation prop.
 */
export function pickEmbeddedGltfLoopClip(
  clips: readonly THREE.AnimationClip[],
  loopClipNameContains?: string,
): THREE.AnimationClip | undefined {
  if (!clips.length) return undefined
  const needle = loopClipNameContains?.trim().toLowerCase()
  if (!needle) return clips[0]
  return clips.find((c) => c.name.toLowerCase().includes(needle)) ?? clips[0]
}

/**
 * Stores sanitized clips on `model.userData.gltfAnimations`, creates a mixer, starts a loop,
 * and appends the mixer to `mixerSink` for the host to drive with `mixer.update(delta)`.
 */
export function attachEmbeddedGltfAnimations(
  model: THREE.Object3D,
  rawClips: readonly THREE.AnimationClip[] | undefined,
  opts: GltfEmbeddedAnimationOptions,
  mixerSink: THREE.AnimationMixer[],
): void {
  if (!opts.playEmbeddedAnimations || !rawClips?.length) return
  const clips = sanitizeMixamoClips([...rawClips])
  model.userData['gltfAnimations'] = clips
  const mixer = new THREE.AnimationMixer(model)
  const clip = pickEmbeddedGltfLoopClip(clips, opts.loopClipNameContains)
  if (!clip) return
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopRepeat, Infinity)
  action.play()
  mixerSink.push(mixer)
}
