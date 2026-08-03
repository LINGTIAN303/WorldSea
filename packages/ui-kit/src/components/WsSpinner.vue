<template>
  <span :class="['ws-spinner', size ? `ws-spinner--${size}` : '']" role="status" :aria-label="label">
    <span class="ws-spinner__sr">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  label?: string
}>(), {
  size: 'md',
  label: '加载中',
})
</script>

<style scoped>
.ws-spinner__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
