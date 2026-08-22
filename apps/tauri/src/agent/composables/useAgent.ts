/**
 * Tauri 端 useAgent 兼容入口（插件迁移用）
 * 复用 useAgentRust（Rust Agent 后端），对外保持 web 端 useAgent() 的函数形态，
 * 使迁移插件（如 manuscript AISidebar）零改动使用。
 */
import { useAgentRust } from './useAgentRust'

// re-export 共享类型（与 useAgentRust 一致，供依赖这些类型的组件使用）
export type {
  ChatMode,
  InteractiveToolType,
  ToolCallView,
  PhaseOutput,
  DeepSegment,
} from '@worldsmith/shared-composables/agent/useAgent'

export function useAgent() {
  return useAgentRust()
}
