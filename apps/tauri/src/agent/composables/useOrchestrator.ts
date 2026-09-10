/**
 * Tauri 端 useOrchestrator 兼容入口（芽迁移用）
 * 复用共享包 @worldsea/shared-composables/agent/useOrchestrator（与 web 端一致）。
 */
export {
  useOrchestrator,
  trackSubAgentLongTask,
  untrackSubAgentLongTask,
  type SubAgentState,
} from '@worldsea/shared-composables/agent/useOrchestrator'
