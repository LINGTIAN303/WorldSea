import { ref } from 'vue'

export type ConfirmType = 'info' | 'warning' | 'danger'

interface ConfirmOptions {
  type?: ConfirmType
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 可选第三键文案（如「取消(跳过)」）；空/缺省则不渲染。点击按 cancel（false）解析 */
  neutralText?: string
}

interface ConfirmState {
  show: boolean
  type: ConfirmType
  title: string
  description: string
  confirmText: string
  cancelText: string
  neutralText: string
  resolve: ((value: boolean) => void) | null
}

const state = ref<ConfirmState>({
  show: false,
  type: 'info',
  title: '',
  description: '',
  confirmText: '确定',
  cancelText: '取消',
  neutralText: '',
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
        neutralText: options.neutralText || '',
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

  /** 第三键（中性选项）：与 cancel 同为 false，仅语义标签不同（如「跳过」vs「拒绝」） */
  function doNeutral() {
    doCancel()
  }

  return { state, confirm, doConfirm, doCancel, doNeutral }
}
