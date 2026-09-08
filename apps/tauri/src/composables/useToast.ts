/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsea/ui-kit
 * Phase 8c: useToast 统一状态源
 *
 * 之前根目录与 ui-kit 各有一份 useToast 实现，导致 toast 状态分裂。
 * 改为 re-export 后，所有调用方共享同一份 toasts ref 与 nextId 计数器。
 */
export {
  toasts,
  dismiss,
  toast,
  useToast,
  toastSuccess,
  toastError,
  toastInfo,
  toastWarn,
  toastWithUndo,
  type ToastType,
} from '@worldsea/ui-kit'
