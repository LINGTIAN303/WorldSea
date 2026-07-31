import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@worldsmith/entity-core': resolve(__dirname, '../entity-core/src/index.ts'),
      '@worldsmith/entity-core/stores': resolve(__dirname, '../entity-core/src/stores/index.ts'),
      '@worldsmith/entity-core/core': resolve(__dirname, '../entity-core/src/core/index.ts'),
      '@worldsmith/entity-core/types': resolve(__dirname, '../entity-core/src/types/index.ts'),
      '@worldsmith/entity-core/composables': resolve(__dirname, '../entity-core/src/composables/index.ts'),
      '@worldsmith/entity-core/traits': resolve(__dirname, '../entity-core/src/traits/index.ts'),
      '@worldsmith/entity-core/facets': resolve(__dirname, '../entity-core/src/facets/index.ts'),
      '@worldsmith/entity-core/relations': resolve(__dirname, '../entity-core/src/relations/index.ts'),
      '@worldsmith/canvas-engine': resolve(__dirname, '../canvas-engine/src/index.ts'),
      '@worldsmith/canvas-engine/core': resolve(__dirname, '../canvas-engine/src/core/index.ts'),
      '@worldsmith/canvas-engine/tree': resolve(__dirname, '../canvas-engine/src/tree/index.ts'),
      '@worldsmith/canvas-engine/graph': resolve(__dirname, '../canvas-engine/src/graph/index.ts'),
      '@worldsmith/canvas-engine/algorithms': resolve(__dirname, '../canvas-engine/src/algorithms/index.ts'),
      '@worldsmith/canvas-engine/geometry': resolve(__dirname, '../canvas-engine/src/geometry/index.ts'),
      '@worldsmith/font-kit': resolve(__dirname, '../font-kit/src/index.ts'),
      '@worldsmith/font-kit/tokens': resolve(__dirname, '../font-kit/src/tokens.ts'),
      '@worldsmith/font-kit/registry': resolve(__dirname, '../font-kit/src/FontRegistry.ts'),
      '@worldsmith/font-kit/loader': resolve(__dirname, '../font-kit/src/FontLoader.ts'),
      '@worldsmith/font-kit/renderer': resolve(__dirname, '../font-kit/src/FontRenderer.ts'),
      '@worldsmith/font-kit/animated': resolve(__dirname, '../font-kit/src/AnimatedTextRenderer.ts'),
      '@worldsmith/font-kit/wsfont': resolve(__dirname, '../font-kit/src/WsFontPack.ts'),
      '@worldsmith/font-kit/tauri': resolve(__dirname, '../font-kit/src/TauriFontBridge.ts'),
      '@worldsmith/font-kit/composables': resolve(__dirname, '../font-kit/src/composables/index.ts'),
      '@worldsmith/motion-kit': resolve(__dirname, '../motion-kit/src/index.ts'),
      '@worldsmith/motion-kit/tokens': resolve(__dirname, '../motion-kit/src/tokens.ts'),
      '@worldsmith/motion-kit/keyframes': resolve(__dirname, '../motion-kit/src/keyframes.ts'),
      '@worldsmith/motion-kit/transitions': resolve(__dirname, '../motion-kit/src/transitions.ts'),
      '@worldsmith/motion-kit/composables': resolve(__dirname, '../motion-kit/src/composables/index.ts'),
      '@worldsmith/motion-kit/GifEncoder': resolve(__dirname, '../motion-kit/src/GifEncoder.ts'),
      '@worldsmith/motion-kit/FrameCapture': resolve(__dirname, '../motion-kit/src/FrameCapture.ts'),
      '@worldsmith/theme-kit': resolve(__dirname, '../theme-kit/src/index.ts'),
      '@worldsmith/theme-kit/types': resolve(__dirname, '../theme-kit/src/types.ts'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: (id: string) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('src/'),
    },
  },
})
