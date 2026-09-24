import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 启动页（splash）专用构建：入口 = 本目录，产出 = `../shell-loading/`（壳的 frontendDist）。
 * 与 apps/tauri 主构建互不影响（B3 后主前端已退役）；页面本体是原 Vue 组件，此处只做打包。
 * 用法（从 apps/tauri 目录）：`node ../../node_modules/vite/bin/vite.js build --config splash/vite.config.ts`
 * 注意：改动产出后需让壳重新嵌入资源——`cargo build` 若未重新嵌入，先 `touch src-tauri/tauri.conf.json` 再构建。
 */
const TAURI_DIR = path.resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(TAURI_DIR, 'src'),
      // SplashScreen.vue 的 uiStore 依赖 → 桩（原 store 会拖入整个 entity-core）
      '../../stores/uiStore': path.resolve(__dirname, 'stub-uiStore.ts'),
    },
  },
  build: {
    outDir: path.resolve(TAURI_DIR, 'shell-loading'),
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
  },
})
