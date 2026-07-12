import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

/**
 * Draco decoder served by Google — matches `@base/threejs-engine`'s
 * `AssetLoader` convention. Required for many Sketchfab / Blender / T-F7
 * `optimize-glb.sh` outputs.
 */
const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

// One DRACOLoader per page — it owns a WASM worker pool; per-load instances leak.
// Known shared flaw (same as AssetLoader): DRACOLoader caches its decoder-init
// promise without reset-on-rejection, so a Draco load attempted while offline
// poisons the singleton until reload. Self-hosting the decoder wasm removes
// both the CDN dependency and this failure mode — tracked as a follow-up.
let dracoLoader: DRACOLoader | null = null

/**
 * GLTFLoader wired with Draco + Meshopt decoders. Every editor load path
 * must use this instead of `new GLTFLoader()` — plain loaders reject any GLB
 * with `extensionsRequired: EXT_meshopt_compression / KHR_draco_mesh_compression`,
 * which includes the platform's own optimized character assets
 * (e.g. three-dreams `npc-*.glb`, decimated dfist).
 */
export function createEditorGltfLoader(): GLTFLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(DRACO_DECODER_URL)
  }
  const loader = new GLTFLoader()
  loader.setDRACOLoader(dracoLoader)
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}
