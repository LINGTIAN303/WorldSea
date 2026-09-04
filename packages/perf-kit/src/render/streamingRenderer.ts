import { ref, watch, onBeforeUnmount, type Ref, type WatchSource } from 'vue'
import { rafThrottle } from './rafThrottle'

/**
 * 流式渲染节流器：将高频源数据变化合并为 rAF 级别的渲染更新。
 *
 * 用法：
 *   const displayContent = useStreamingRenderer(() => msg.content)
 *   // template 中使用 displayContent.value 代替 msg.content
 */
export function useStreamingRenderer<T>(
  source: WatchSource<T>,
  options?: { initialValue?: T }
): Ref<T> {
  const display = ref(options?.initialValue) as Ref<T>
  let latest: T | undefined = options?.initialValue
  /** 首帧已同步应用过源值（组件挂载即渲染最新内容）*/
  let appliedFirst = false

  const update = rafThrottle(() => {
    if (latest !== undefined) display.value = latest
  })

  const stop = watch(source, (val) => {
    latest = val
    if (!appliedFirst) {
      // 抖动修复⑭（2026-09-04）：首帧同步应用源值——原实现 immediate 也走 rAF 节流，
      // 组件挂载/滚动切片重挂载后的第一帧 display 仍是 initialValue(空) → 行高塌缩为
      // 内容空态（assistant 文本行实测 4px）→ 滚动区 scrollHeight 骤降 → clamp。
      // 首帧即渲染最新内容，之后的流式高频变化继续 rAF 节流合并。
      appliedFirst = true
      display.value = val as T
    } else {
      update()
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    stop()
    update.cancel()
  })

  return display
}
