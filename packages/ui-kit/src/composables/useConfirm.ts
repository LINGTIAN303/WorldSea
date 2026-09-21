import { ref } from 'vue'

export type ConfirmType = 'info' | 'warning' | 'danger'
export type ConfirmPosition = 'center' | 'bottom'

/**
 * 三键选择结果（`withChoice` 模式；D8 审批四值需要区分「拒绝」与「跳过」）
 * - `confirmed`：主键（含附加动作「添加白名单并放行」）
 * - `cancelled`：取消键（拒绝）
 * - `skipped`：第三键（中性选项，如「取消(跳过)」）
 */
export type ConfirmChoice = 'confirmed' | 'cancelled' | 'skipped'

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
  /**
   * 需要区分三键结果时置 true：`confirm()` 的 Promise 返回 [`ConfirmChoice`]
   * （原样保留 boolean 模式给既有调用方——第三键在 boolean 模式下与取消同为 false）。
   */
  withChoice?: boolean
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
  /** withChoice 模式标记（决定 resolve 的取值形态） */
  withChoice: boolean
  resolve: ((value: boolean | ConfirmChoice) => void) | null
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
  withChoice: false,
  resolve: null,
})

const TYPE_DEFAULTS: Record<ConfirmType, { confirmText: string; cancelText: string }> = {
  info: { confirmText: '确定', cancelText: '取消' },
  warning: { confirmText: '继续', cancelText: '取消' },
  danger: { confirmText: '删除', cancelText: '取消' },
}

export function useConfirm() {
  function confirm(options: ConfirmOptions & { withChoice: true }): Promise<ConfirmChoice>
  function confirm(options: ConfirmOptions): Promise<boolean>
  function confirm(options: ConfirmOptions): Promise<boolean | ConfirmChoice> {
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
        withChoice: options.withChoice === true,
        resolve,
      }
    })
  }

  /** 统一三键收口：withChoice 模式返回三值，否则折叠为 boolean（既有调用方契约不变） */
  function resolveWith(choice: ConfirmChoice) {
    const s = state.value
    const resolve = s.resolve
    state.value.resolve = null
    state.value.show = false
    resolve?.(s.withChoice ? choice : choice === 'confirmed')
  }

  function doConfirm() {
    resolveWith('confirmed')
  }

  function doCancel() {
    resolveWith('cancelled')
  }

  /** 第三键（中性选项）：boolean 模式与 cancel 同为 false，仅语义标签不同（如「跳过」vs「拒绝」） */
  function doNeutral() {
    resolveWith('skipped')
  }

  return { state, confirm, doConfirm, doCancel, doNeutral }
}
