import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIP_MAP_FILE = path.join(PACKAGE_ROOT, 'src', 'mixamoFbxClipUrls.ts')
const ASSETS_ROOT = path.join(PACKAGE_ROOT, 'assets')

// Heuristic: Mixamo "with skin" exports are usually much larger than animation-only clips.
const SKIN_SUSPECT_SIZE_BYTES = 5 * 1024 * 1024

function getClipPathsFromMapFile(sourceText) {
  const matches = [...sourceText.matchAll(/'([^']+\.fbx)'/g)]
  return matches.map((m) => m[1])
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  if (!fs.existsSync(CLIP_MAP_FILE)) {
    console.error(`Missing clip map file: ${CLIP_MAP_FILE}`)
    process.exit(1)
  }

  const sourceText = fs.readFileSync(CLIP_MAP_FILE, 'utf8')
  const clipPaths = getClipPathsFromMapFile(sourceText)

  if (clipPaths.length === 0) {
    console.error('No .fbx paths found in mixamoFbxClipUrls.ts')
    process.exit(1)
  }

  const missing = []
  const suspects = []

  for (const relPath of clipPaths) {
    const absPath = path.join(ASSETS_ROOT, relPath)
    if (!fs.existsSync(absPath)) {
      missing.push(relPath)
      continue
    }

    const stat = fs.statSync(absPath)
    if (stat.size >= SKIN_SUSPECT_SIZE_BYTES) {
      suspects.push({ relPath, size: stat.size })
    }
  }

  if (missing.length > 0) {
    console.error('Missing FBX files referenced by MIXAMO_FBX_CLIP_URLS:')
    for (const relPath of missing) console.error(`  - ${relPath}`)
    process.exit(1)
  }

  if (suspects.length > 0) {
    console.error(
      `Likely "with skin" clip exports detected (>= ${formatMB(SKIN_SUSPECT_SIZE_BYTES)}):`,
    )
    for (const s of suspects) {
      console.error(`  - ${s.relPath} (${formatMB(s.size)})`)
    }
    console.error(
      'Recommendation: re-export these clips from Mixamo as "Without Skin" before adding them to MIXAMO_FBX_CLIP_URLS.',
    )
    process.exit(2)
  }

  console.log(`OK: validated ${clipPaths.length} clip paths; no missing files; no skin-sized suspects.`)
}

main()
