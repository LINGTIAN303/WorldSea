<template>
  <div class="pager">
    <button class="btn-ghost btn-sm pager-btn" :disabled="page <= 1" title="上一页（Ctrl+←）" aria-label="上一页" @click="$emit('prev')">
      <WsIcon name="chevron-left" size="xs" />
    </button>
    <span class="pager-info">{{ page }} / {{ total }}</span>
    <button class="btn-ghost btn-sm pager-btn" :disabled="page >= total" title="下一页（Ctrl+→）" aria-label="下一页" @click="$emit('next')">
      <WsIcon name="chevron-right" size="xs" />
    </button>
  </div>
</template>

<script setup lang="ts">
/** 分页控件（左右箭头 + 当前页/总页数）。抽独立组件：GEV 主线保持精简，时间线/大纲等自有列表日后可复用。
 *  why 与分页口径见 docs/details/注释/packages/plugin-sdk/实体视图分页.md */
import { WsIcon } from '@worldsea/ui-kit'

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
.pager-btn { display: inline-flex; align-items: center; justify-content: center; padding: 4px 6px; }
.pager-info { font-size: var(--font-size-sm); color: var(--text-secondary, #6b7280); padding: 0 4px; white-space: nowrap; }
</style>

<!-- 按钮规格与前缀样式走共享源（scoped src）：与工具条其它按钮同源 -->
<style scoped src="./toolbar-buttons.css"></style>
