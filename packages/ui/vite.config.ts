import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'BaseUi',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      // @base/threejs-engine must be external: it is a peer, and inlining it
      // ships a second copy of the Draco decoder wiring inside @base/ui, giving
      // any app that also depends on it two mismatched instances (CI review
      // 2026-08-30). Mirrors @base/threejs-engine's own @base/engine-core setup.
      external: ['vue', 'three', '@base/threejs-engine'],
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
    sourcemap: true,
  },
})
