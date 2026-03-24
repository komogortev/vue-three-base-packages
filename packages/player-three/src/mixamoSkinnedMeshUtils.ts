import * as THREE from 'three'

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) out.push(o)
  })
  return out
}

function vertexCount(mesh: THREE.SkinnedMesh): number {
  return mesh.geometry?.attributes?.position?.count ?? 0
}

/**
 * Pick the **main** body mesh. Vertex count alone is wrong: boots/legs are often
 * higher-poly than a simple torso shell, so we score bbox volume + height + name hints.
 */
function primaryFitness(sm: THREE.SkinnedMesh): number {
  const g = sm.geometry
  if (!g) return -1
  if (!g.boundingBox) g.computeBoundingBox()
  const b = g.boundingBox
  if (!b || b.isEmpty()) return -1

  const sx = Math.max(b.max.x - b.min.x, 1e-8)
  const sy = Math.max(b.max.y - b.min.y, 1e-8)
  const sz = Math.max(b.max.z - b.min.z, 1e-8)
  const vol = sx * sy * sz
  const footprint = sx * sz

  // Full humanoid: large volume; legs/boots are smaller and sit lower (smaller geometry.max.y in local space).
  let score = vol * (1 + sy / (Math.max(sx, sz) + 1e-6) * 0.15)
  score += footprint * 0.02
  score += b.max.y * 2.5

  const n = sm.name.toLowerCase()
  if (/boot|shoe|sneaker|sock|footwear|glove|glass|teeth|tongue|eyeball|lash|brow/i.test(n)) {
    score *= 0.06
  }
  // Separate leg-only meshes can outscore a low-poly torso; never pick them as the animation root.
  if (/\b(legs?|thighs?|calves?|shins?|knees?)\b/i.test(n)) {
    score *= 0.12
  }
  if (/pants|trouser|leg_|_leg|lower|underwear|belt\b/i.test(n)) {
    score *= 0.35
  }
  if (
    /body|torso|chest|skin|character|remy|mixamo|ch\d\d|outfit|shirt|jacket|coat|dress|mesh|geo/i.test(
      n,
    )
  ) {
    score *= 1.75
  }

  score += vertexCount(sm) * 1e-9
  return score
}

/**
 * Best candidate for Mixamo multi-mesh rigs (body vs boots / accessories).
 */
export function largestSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  const list = skinnedMeshes(root)
  if (list.length === 0) return null
  let best = list[0]!
  let bestScore = primaryFitness(best)
  for (const sm of list) {
    const s = primaryFitness(sm)
    if (s > bestScore) {
      bestScore = s
      best = sm
    }
  }
  return best
}

/**
 * Keep the primary skinned body and remove other `SkinnedMesh`es (duplicate “with skin” anims, etc.).
 */
export function pruneExtraSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh | null {
  const list = skinnedMeshes(root)
  if (list.length <= 1) return list[0] ?? null

  const primary = largestSkinnedMesh(root)!
  for (const sm of list) {
    if (sm === primary) continue
    sm.parent?.remove(sm)
    sm.geometry?.dispose()
    // Materials are often shared with the primary mesh on Mixamo exports — do not dispose().
  }
  return primary
}
