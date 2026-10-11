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
