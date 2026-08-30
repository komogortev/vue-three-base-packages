import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

/**
 * Self-hosted Draco decoder wiring for GLTFLoader.
 *
 * Primary source: `<base>draco/gltf/` — the three.js `examples/jsm/libs/draco/gltf/`
 * decoder files copied into each consuming app's `public/draco/gltf/`
 * (engine-dev, three-dreams, three-dbox). Serving the decoder from our own origin
 * removes the hard runtime dependency on `gstatic.com`, so Draco-compressed GLBs
 * load offline and behind blocked CDNs (CodeReview 2026-07-11, problem 1).
 *
 * Fallback: {@link DRACO_CDN_FALLBACK_URL} — only for an app that has not copied
 * the decoder files into its `public/`.
 *
 * Single source of truth for both loader sites: re-exported from the package index
 * and consumed by `@base/ui`'s `editor/gltfLoaderFactory` as well as {@link AssetLoader}.
 */

/** Google CDN decoder — matches three.js examples. Fallback only; self-hosted is primary. */
export const DRACO_CDN_FALLBACK_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

/**
 * Deployment base with a trailing slash. Mirrors the host apps' `getAppBaseUrl()`:
 * prefer Vite's `import.meta.env.BASE_URL`, then infer from this module's deployed
 * URL (`.../<repo>/assets/chunk.js`) when CI left `BASE_URL` at `/`, else `/`.
 *
 * Works whether this package is consumed as source (Vite transforms `import.meta.env`)
 * or as pre-bundled `dist` (Vite statically replaces `import.meta.env.BASE_URL` in the
 * production build; in dev the `import.meta.url` branch resolves the base).
 */
function deploymentBase(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
    const base = env?.BASE_URL
    if (typeof base === 'string' && base !== '' && base !== '/') {
      return base.endsWith('/') ? base : `${base}/`
    }
  } catch {
    /* import.meta.env unavailable in this context */
  }
  try {
    const pathname = new URL(import.meta.url).pathname
    const idx = pathname.indexOf('/assets/')
    if (idx > 0) {
      let prefix = pathname.slice(0, idx)
      if (!prefix.endsWith('/')) prefix += '/'
      return prefix
    }
  } catch {
    /* opaque import.meta.url */
  }
  return '/'
}

/**
 * Site path to the self-hosted glTF Draco decoder, e.g. `/draco/gltf/` (dev) or
 * `/three-dbox/draco/gltf/` (GitHub project Pages under a subpath).
 */
export function localDracoDecoderPath(): string {
  return `${deploymentBase()}draco/gltf/`
}

/**
 * Read the DRACOLoader's cached decoder-init promise (set by `preload()` / first
 * decode) and run `onReject` if the decoder fails to load. three's DRACOLoader
 * caches `decoderPending` without resetting it on rejection, so one failed init
 * poisons the instance until it is disposed and recreated — `onReject` is where
 * the owner disposes the poisoned loader (CodeReview 2026-07-11, problem 2).
 *
 * Safe to call after `preload()`; a no-op if init has not been triggered yet.
 */
export function resetDracoLoaderOnInitFailure(loader: DRACOLoader, onReject: () => void): void {
  const pending = (loader as unknown as { decoderPending?: Promise<unknown> | null }).decoderPending
  if (pending) void pending.then(undefined, onReject)
}
