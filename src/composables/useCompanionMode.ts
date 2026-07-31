/**
 * useCompanionMode — 陪伴模式（Companion Mode）核心逻辑 composable
 *
 * 迁移说明：实现已下沉到 @worldsmith/shared-composables/companion/useCompanionMode，
 * 此文件保留作为向后兼容的 re-export，避免现有调用方（Shell.vue / CompanionNotification.vue）改动。
 */

export {
  useCompanionMode,
  type CompanionNotificationData,
} from '@worldsmith/shared-composables/companion/useCompanionMode'
