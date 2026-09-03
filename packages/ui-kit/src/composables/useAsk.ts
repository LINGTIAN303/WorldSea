import { ref } from 'vue'

/**
 * useAsk — 提问弹窗占位（2026-09-03，方向3 P0 批次B）
 *
 * 与确认弹窗（useConfirm）同位置弹出（对话区底部输入栏上方），供「Agent 向用户提问」
 * 场景使用（如任务目标确认、信息补全）。当前为占位实现：composable 结构完整（state/ask/
 * submit/cancel），但尚无调用方接线——后续由 HITL 提问事件（agent:ask:{session_id}）接入。
 */

export interface AskOptions {
  title: string
  placeholder?: string
  defaultValue?: string
  /** 提问用途标识（占位，供后续接入方区分场景） */
  kind?: string
}

interface AskState {
  show: boolean
  title: string
  placeholder: string
  value: string
  resolve: ((value: string | null) => void) | null
}

const state = ref<AskState>({
  show: false,
  title: '',
  placeholder: '',
  value: '',
  resolve: null,
})

export function useAsk() {
  /** 发起提问（占位）：返回 Promise<string | null>（输入值 / 取消=null） */
  function ask(options: AskOptions): Promise<string | null> {
    return new Promise(resolve => {
      state.value = {
        show: true,
        title: options.title,
        placeholder: options.placeholder || '',
        value: options.defaultValue || '',
        resolve,
      }
    })
  }

  /** 提交输入（resolve 输入值并关闭） */
  function submit(): void {
    state.value.resolve?.(state.value.value)
    state.value.resolve = null
    state.value.show = false
  }

  /** 取消（resolve null 并关闭） */
  function cancel(): void {
    state.value.resolve?.(null)
    state.value.resolve = null
    state.value.show = false
  }

  return { state, ask, submit, cancel }
}
