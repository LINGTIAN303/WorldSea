import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type UserConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

import baseConfig from '../vite.config'

/**
 * 工作台（产品域）专用构建：入口 = 本目录，产出 = `../workspace-dist/`（壳协议 /workspace 前缀伺服）。
 * 主体复用产品前端（`../src/main`）与旧配置的全部 alias/define。
 *
 * 2026-09-27 E7：旧 Agent 面前端本体（src/agent、src/space、src/subagent）已删除——此前的
 * 「构建期摘除 Agent 接线」桩插件（STUB_RULES）随之退役：产品源码里不再有指向旧面的 import，
 * 构建即验证（若仍有残留引用会直接报错，不再静默替换）。
 *
 * 用法（从 apps/tauri 目录）：`node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts`
 * 注意：D1-a 起产物由壳协议运行时读取（不嵌入二进制），构建后需 reload 页面生效。
 */
const base = baseConfig as UserConfig

export default defineConfig({
  ...base,
  root: __dirname,
  base: './',
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "model-viewer" } } }), wasm()],
  resolve: { ...(base.resolve ?? {}) },
  build: {
    ...(base.build ?? {}),
    outDir: path.resolve(__dirname, '../workspace-dist'),
    emptyOutDir: true,
    target: 'chrome120',
  },
})
