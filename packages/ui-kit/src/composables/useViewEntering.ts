import { nextTick, onScopeDispose, ref, watch } from 'vue'

/**
 * 视图切换的入场窗口：视图 id 变化时置 true，duration 后自动回落。
 * 连续切换时先摘再挂，保证动画重新开始。
 */
export function useViewEntering(viewId: () => string | null, duration = 180) {
  const entering = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  function start() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      entering.value = false
      timer = null
    }, duration)
  }

  watch(viewId, async (next, prev) => {
    if (!next || next === prev) return
    const mine = ++seq
    if (!entering.value) {
      entering.value = true
      start()
      return
    }
    entering.value = false
    await nextTick()
    if (mine !== seq) return
    entering.value = true
    start()
  })

  onScopeDispose(() => {
    seq++
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })

  return entering
}
