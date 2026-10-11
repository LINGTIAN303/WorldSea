<template>
  <div class="pt-bar">
    <button class="pt-back" @click="$emit('back')">← 返回</button>
    <div class="pt-info">
      <h2 class="pt-title">{{ pipeline.name }}</h2>
      <p v-if="pipeline.description" class="pt-desc">{{ pipeline.description }}</p>
    </div>

    <!-- 编辑模式切换 -->
    <button
      class="pt-btn"
      :class="{ 'pt-btn--active': editing }"
      @click="$emit('toggle-edit', !editing)"
    >
      <IconPencil v-if="!editing" :size="14" />
      <IconCheck v-else :size="14" />
      {{ editing ? '完成编辑' : '编辑步骤' }}
    </button>

    <!-- 状态切换 -->
    <div class="pt-status-group">
      <span class="pt-status-label">状态:</span>
      <select class="pt-status-select" :value="pipeline.status" @change="onStatusChange">
        <option value="draft">草稿</option>
        <option value="ready">就绪</option>
        <option value="running">执行中</option>
        <option value="paused">已暂停</option>
        <option value="completed">已完成</option>
        <option value="failed">失败</option>
      </select>
    </div>

    <div class="pt-actions">
      <slot name="actions">
        <button class="pt-btn" @click="$emit('save-template')">
          <IconDeviceFloppy :size="14" />
          存为模板
        </button>
        <button class="pt-btn pt-btn--danger" @click="$emit('delete')" aria-label="删除流水线"><IconTrash :size="14" /></button>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconPencil, IconCheck, IconDeviceFloppy, IconTrash } from '@tabler/icons-vue'
import type { CreationPipeline, PipelineStatus } from '../types'

defineProps<{
  pipeline: CreationPipeline
  editing: boolean
}>()

const emit = defineEmits<{
  back: []
  'save-template': []
  delete: []
  'toggle-edit': [value: boolean]
  'change-status': [status: PipelineStatus]
}>()

function onStatusChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value as PipelineStatus
  emit('change-status', val)
}
</script>

<style scoped>
.pt-bar {
  display: flex; align-items: flex-start; gap: 12px; flex-shrink: 0;
}
.pt-back {
  background: none; border: none; color: var(--primary, #4f46e5);
  cursor: pointer; font-size: var(--fs-md); padding: 4px 0;
}
.pt-info { flex: 1; }
.pt-title { margin: 0; font-size: 18px; font-weight: 600; }
.pt-desc { margin: 4px 0 0; font-size: var(--fs-sm); opacity: 0.6; }

.pt-status-group {
  display: flex; align-items: center; gap: 4px; padding-top: 2px;
}
.pt-status-label { font-size: var(--fs-sm); opacity: 0.6; }
.pt-status-select {
  padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  font-size: var(--fs-sm); cursor: pointer; outline: none;
}
.pt-status-select:focus { border-color: var(--primary, #4f46e5); }

.pt-actions { display: flex; gap: 6px; }

.pt-btn {
  padding: 5px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  cursor: pointer; font-size: var(--fs-sm); transition: background 0.15s, border-color 0.15s;
}
.pt-btn:hover { background: var(--bg-tertiary, #e4e4e7); }
.pt-btn--active {
  border-color: var(--warning, #d97706);
  background: color-mix(in srgb, var(--warning, #d97706) 15%, var(--bg-secondary, #f4f4f5));
  color: var(--warning, #d97706);
}
.pt-btn--danger { color: var(--danger, #dc2626); }
</style>
