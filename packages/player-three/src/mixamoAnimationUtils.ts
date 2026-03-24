import * as THREE from 'three'

function trackNodeStem(trackName: string, suffix: string): string {
  if (!trackName.endsWith(suffix)) return ''
  const node = trackName.slice(0, -suffix.length)
  const last = node.split('|').pop() ?? node
  return last.includes(':') ? (last.split(':').pop() ?? last) : last
}

function isRootHipsPositionTrack(trackName: string): boolean {
  if (!trackName.endsWith('.position')) return false
  // RetargetClip output: .bones[mixamorigHips].position
  const bones = /\.bones\[([^\]]+)\]\.position$/.exec(trackName)
  if (bones) {
    const bn = bones[1]
    return /^mixamorigHips$/i.test(bn) || /^hips$/i.test(bn)
  }
  const stem = trackNodeStem(trackName, '.position')
  if (!stem) return false
  return /^mixamorigHips$/i.test(stem) || /^hips$/i.test(stem)
}

/**
 * Mixamo FBX / retargeted clips often animate **root Hips.position** (mocap drift / circles).
 * Stripping it keeps translation on `PlayerController`.
 */
export function stripMixamoHipsPositionTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => !isRootHipsPositionTrack(t.name))
  if (tracks.length === clip.tracks.length) return clip
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

export function sanitizeMixamoClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map(stripMixamoHipsPositionTracks)
}
