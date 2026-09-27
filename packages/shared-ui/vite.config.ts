import { defineConfig } from 'vite'
import { resolve } from 'path'

// 2026-09-27 E8：Agent UI 组件层退场后，shared-ui 仅承载产品级 markdown 模块
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
