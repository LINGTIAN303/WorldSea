<template>
  <span v-if="active" class="tf-feedback">
    显示 {{ shown }}<template v-if="hidden > 0"> · 已隐藏 {{ hidden }}</template>
    <button type="button" class="tf-clear" @click="$emit('clear')">清除筛选</button>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  shown: number
  hidden: number
  /** 任一筛选条件生效时才显示 */
  active: boolean
}>()

defineEmits<{ clear: [] }>()
</script>

<style scoped>
.tf-feedback {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--hover-bg);
  border-radius: var(--radius-xs);
  white-space: nowrap;
}
.tf-clear {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.tf-clear:hover { text-decoration: underline; }
</style>
