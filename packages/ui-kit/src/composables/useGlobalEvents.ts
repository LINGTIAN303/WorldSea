/**
 * useGlobalEvents — 全局事件注册器
 * 提供声明式的 window 事件注册：onMounted 时批量添加，onBeforeUnmount 时自动清理。
 * （纯 vue、无业务依赖，自根 src/composables/ 下沉到 ui-kit。）
 */

import { onMounted, onBeforeUnmount } from 'vue'

type EventHandler = (e: Event) => void

export function useGlobalEvents() {
  const registrations: { event: string; handler: EventHandler }[] = []

  function on(event: string, handler: EventHandler) {
    registrations.push({ event, handler })
  }

  onMounted(() => {
    for (const { event, handler } of registrations) {
      window.addEventListener(event, handler)
    }
  })

  onBeforeUnmount(() => {
    for (const { event, handler } of registrations) {
      window.removeEventListener(event, handler)
    }
    registrations.length = 0
  })

  return { on }
}
