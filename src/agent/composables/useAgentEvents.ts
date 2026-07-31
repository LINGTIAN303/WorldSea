/**
 * 兼容 re-export — 实现已迁移至 @worldsmith/shared-composables
 *
 * 端分离批次3：本文件保留仅为向后兼容，实际逻辑在 shared-composables。
 * Tauri 端过渡期继续通过相对路径导入；新代码应直接从 shared-composables 导入。
 */
export {
  useAgentEvents,
  type ToolCallView,
} from '@worldsmith/shared-composables/agent/useAgentEvents'
