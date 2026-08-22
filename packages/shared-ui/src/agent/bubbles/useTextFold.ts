/**
 * 正文折叠 composable（统一复用）
 *
 * 原 NormalMessageBubble / DeepMessageArea 均以「行数 >8 或字符 >600」判定长文本并
 * 提供「展开全文 / 收起」，逻辑重复。这里收敛为单一单元。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface TextFold {
  /** 是否已展开 */
  expanded: Ref<boolean>
  /** 文本是否超过折叠阈值 */
  isLong: ComputedRef<boolean>
  /** 切换展开态 */
  toggle: () => void
}

export function useTextFold(getText: () => string | undefined): TextFold {
  const expanded = ref(false)
  const isLong = computed<boolean>(() => {
    const text = getText()
    if (!text) return false
    const lines = text.split('\n').length
    const charLen = text.length
    return lines > 8 || charLen > 600
  })
  const toggle = () => {
    expanded.value = !expanded.value
  }
  return { expanded, isLong, toggle }
}