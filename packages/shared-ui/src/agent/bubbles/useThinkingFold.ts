/**
 * 思维链折叠 composable（统一复用）
 *
 * 两消息体（DeepMessageArea / NormalMessageBubble）原分别在 deep 面板与 normal `<details>` 中
 * 维护思考过程展开态，逻辑重复。这里收敛为单一单元：
 *  - label：折叠标题文案（explore 为「搜索思路」，其余为「推理链」）
 *  - defaultOpen：未手动操作时的默认展开态（deep 变体默认展开）
 *  - isOpen：当前生效的展开态（手动操作优先，否则回退 defaultOpen）
 *  - toggle / setOpen：供按钮与 `<details>` toggle 事件调用
 */
import { computed, ref, type ComputedRef } from 'vue'

export interface ThinkingFold {
  label: ComputedRef<string>
  isOpen: ComputedRef<boolean>
  toggle: () => void
  setOpen: (v: boolean) => void
}

export function useThinkingFold(
  label: () => string,
  defaultOpen: () => boolean,
): ThinkingFold {
  const open = ref<boolean | null>(null)
  const labelRef = computed(label)
  const isOpen = computed<boolean>(() =>
    open.value === null ? defaultOpen() : open.value,
  )
  const toggle = () => {
    open.value = !isOpen.value
  }
  const setOpen = (v: boolean) => {
    open.value = v
  }
  return { label: labelRef, isOpen, toggle, setOpen }
}