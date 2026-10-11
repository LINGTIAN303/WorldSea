/**
 * useTuiToast：Tauri 端全局 Toast 提示（弱提示风格）
 *
 * 模块级单例：任何组件 import 后调用 `toast.success/info/warn/error(msg)`，
 * 消息堆叠在右下角，自动消失可关闭，安静不打断操作（符合弱提示偏好）。
 * 需在 App 根组件挂载 <TuiToast /> 后生效。
 * 详细why请见 docs/details/注释/tauri/components/useTuiToast.md
 */
import { ref } from 'vue'

export type TuiToastType = 'success' | 'info' | 'warn' | 'error'

export interface TuiToastItem {
  id: number
  type: TuiToastType
  msg: string
  duration: number
}

/** 默认展示时长（ms） */
const DEFAULT_DURATION = 3000

const toasts = ref<TuiToastItem[]>([])
let seq = 0

/** 移除指定 toast */
function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** 核心：追加一条 toast 并安排自动消失 */
function push(type: TuiToastType, msg: string, duration = DEFAULT_DURATION) {
  const id = ++seq
  toasts.value.push({ id, type, msg, duration })
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration)
  }
  return id
}

export function useTuiToast() {
  return {
    toasts,
    dismiss,
    success: (msg: string, duration?: number) => push('success', msg, duration),
    info: (msg: string, duration?: number) => push('info', msg, duration),
    warn: (msg: string, duration?: number) => push('warn', msg, duration),
    error: (msg: string, duration?: number) => push('error', msg, duration),
  }
}
