/**
 * 正文折叠 composable（统一复用）
 *
 * 原 NormalMessageBubble / DeepMessageArea 均以「行数 >8 或字符 >600」判定长文本并
 * 提供「展开全文 / 收起」，逻辑重复。这里收敛为单一单元。
 * O3 修复（2026-08-28）：阈值从 8 行/600 字符上调到 20 行/1500 字符——
 * 走查发现两行正文、8 行数字列表即触发折叠，一条消息多个「展开全文」切碎阅读路径。
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
    return lines > 20 || charLen > 1500
  })
  const toggle = () => {
    expanded.value = !expanded.value
  }
  return { expanded, isLong, toggle }
}