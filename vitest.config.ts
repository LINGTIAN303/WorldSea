import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    include: [
      'src/**/__tests__/**/*.spec.ts',
      'worldsmith-server/**/__tests__/**/*.spec.ts',
      'packages/memory-archive/**/__tests__/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/ui/Ws*.vue',
        'src/ui/__tests__/primitives/**',
        'src/plugins/official/workflow/composables/use*.ts',
      ],
      exclude: [
        'src/ui/__tests__/**',
        'src/ui/__stories__/**',
        '**/*.spec.ts',
      ],
    },
  },
  resolve: {
    // 转为数组形式（Vite 8 中对象形式的 $ 后缀 alias 不生效，需用数组形式）
    // 与 vite.config.ts 保持一致，避免测试与开发环境行为分叉
    alias: Object.entries({
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@agent': path.resolve(__dirname, 'packages/agent-runtime/src'),
      '@worldsmith/entity-core$': path.resolve(__dirname, 'packages/entity-core/src'),
      '@worldsmith/entity-core/stores': path.resolve(__dirname, 'packages/entity-core/src/stores'),
      '@worldsmith/entity-core/core': path.resolve(__dirname, 'packages/entity-core/src/core'),
      '@worldsmith/entity-core/types': path.resolve(__dirname, 'packages/entity-core/src/types'),
      '@worldsmith/entity-core/composables': path.resolve(__dirname, 'packages/entity-core/src/composables'),
      '@worldsmith/entity-core/traits': path.resolve(__dirname, 'packages/entity-core/src/traits'),
      '@worldsmith/entity-core/facets': path.resolve(__dirname, 'packages/entity-core/src/facets'),
      '@worldsmith/entity-core/relations': path.resolve(__dirname, 'packages/entity-core/src/relations'),
      '@worldsmith/plugin-sdk$': path.resolve(__dirname, 'packages/plugin-sdk/src'),
      '@worldsmith/plugin-sdk/components': path.resolve(__dirname, 'packages/plugin-sdk/src/components'),
      '@worldsmith/plugin-sdk/composables': path.resolve(__dirname, 'packages/plugin-sdk/src/composables'),
      '@worldsmith/ui-kit$': path.resolve(__dirname, 'packages/ui-kit/src'),
      '@worldsmith/canvas-engine$': path.resolve(__dirname, 'packages/canvas-engine/src'),
      '@worldsmith/canvas-engine/core': path.resolve(__dirname, 'packages/canvas-engine/src/core'),
      '@worldsmith/canvas-engine/tree': path.resolve(__dirname, 'packages/canvas-engine/src/tree'),
      '@worldsmith/canvas-engine/graph': path.resolve(__dirname, 'packages/canvas-engine/src/graph'),
      '@worldsmith/canvas-engine/algorithms': path.resolve(__dirname, 'packages/canvas-engine/src/algorithms'),
      '@worldsmith/canvas-engine/geometry': path.resolve(__dirname, 'packages/canvas-engine/src/geometry'),
      '@worldsmith/motion-kit$': path.resolve(__dirname, 'packages/motion-kit/src'),
      '@worldsmith/font-kit$': path.resolve(__dirname, 'packages/font-kit/src'),
      '@worldsmith/font-kit/loader': path.resolve(__dirname, 'packages/font-kit/src/FontLoader'),
      '@worldsmith/font-kit/registry': path.resolve(__dirname, 'packages/font-kit/src/FontRegistry'),
      '@worldsmith/font-kit/wsfont': path.resolve(__dirname, 'packages/font-kit/src/WsFontPack'),
      '@worldsmith/font-kit/tokens': path.resolve(__dirname, 'packages/font-kit/src/tokens'),
      '@worldsmith/font-kit/renderer': path.resolve(__dirname, 'packages/font-kit/src/FontRenderer'),
      '@worldsmith/font-kit/animated': path.resolve(__dirname, 'packages/font-kit/src/AnimatedTextRenderer'),
      '@worldsmith/font-kit/tauri': path.resolve(__dirname, 'packages/font-kit/src/TauriFontBridge'),
      '@worldsmith/font-kit/composables': path.resolve(__dirname, 'packages/font-kit/src/composables'),
      '@worldsmith/agent-core$': path.resolve(__dirname, 'packages/agent-core/src'),
      '@worldsmith/agent-core/types': path.resolve(__dirname, 'packages/agent-core/src/types'),
      '@worldsmith/agent-core/guard': path.resolve(__dirname, 'packages/agent-core/src/guard'),
      '@worldsmith/agent-core/registry': path.resolve(__dirname, 'packages/agent-core/src/registry'),
      '@worldsmith/agent-core/bus': path.resolve(__dirname, 'packages/agent-core/src/bus'),
      '@worldsmith/agent-core/execution': path.resolve(__dirname, 'packages/agent-core/src/execution'),
      '@worldsmith/agent-core/factory': path.resolve(__dirname, 'packages/agent-core/src/factory'),
      '@worldsmith/theme-kit': path.resolve(__dirname, 'packages/theme-kit/src'),
      '@worldsmith/memory-archive$': path.resolve(__dirname, 'packages/memory-archive/src'),
      '@worldsmith/memory-archive/types': path.resolve(__dirname, 'packages/memory-archive/src/types'),
      '@worldsmith/memory-archive/core': path.resolve(__dirname, 'packages/memory-archive/src/core'),
      '@worldsmith/memory-archive/adapters': path.resolve(__dirname, 'packages/memory-archive/src/adapters'),
      '@worldsmith/memory-archive/storage': path.resolve(__dirname, 'packages/memory-archive/src/storage'),
      '@worldsmith/memory-archive/embedding': path.resolve(__dirname, 'packages/memory-archive/src/embedding'),
      '@worldsmith/memory-archive/utils': path.resolve(__dirname, 'packages/memory-archive/src/utils'),
    }).map(([key, value]) => {
      // 精确匹配（$ 后缀）转为正则 ^...$；前缀匹配保持字符串
      if (key.endsWith('$')) {
        const escaped = key.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return { find: new RegExp(`^${escaped}$`), replacement: value as string }
      }
      return { find: key, replacement: value as string }
    }),
  },
})
