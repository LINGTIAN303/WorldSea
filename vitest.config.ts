import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'packages/memory-archive/**/__tests__/**/*.spec.ts',
      'packages/entity-core/**/__tests__/**/*.spec.ts',
      'packages/agent-runtime/src/tools/__tests__/**/*.spec.ts',
      // 2026-09-17 纳入（S1 协议基座）：skills 侧此前无测试目录；解析器/校验器/sidecar 均为纯函数
      'packages/agent-runtime/src/skills/__tests__/**/*.spec.ts',
      'packages/shared-composables/**/__tests__/**/*.spec.ts',
      'packages/shared-ui/**/__tests__/**/*.spec.ts',
      // 2026-09-20 纳入（Q1 提问工具）：ui-kit composable 此前无测试目录；
      // useAsk 批量提问状态机（五态）为纯逻辑，适宜 jsdom 直测
      'packages/ui-kit/**/__tests__/**/*.spec.ts',
      // 2026-09-14 纳入：原先只覆盖 packages/**，唯一 GUI（apps/tauri，含全部芽视图与
      // 前端逻辑）完全不参与测试 —— 新写的纯逻辑只能靠临时脚本验证。
      'apps/tauri/**/__tests__/**/*.spec.ts',
      // 2026-09-21 恢复纳入（世界观芽工具整合收口轮）：src/__tests__/ 此前整体不在收口内，
      // 两枚工具/技能结构守卫长期无人跑（agent-tools / always-available-verify）；
      // 同目录 embedding 系 4 份 spec 本次未一并纳入（导入面未核，另行处置）。
      'packages/agent-runtime/src/__tests__/agent-tools.spec.ts',
      'packages/agent-runtime/src/__tests__/always-available-verify.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'packages/agent-runtime/**',
        'packages/memory-archive/**',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.spec.ts',
      ],
    },
  },
  resolve: {
    // 转为数组形式（Vite 8 中对象形式的 $ 后缀 alias 不生效，需用数组形式）
    // 与 vite.config.ts 保持一致，避免测试与开发环境行为分叉
    alias: Object.entries({
      // `@` 原指向仓库根的 ./src —— web 时代遗留，该目录已不存在，且全仓无消费方。
      // 唯一 GUI 是 apps/tauri，其自身 vite.config 亦为 `@` → apps/tauri/src；
      // 此处对齐，使 apps/tauri 的测试能按项目惯例写 `@/...`（2026-09-14）。
      '@': fileURLToPath(new URL('./apps/tauri/src', import.meta.url)),
      '@agent': path.resolve(__dirname, 'packages/agent-runtime/src'),
      // 2026-09-21 补：canvas-engine 的 agent-descriptor 等共享包按包导出子路径引用
      // agent-runtime / governor-core（apps/tauri/vite.config.ts 已配同款），
      // 测试环境此前缺失导致「导入 ../agent 的 spec 无法收集」；
      // 前缀条目（无 $）覆盖 tools/* / toolbus/* 等子路径。
      '@worldsea/agent-runtime$': path.resolve(__dirname, 'packages/agent-runtime/src'),
      '@worldsea/agent-runtime/execution': path.resolve(__dirname, 'packages/agent-runtime/src/execution'),
      '@worldsea/agent-runtime/bridge-types': path.resolve(__dirname, 'packages/agent-runtime/src/bridge-types'),
      '@worldsea/agent-runtime/toolbus': path.resolve(__dirname, 'packages/agent-runtime/src/toolbus'),
      '@worldsea/agent-runtime/tools': path.resolve(__dirname, 'packages/agent-runtime/src/tools'),
      '@worldsea/governor-core$': path.resolve(__dirname, 'packages/governor-core/src'),
      '@worldsea/governor-core/types': path.resolve(__dirname, 'packages/governor-core/src/types'),
      '@worldsea/governor-core/registry': path.resolve(__dirname, 'packages/governor-core/src/registry'),
      '@worldsea/entity-core$': path.resolve(__dirname, 'packages/entity-core/src'),
      '@worldsea/entity-core/stores': path.resolve(__dirname, 'packages/entity-core/src/stores'),
      '@worldsea/entity-core/core': path.resolve(__dirname, 'packages/entity-core/src/core'),
      '@worldsea/entity-core/types': path.resolve(__dirname, 'packages/entity-core/src/types'),
      '@worldsea/entity-core/composables': path.resolve(__dirname, 'packages/entity-core/src/composables'),
      '@worldsea/entity-core/traits': path.resolve(__dirname, 'packages/entity-core/src/traits'),
      '@worldsea/entity-core/facets': path.resolve(__dirname, 'packages/entity-core/src/facets'),
      '@worldsea/entity-core/relations': path.resolve(__dirname, 'packages/entity-core/src/relations'),
      '@worldsea/plugin-sdk$': path.resolve(__dirname, 'packages/plugin-sdk/src'),
      '@worldsea/plugin-sdk/components': path.resolve(__dirname, 'packages/plugin-sdk/src/components'),
      '@worldsea/plugin-sdk/composables': path.resolve(__dirname, 'packages/plugin-sdk/src/composables'),
      '@worldsea/ui-kit$': path.resolve(__dirname, 'packages/ui-kit/src'),
      '@worldsea/canvas-engine$': path.resolve(__dirname, 'packages/canvas-engine/src'),
      '@worldsea/canvas-engine/core': path.resolve(__dirname, 'packages/canvas-engine/src/core'),
      '@worldsea/canvas-engine/tree': path.resolve(__dirname, 'packages/canvas-engine/src/tree'),
      '@worldsea/canvas-engine/graph': path.resolve(__dirname, 'packages/canvas-engine/src/graph'),
      '@worldsea/canvas-engine/algorithms': path.resolve(__dirname, 'packages/canvas-engine/src/algorithms'),
      '@worldsea/canvas-engine/geometry': path.resolve(__dirname, 'packages/canvas-engine/src/geometry'),
      '@worldsea/motion-kit$': path.resolve(__dirname, 'packages/motion-kit/src'),
      '@worldsea/font-kit$': path.resolve(__dirname, 'packages/font-kit/src'),
      '@worldsea/font-kit/loader': path.resolve(__dirname, 'packages/font-kit/src/FontLoader'),
      '@worldsea/font-kit/registry': path.resolve(__dirname, 'packages/font-kit/src/FontRegistry'),
      '@worldsea/font-kit/wsfont': path.resolve(__dirname, 'packages/font-kit/src/WsFontPack'),
      '@worldsea/font-kit/tokens': path.resolve(__dirname, 'packages/font-kit/src/tokens'),
      '@worldsea/font-kit/renderer': path.resolve(__dirname, 'packages/font-kit/src/FontRenderer'),
      '@worldsea/font-kit/animated': path.resolve(__dirname, 'packages/font-kit/src/AnimatedTextRenderer'),
      '@worldsea/font-kit/tauri': path.resolve(__dirname, 'packages/font-kit/src/TauriFontBridge'),
      '@worldsea/font-kit/composables': path.resolve(__dirname, 'packages/font-kit/src/composables'),
      '@worldsea/agent-core$': path.resolve(__dirname, 'packages/agent-core/src'),
      '@worldsea/agent-core/types': path.resolve(__dirname, 'packages/agent-core/src/types'),
      '@worldsea/agent-core/guard': path.resolve(__dirname, 'packages/agent-core/src/guard'),
      '@worldsea/agent-core/registry': path.resolve(__dirname, 'packages/agent-core/src/registry'),
      '@worldsea/agent-core/bus': path.resolve(__dirname, 'packages/agent-core/src/bus'),
      '@worldsea/agent-core/execution': path.resolve(__dirname, 'packages/agent-core/src/execution'),
      '@worldsea/agent-core/factory': path.resolve(__dirname, 'packages/agent-core/src/factory'),
      '@worldsea/theme-kit': path.resolve(__dirname, 'packages/theme-kit/src'),
      '@worldsea/memory-archive$': path.resolve(__dirname, 'packages/memory-archive/src'),
      '@worldsea/memory-archive/types': path.resolve(__dirname, 'packages/memory-archive/src/types'),
      '@worldsea/memory-archive/core': path.resolve(__dirname, 'packages/memory-archive/src/core'),
      '@worldsea/memory-archive/adapters': path.resolve(__dirname, 'packages/memory-archive/src/adapters'),
      '@worldsea/memory-archive/storage': path.resolve(__dirname, 'packages/memory-archive/src/storage'),
      '@worldsea/memory-archive/embedding': path.resolve(__dirname, 'packages/memory-archive/src/embedding'),
      '@worldsea/memory-archive/utils': path.resolve(__dirname, 'packages/memory-archive/src/utils'),
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
