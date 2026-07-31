import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warn'

interface ToastItem {
  id: number
  type: ToastType
  msg: string
  action?: {
    label: string
    handler: () => void
  }
}

export const toasts = ref<ToastItem[]>([])
let nextId = 1

export function dismiss(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

export function toast(type: ToastType, msg: string, duration = 3000, action?: { label: string; handler: () => void }) {
  const id = nextId++
  toasts.value.push({ id, type, msg, action })
  setTimeout(() => dismiss(id), duration)
}

export function toastSuccess(msg: string) { toast('success', msg) }
export function toastError(msg: string) { toast('error', msg, 5000) }
export function toastInfo(msg: string) { toast('info', msg) }
export function toastWarn(msg: string) { toast('warn', msg, 4000) }

export function toastWithUndo(msg: string, undoHandler: () => void, duration = 5000) {
  const id = nextId++
  toasts.value.push({
    id,
    type: 'info',
    msg,
    action: {
      label: '撤销',
      handler: () => { undoHandler(); dismiss(id) }
    }
  })
  setTimeout(() => dismiss(id), duration)
}

export function useToast() {
  return { toasts, dismiss, toast, toastSuccess, toastError, toastInfo, toastWarn, toastWithUndo }
}
