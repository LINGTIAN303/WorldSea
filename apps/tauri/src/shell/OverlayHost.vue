<template>
  <!-- 插件贡献的全局覆盖层宿主（L0 骨架，批2）：真源 = pluginAPI（entity-core），本组件只做镜像渲染。
       打开 = `ws-open-<id>` 全局事件（监听随登记集增删）；关闭 = 面板组件 emit `close`。
       面板组件契约 = `{ show }` props + `@close` emit（迁移面板零改动）。 -->
  <template v-for="overlay in overlays" :key="overlay.id">
    <component :is="overlay.component" :show="!!openMap[overlay.id]" @close="closeOverlay(overlay.id)" />
  </template>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { pluginAPI } from '@worldsea/entity-core'
import type { PluginOverlay } from '@worldsea/entity-core'

/** 镜像的登记集（真源在 pluginAPI；onOverlayChange 是唯一同步口）。 */
const overlays = ref<PluginOverlay[]>([])
/** 各 overlay 的打开态（`ws-open-<id>` 置 true；close 事件置 false）。 */
const openMap = ref<Record<string, boolean>>({})

/** `ws-open-<id>` 监听器登记表（反注册时精确移除）。 */
const listeners = new Map<string, EventListener>()

function openHandler(id: string): EventListener {
  return () => {
    openMap.value[id] = true
  }
}

function closeOverlay(id: string): void {
  openMap.value[id] = false
}

function addOverlay(overlay: PluginOverlay): void {
  if (listeners.has(overlay.id)) return
  const listener = openHandler(overlay.id)
  window.addEventListener(`ws-open-${overlay.id}`, listener)
  listeners.set(overlay.id, listener)
}

function removeOverlay(overlayId: string): void {
  const listener = listeners.get(overlayId)
  if (listener) window.removeEventListener(`ws-open-${overlayId}`, listener)
  listeners.delete(overlayId)
  delete openMap.value[overlayId]
}

function syncFromTruth(): void {
  overlays.value = [...pluginAPI.getOverlays()]
}

pluginAPI.onOverlayChange(change => {
  if (change.kind === 'registered') addOverlay(change.overlay)
  else removeOverlay(change.overlay.id)
  syncFromTruth()
})

onUnmounted(() => {
  for (const id of [...listeners.keys()]) removeOverlay(id)
})

// 起树晚于本组件挂载时（懒挂载免疫，此处兜底对账一次既有登记）
syncFromTruth()
for (const overlay of pluginAPI.getOverlays()) addOverlay(overlay)
</script>
