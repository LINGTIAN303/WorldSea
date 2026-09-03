import { ref } from 'vue'

export type ConfirmType = 'info' | 'warning' | 'danger'
export type ConfirmPosition = 'center' | 'bottom'

/** 附加动作（如「添加白名单并放行」）：点击先执行 run()，随后按放行处理（关闭并 resolve true） */
export interface ConfirmExtraAction {
  label: string
  run: () => Promise<void> | void
}

interface ConfirmOptions {
  type?: ConfirmType
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 可选第三键文案（如「取消(跳过)」）；空/缺省则不渲染。点击按 cancel（false）解析 */
  neutralText?: string
  /** 弹出位置：center=中央 modal（默认）；bottom=对话区底部（输入栏上方，可遮住不阻断其他区域） */
  position?: ConfirmPosition
  /** 附加动作按钮（渲染在 actions 区） */
  extraActions?: ConfirmExtraAction[]
}

interface ConfirmState {
  show: boolean
  type: ConfirmType
  title: string
  description: string
  confirmText: string
  cancelText: string
  neutralText: string
  position: ConfirmPosition
  extraActions: ConfirmExtraAction[]
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
  position: 'center',
  extraActions: [],
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
        position: options.position || 'center',
        extraActions: options.extraActions || [],
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
