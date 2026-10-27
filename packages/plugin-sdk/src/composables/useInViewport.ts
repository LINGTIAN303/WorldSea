import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 预载缓冲：视口外 200px 内提前挂载，滚动时不闪空 */
const ROOT_MARGIN = '200px'

let visibleRefs = new WeakMap<Element, Ref<boolean>>()
let observer: IntersectionObserver | null = null

/** 仅测试：断开单例并清空注册表（避免用例间共享状态） */
export function resetInViewportObserverForTests() {
  observer?.disconnect()
  observer = null
  visibleRefs = new WeakMap()
}

/** 单例 IntersectionObserver（多卡片共享，避免每卡一个观察者） */
function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = visibleRefs.get(entry.target)
        if (target) target.value = entry.isIntersecting
      }
    }, { rootMargin: ROOT_MARGIN })
  }
  return observer
}

/**
 * 元素是否接近视口（F3 视口感知渲染）。
 * 无 IntersectionObserver 的环境（jsdom / 旧内核）恒为 true，保持原有全量渲染。
 */
export function useInViewport(el: Ref<Element | null>): Ref<boolean> {
  const io = ensureObserver()
  // 有 IO：首次回调前按「不可见」处理（避免首帧批量实例化离屏模型）；无 IO：恒可见
  const inViewport = ref(!io)
  if (!io) return inViewport

  let current: Element | null = null
  const sync = (node: Element | null) => {
    if (current) {
      io.unobserve(current)
      visibleRefs.delete(current)
    }
    current = node
    if (node) {
      visibleRefs.set(node, inViewport)
      io.observe(node)
    }
  }

  watch(el, sync, { immediate: true, flush: 'post' })
  onBeforeUnmount(() => {
    if (current) {
      io.unobserve(current)
      visibleRefs.delete(current)
    }
  })
  return inViewport
}
