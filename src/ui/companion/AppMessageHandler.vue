<template>
  <slot />
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { wasmAvailable, WASM_DEPENDENT_FEATURES } from '../../core/worldsmithCore'

const messageApi = useMessage()
const dialogApi = useDialog()

// 注册全局通知回调，供 worldsmithCore.ts 延迟调用
;window.__worldsmith_notify_wasm_failure__ = (reason: string) => {
  if (wasmAvailable.value === false) {
    dialogApi.warning({
      title: 'WASM 核心库不可用',
      content: `核心引擎加载失败: ${reason}\n\n以下功能将不可用:\n${WASM_DEPENDENT_FEATURES.slice(0, 5).join('、')}等\n\n建议在桌面端(Tauri)使用以获取完整功能。`,
      positiveText: '我知道了',
    })
  }
}

// 监听 WASM 可用性变化（响应式触发通知）
const stopWasmWatch = watch(wasmAvailable, (available) => {
  if (available === false) {
    messageApi.warning('WASM 核心库不可用，部分高级功能已禁用', { duration: 8000 })
  }
}, { once: true })

onBeforeUnmount(() => {
  stopWasmWatch()
  delete window.__worldsmith_notify_wasm_failure__
})
</script>
