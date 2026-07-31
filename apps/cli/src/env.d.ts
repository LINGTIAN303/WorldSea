/**
 * CLI 端类型声明补充
 *
 * 说明：CLI 通过 @worldsmith/agent-runtime 间接（动态 import）拉入 plugin-sdk / ui-kit
 * 等 Vue 相关包的源码参与 typecheck。这些包在 CLI 运行时实际不会被加载（agent.ts
 * 里 import().catch(() => {}) 静默失败），但 tsc 会解析其类型。
 *
 * 此文件提供最小类型声明，避免 .vue / import.meta.glob 等端特定语法阻塞 CLI typecheck。
 */

/// <reference types="vite/client" />

// Vue 单文件组件 —— 仅类型占位，CLI 不实际渲染 Vue 组件
// 注意：用宽松声明（无 body）以支持 <script setup> 的命名导出，
// 如 `import { DetailTab } from './EntityDetailPanel.vue'`。
// CLI 不依赖 Vue 组件的具体类型，丢失类型安全可接受。
declare module '*.vue'

// ─────────────────────────────────────────────────────────────────────────────
// Root src 内部 alias（@/）—— 遗留问题1（UI 解耦）未完成前，
// ui-kit 的 .vue 文件会传递拉入 root src 的 ProjectFS.ts 等模块，
// 它们使用了 @/ alias 的内部导入。此处用 any stub 避免拉入整棵 root src 树。
// 待 UI 解耦完成后可移除。
// ─────────────────────────────────────────────────────────────────────────────
declare module '@/stores/settingsStore' {
  // 最小类型 stub：覆盖 ProjectFS.ts 的两处用法（plugins.map + togglePlugin）
  // 待遗留问题1（UI 解耦）完成后移除
  export function useSettingsStore(): {
    plugins: Array<{ id: string; active: boolean }>
    togglePlugin: (id: string) => void
  }
}
declare module '@/modules/store'
declare module '@/composables/useProjectSwitcher'
