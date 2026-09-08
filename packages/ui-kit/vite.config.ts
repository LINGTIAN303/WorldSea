import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@worldsea/entity-core': resolve(__dirname, '../entity-core/src/index.ts'),
      '@worldsea/entity-core/stores': resolve(__dirname, '../entity-core/src/stores/index.ts'),
      '@worldsea/entity-core/core': resolve(__dirname, '../entity-core/src/core/index.ts'),
      '@worldsea/entity-core/types': resolve(__dirname, '../entity-core/src/types/index.ts'),
      '@worldsea/entity-core/composables': resolve(__dirname, '../entity-core/src/composables/index.ts'),
      '@worldsea/entity-core/traits': resolve(__dirname, '../entity-core/src/traits/index.ts'),
      '@worldsea/entity-core/facets': resolve(__dirname, '../entity-core/src/facets/index.ts'),
      '@worldsea/entity-core/relations': resolve(__dirname, '../entity-core/src/relations/index.ts'),
      '@worldsea/canvas-engine': resolve(__dirname, '../canvas-engine/src/index.ts'),
      '@worldsea/canvas-engine/core': resolve(__dirname, '../canvas-engine/src/core/index.ts'),
      '@worldsea/canvas-engine/tree': resolve(__dirname, '../canvas-engine/src/tree/index.ts'),
      '@worldsea/canvas-engine/graph': resolve(__dirname, '../canvas-engine/src/graph/index.ts'),
      '@worldsea/canvas-engine/algorithms': resolve(__dirname, '../canvas-engine/src/algorithms/index.ts'),
      '@worldsea/canvas-engine/geometry': resolve(__dirname, '../canvas-engine/src/geometry/index.ts'),
      '@worldsea/font-kit': resolve(__dirname, '../font-kit/src/index.ts'),
      '@worldsea/font-kit/tokens': resolve(__dirname, '../font-kit/src/tokens.ts'),
      '@worldsea/font-kit/registry': resolve(__dirname, '../font-kit/src/FontRegistry.ts'),
      '@worldsea/font-kit/loader': resolve(__dirname, '../font-kit/src/FontLoader.ts'),
      '@worldsea/font-kit/renderer': resolve(__dirname, '../font-kit/src/FontRenderer.ts'),
      '@worldsea/font-kit/animated': resolve(__dirname, '../font-kit/src/AnimatedTextRenderer.ts'),
      '@worldsea/font-kit/wsfont': resolve(__dirname, '../font-kit/src/WsFontPack.ts'),
      '@worldsea/font-kit/tauri': resolve(__dirname, '../font-kit/src/TauriFontBridge.ts'),
      '@worldsea/font-kit/composables': resolve(__dirname, '../font-kit/src/composables/index.ts'),
      '@worldsea/motion-kit': resolve(__dirname, '../motion-kit/src/index.ts'),
      '@worldsea/motion-kit/tokens': resolve(__dirname, '../motion-kit/src/tokens.ts'),
      '@worldsea/motion-kit/keyframes': resolve(__dirname, '../motion-kit/src/keyframes.ts'),
      '@worldsea/motion-kit/transitions': resolve(__dirname, '../motion-kit/src/transitions.ts'),
      '@worldsea/motion-kit/composables': resolve(__dirname, '../motion-kit/src/composables/index.ts'),
      '@worldsea/motion-kit/GifEncoder': resolve(__dirname, '../motion-kit/src/GifEncoder.ts'),
      '@worldsea/motion-kit/FrameCapture': resolve(__dirname, '../motion-kit/src/FrameCapture.ts'),
      '@worldsea/theme-kit': resolve(__dirname, '../theme-kit/src/index.ts'),
      '@worldsea/theme-kit/types': resolve(__dirname, '../theme-kit/src/types.ts'),
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
