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
    return `${baseUrl}${url.slice(1)}`
  }
  return url
}

/** Returns `(url) => resolveStaticAssetUrl(url, base)` with a normalized trailing slash on `base`. */
export function bindResolvePublicUrl(baseUrl: string): (url: string) => string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return (url: string) => resolveStaticAssetUrl(url, base)
}
