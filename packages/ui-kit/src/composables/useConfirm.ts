import { ref } from 'vue'

export type ConfirmType = 'info' | 'warning' | 'danger'

interface ConfirmOptions {
  type?: ConfirmType
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
}

interface ConfirmState {
  show: boolean
  type: ConfirmType
  title: string
  description: string
  confirmText: string
  cancelText: string
  resolve: ((value: boolean) => void) | null
}

const state = ref<ConfirmState>({
  show: false,
  type: 'info',
  title: '',
  description: '',
  confirmText: '确定',
  cancelText: '取消',
  resolve: null,
})

const TYPE_DEFAULTS: Record<ConfirmType, { confirmText: string; cancelText: string }> = {
  info: { confirmText: '确定', cancelText: '取消' },
  warning: { confirmText: '继续', cancelText: '取消' },
  danger: { confirmText: '删除', cancelText: '取消' },
}

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    const type = options.type || 'info'
    const defaults = TYPE_DEFAULTS[type]
    return new Promise(resolve => {
      state.value = {
        show: true,
        type,
        title: options.title,
        description: options.description || '',
        confirmText: options.confirmText || defaults.confirmText,
        cancelText: options.cancelText || defaults.cancelText,
        resolve,
      }
    })
  }

  function doConfirm() {
    state.value.resolve?.(true)
    state.value.resolve = null
    state.value.show = false
  }

  function doCancel() {
    state.value.resolve?.(false)
    state.value.resolve = null
    state.value.show = false
  }

  return { state, confirm, doConfirm, doCancel }
}
