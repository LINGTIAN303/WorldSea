/**
 * Tauri 端 useOrchestrator 兼容入口（插件迁移用）
 * 复用共享包 @worldsmith/shared-composables/agent/useOrchestrator（与 web 端一致）。
 */
export {
  useOrchestrator,
  trackSubAgentLongTask,
  untrackSubAgentLongTask,
  type SubAgentState,
} from '@worldsmith/shared-composables/agent/useOrchestrator'
