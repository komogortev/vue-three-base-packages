import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Generate a 256×256 PNG thumbnail for a GLB blob.
 *
 * Synchronous-on-upload by design (Q4 in ASSET-PIPELINE.md). Creates and
 * disposes a WebGLRenderer per call — no persistent renderer kept alive.
 *
 * Throws on parse failure, WebGL context creation failure, or empty scene.
 * Callers in `useAssetStore.upload()` catch and persist the row without a
 * thumbnail; the UI falls back to a "no preview" placeholder.
 */
export async function generateThumbnail(blob: Blob): Promise<Blob> {
  const SIZE = 256
  const arrayBuffer = await blob.arrayBuffer()

  // Off-DOM canvas — universally supported, no OffscreenCanvas required.
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const dir = new THREE.DirectionalLight(0xffffff, 0.9)
  dir.position.set(2, 4, 2)
  scene.add(dir)

  let gltfScene: THREE.Group | null = null
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(arrayBuffer, '')
    gltfScene = gltf.scene
    if (!gltfScene) throw new Error('GLB has no scene')
    scene.add(gltfScene)

    const box = new THREE.Box3().setFromObject(gltfScene)
    if (box.isEmpty()) throw new Error('GLB scene is empty (no geometry)')

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const halfFrame = maxDim * 0.7

    // Orthographic camera at 3/4 angle framed to the bounding box.
    const camera = new THREE.OrthographicCamera(
      -halfFrame,
      halfFrame,
      halfFrame,
      -halfFrame,
      0.1,
      maxDim * 20,
    )
    const offset = maxDim * 2
    camera.position.set(center.x + offset, center.y + offset * 0.7, center.z + offset)
    camera.lookAt(center)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/png',
      )
    })
  } finally {
    // Best-effort disposal — even on error.
    if (gltfScene) {
      gltfScene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
    }
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
