/**
 * # useAgent — Tauri 端入口（端分离批次2）
 *
 * ## 架构位置
 * 本文件是 Tauri 端的 Agent Backend 入口，职责：
 * 1. re-export 共享类型（DeepSegment / ToolCallView 等）从 @worldsmith/shared-composables
 * 2. 提供 Tauri 端 useAgent() 实现：调用 useAgentRustAdapter
 * 3. 导出 provideAgentBackend 供需要注入的组件使用
 *
 * ## 端分离策略
 * - 共享层：@worldsmith/shared-composables/agent/useAgent（inject 模式 + 类型定义）
 * - Tauri 端：本文件（useAgentRustAdapter 作为具体实现）
 * - Web/CLI 端：待实现各自的 useAgent 适配器
 *
 * ## 历史
 * - 阶段 1.5：TS / Rust 后端双轨，通过 settingsStore.agentBackend 切换
 * - 阶段 2.0 批次2：移除 TS 后端，始终返回 Rust 后端
 * - 端分离批次2：类型迁移到 shared-composables，本文件保留 Tauri 端实现
 *
 * ## 功能说明（Rust 后端）
 * 以下功能已在 Rust 后端接通（详见 useAgentRust.ts）：
 * - 终端 PTY（openTerminal → cmd_pty_spawn，批次2）
 * - 子后端创建（createSubBackend → 独立 Rust 会话，批次3）
 * - A2UI 数据绑定（resolveDataBinding 已实现）
 * - 深度模式段（deepSegments 由 deep_phase_changed 事件构建）
 * 仍为 null/no-op 的：MCP 连接管理（getMCPManager 返回 null）
 */

// re-export 共享类型（21+ 文件依赖这些类型）
export type {
  ChatMode,
  InteractiveToolType,
  ToolCallView,
  PhaseOutput,
  FinalOutput,
  DeepSegment,
} from '@worldsmith/shared-composables/agent/useAgent'

// re-export 注入工具（供需要 provide/inject 的组件使用）
export {
  provideAgentBackend,
  useAgentOptional,
  AGENT_BACKEND_INJECTION_KEY,
} from '@worldsmith/shared-composables/agent/useAgent'

import { useAgentRustAdapter } from './useAgentRust'

/**
 * useAgent — Tauri 端实现
 *
 * 直接返回 useAgentRustAdapter() 的结果。
 * 使用 `as any` 绕过类型检查：useAgentRustAdapter 返回的字段子集
 * 不完全覆盖历史 useAgentTs 的返回类型。这是"功能退化"决策的预期代价，
 * 调用方访问 Rust 后端未实现的字段会得到 undefined 或 no-op，但不会崩溃。
 *
 * ## 端分离迁移说明
 * 21+ 文件继续从 `@/agent/composables/useAgent` 导入 useAgent()，得到 Tauri 实现。
 * 迁移到 shared-composables 的文件使用 useAgentOptional()（inject 模式）。
 * 在需要 inject 的组件中，调用 provideAgentBackend(useAgentRustAdapter()) 注入。
 */
export function useAgent() {
  return useAgentRustAdapter() as any
}
