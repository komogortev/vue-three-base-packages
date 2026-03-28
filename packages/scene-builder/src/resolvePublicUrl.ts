/**
 * Resolves site-root paths like `/terrains/foo.png` against a deployment base
 * (e.g. Vite `import.meta.env.BASE_URL` or `getAppBaseUrl()` in the host app).
 *
 * `baseUrl` must include a trailing slash (use {@link bindResolvePublicUrl}).
 */
export function resolveStaticAssetUrl(url: string, baseUrl: string): string {
  if (!url) return url
  if (/^(https?:|blob:|data:)/i.test(url)) return url
  if (url.startsWith('/')) {
    // Vite asset URLs from import.meta.glob already include the base path in production
    // (e.g. /three-dreams/assets/file-HASH.fbx). Prepending again doubles the segment.
    // Descriptor paths (e.g. /Remy.fbx) do NOT start with the base, so they still get prefixed.
    if (baseUrl !== '/' && url.startsWith(baseUrl)) return url
    return `${baseUrl}${url.slice(1)}`
  }
  return url
}

/** Returns `(url) => resolveStaticAssetUrl(url, base)` with a normalized trailing slash on `base`. */
export function bindResolvePublicUrl(baseUrl: string): (url: string) => string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return (url: string) => resolveStaticAssetUrl(url, base)
}
