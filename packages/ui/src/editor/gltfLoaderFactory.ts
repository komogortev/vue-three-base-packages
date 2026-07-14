import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { localDracoDecoderPath, resetDracoLoaderOnInitFailure } from '@base/threejs-engine'

/**
 * One DRACOLoader per page — it owns a WASM worker pool; per-load instances leak.
 * Self-hosted from the app's `public/draco/gltf/` (see {@link localDracoDecoderPath}),
 * so editor GLB loads no longer depend on gstatic.com and work offline.
 *
 * three's DRACOLoader caches its decoder-init promise without reset-on-rejection,
 * so a Draco load attempted while the decoder is unreachable poisons the singleton
 * until reload. {@link resetDracoLoaderOnInitFailure} disposes the poisoned loader
 * so the next {@link createEditorGltfLoader} rebuilds a fresh one.
 */
let dracoLoader: DRACOLoader | null = null

function ensureDracoLoader(): DRACOLoader {
  if (dracoLoader) return dracoLoader
  const loader = new DRACOLoader()
  loader.setDecoderPath(localDracoDecoderPath())
  // Trigger decoder init now so a failed fetch is observable, then discard the
  // poisoned singleton on rejection — the next call rebuilds from scratch.
  loader.preload()
  resetDracoLoaderOnInitFailure(loader, () => {
    if (dracoLoader === loader) {
      loader.dispose()
      dracoLoader = null
    }
  })
  dracoLoader = loader
  return loader
}

/**
 * GLTFLoader wired with Draco + Meshopt decoders. Every editor load path
 * must use this instead of `new GLTFLoader()` — plain loaders reject any GLB
 * with `extensionsRequired: EXT_meshopt_compression / KHR_draco_mesh_compression`,
 * which includes the platform's own optimized character assets
 * (e.g. three-dreams `npc-*.glb`, decimated dfist).
 */
export function createEditorGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  loader.setDRACOLoader(ensureDracoLoader())
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}
