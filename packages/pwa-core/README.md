# @base/pwa-core

PWA service worker registration, offline handling, and install prompt for the @base ecosystem. **Placeholder: the package exports nothing yet.**

`src/index.ts` is an empty module (`export {}`). The helpers named in the description (service worker
registration, offline handling and an install prompt) are not written. Apps that need a service worker, such as
[vue-pwa-shell](https://github.com/komogortev/vue-pwa-shell), use `vite-plugin-pwa` directly instead.

Do not add this package as a dependency expecting any API.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/pwa-core`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
