import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
