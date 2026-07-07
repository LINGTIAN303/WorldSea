<template>
  <div v-if="hasError" class="nb-error-boundary">
    <div class="nb-error-icon"><WsIcon name="alert-triangle" size="sm" /></div>
    <div class="nb-error-msg">{{ errorMessage }}</div>
    <button class="nb-error-retry" @click="retry">重试</button>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import WsIcon from '../../../../ui/WsIcon.vue'

defineProps<{ message?: string }>()

const hasError = ref(false)
const errorMessage = ref('组件异常，请刷新后重试')

onErrorCaptured((err) => {
  hasError.value = true
  errorMessage.value = '组件异常：' + (err.message || String(err))
  return false
})

function retry() {
  hasError.value = false
  errorMessage.value = '组件异常，请刷新后重试'
}
</script>

<style scoped>
.nb-error-boundary { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; color: var(--color-text-tertiary); padding: 40px; }
.nb-error-icon { color: var(--color-warning); }
.nb-error-msg { font-size: var(--font-size-sm); color: var(--color-text-secondary); text-align: center; }
.nb-error-retry { padding: 6px 16px; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg-surface); color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; }
.nb-error-retry:hover { background: var(--color-bg-hover); }
</style>
