/**
 * useSmartFillChat — Layer D 对话式协同创作 composable (V2)
 *
 * 迁移说明：实现已下沉到 @worldsmith/shared-composables/agent/useSmartFillChat，
 * 此文件保留作为向后兼容的 re-export，避免现有调用方（Shell.vue / SmartFillChat.vue）改动。
 */

export {
  useSmartFillChat,
  type SmartFillChatContext,
  type SmartFillChatMessage,
} from '@worldsmith/shared-composables/agent/useSmartFillChat'
