import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "model-viewer" } } })],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'packages/entity-core/**/__tests__/**/*.spec.ts',
      'packages/shared-composables/**/__tests__/**/*.spec.ts',
      'packages/shared-ui/**/__tests__/**/*.spec.ts',
      // 2026-09-20 纳入（Q1 提问工具）：ui-kit composable 此前无测试目录；
      // useAsk 批量提问状态机（五态）为纯逻辑，适宜 jsdom 直测
      'packages/ui-kit/**/__tests__/**/*.spec.ts',
      // 2026-10-01 纳入（批量选择态改造）：plugin-sdk composable 此前无测试目录；
      // useBatchDelete 的批量态语义（进出清空 / 清空≠退出）是 UI 行为契约，纯逻辑可直测
      'packages/plugin-sdk/**/__tests__/**/*.spec.ts',
      // 2026-09-14 纳入：原先只覆盖 packages/**，唯一 GUI（apps/tauri，含全部芽视图与
      // 前端逻辑）完全不参与测试 —— 新写的纯逻辑只能靠临时脚本验证。
      'apps/tauri/**/__tests__/**/*.spec.ts',
      // 2026-09-24 纳入（C1-c 壳桥）：壳注入脚本 `apps/tauri/src-tauri/src/dsh_shell_bridge.js`
      // 的行为测试——外链守卫直接改变用户可见行为（点击外链 → 系统浏览器），而它是注入到页面的
      // 唯一拦截点，Rust 单测看不见；故以 jsdom 载入同一份文件直测（同一目录另有 Rust 侧守卫）。
      'apps/tauri/src-tauri/src/__tests__/**/*.spec.ts',
      // 2026-09-30 纳入（D3-c2 数据面编辑）：两个内置级 dsh 插件的**手写零构建产物**
      // 此前完全不参与测试 —— 宿主半的 config 声明与解析语义（dshHome 覆盖 > env、dataRoot
      // 兜底）、客户端半的跨插件绑定接线（configForms 命名空间与字段名要与宿主/补丁行两侧
      // 一致）都是会**静默断链**的契约，且 Rust 单测与 dsh 自带门禁都看不见它们。
      'apps/dsh-plugin-worldsea/__tests__/**/*.spec.ts',
      'apps/dsh-plugin-worldsea-console/__tests__/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
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
      '@worldsea/theme-kit': path.resolve(__dirname, 'packages/theme-kit/src'),
      // B（2026-09-25）：第二棵树（世界语义）的 cordis 依赖 = 自 vendor（与 apps/tauri/vite.config.ts 同口径）
      '@deepseek-ai/cordis$': path.resolve(__dirname, 'apps/tauri/src/world/vendor/cordis/lib/index.js'),
      '@deepseek-ai/cosmokit$': path.resolve(__dirname, 'apps/tauri/src/world/vendor/cosmokit/lib/index.js'),
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
