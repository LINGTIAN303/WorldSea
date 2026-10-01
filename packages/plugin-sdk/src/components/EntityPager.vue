<template>
  <div class="pager">
    <TuiButton variant="ghost" size="sm" icon="chevron-left" :disabled="page <= 1" title="上一页（Ctrl+←）" aria-label="上一页" @click="$emit('prev')" />
    <span class="pager-info">{{ page }} / {{ total }}</span>
    <TuiButton variant="ghost" size="sm" icon="chevron-right" :disabled="page >= total" title="下一页（Ctrl+→）" aria-label="下一页" @click="$emit('next')" />
  </div>
</template>

<script setup lang="ts">
/** 分页控件（左右箭头 + 当前页/总页数）。抽独立组件：GEV 主线保持精简，时间线/大纲等自有列表日后可复用。
 *  why 与分页口径见 docs/details/注释/packages/plugin-sdk/实体视图分页.md */
import { TuiButton } from '@worldsea/ui-kit'

defineProps<{
  page: number
  total: number
}>()

defineEmits<{
  prev: []
  next: []
}>()
</script>

<style scoped>
.pager { display: flex; align-items: center; gap: 2px; }
.pager-info { font-size: var(--font-size-sm); color: var(--text-secondary, #6b7280); padding: 0 4px; white-space: nowrap; }
</style>

