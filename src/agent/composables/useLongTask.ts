/**
 * 兼容 re-export — 实现已迁移至 @worldsmith/shared-composables
 *
 * 端分离批次4：本文件保留仅为向后兼容，实际逻辑在 shared-composables。
 * useLongTask 本身端无关（仅依赖 vue + longTaskStore），无需依赖注入。
 */
export { useLongTask } from '@worldsmith/shared-composables/long-task/useLongTask'
