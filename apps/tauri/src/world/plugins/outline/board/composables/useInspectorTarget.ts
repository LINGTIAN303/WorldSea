import { computed, ref, watch, type ComputedRef } from 'vue'
import type { BoardContainer } from '../layoutSchema'
import { useOutlineBoardPrefs } from './useOutlineBoardPrefs'

/**
 * 容器编辑面板的「目标」与开关（2026-10-18）。
 *
 * 三条规则（顺序即优先级）：
 * 1. **手动关闭优先**：`closed` 为真时不出面板；切换选中时由调用方重置（保持旧行为）。
 * 2. 有选中 → 面板目标 = 选中容器。
 * 3. **无选中**：仅 `free`（悬浮）模式回落到「最后编辑的容器」——即点击画布空白取消选中后
 *    面板仍在（用户 2026-10-18 明确要求）；`follow` / `fixed` 模式维持原行为（消失）。
 *
 * 抽成组合函数的原因：BoardView 已处于 1230 行冻结基线，不再增加行数。
 */
export function useInspectorTarget(
  selectedContainer: ComputedRef<BoardContainer | null>,
  containers: () => BoardContainer[],
) {
  const { inspectorMode } = useOutlineBoardPrefs()
  const closed = ref(false)
  const lastId = ref<string | null>(null)

  watch(selectedContainer, (c) => {
    if (c) lastId.value = c.id
  })

  const target = computed<BoardContainer | null>(() => {
    if (closed.value) return null
    if (selectedContainer.value) return selectedContainer.value
    if (inspectorMode.value !== 'free') return null
    return containers().find(c => c.id === lastId.value) ?? null
  })

  return { closed, target }
}
