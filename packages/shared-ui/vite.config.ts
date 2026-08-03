import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@worldsmith/agent-runtime': resolve(__dirname, '../agent-runtime/src/index.ts'),
      '@worldsmith/entity-core': resolve(__dirname, '../entity-core/src/index.ts'),
      '@worldsmith/shared-composables': resolve(__dirname, '../shared-composables/src/index.ts'),
      '@worldsmith/ui-kit': resolve(__dirname, '../ui-kit/src/index.ts'),
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