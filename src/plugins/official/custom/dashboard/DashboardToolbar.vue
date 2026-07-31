<template>
  <div class="dash-toolbar">
    <h3><WsIcon name="notepad" size="sm" /> 面板布局</h3>
    <CreateButton label="添加面板" size="small" @click="$emit('add')" />
    <div class="dash-controls">
      <CustomDropdown :model-value="modelValue" :options="options" @update:model-value="$emit('update:modelValue', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Dashboard 顶部工具栏
 * - 标题、添加面板按钮、布局方向选择器
 * - 布局方向通过 v-model 与父组件双向绑定
 */
import WsIcon from '../../../../ui/WsIcon.vue'
import { CustomDropdown, CreateButton } from '@worldsmith/plugin-sdk'

defineProps<{
  // 与 CustomDropdown 的 modelValue 类型保持一致，避免 v-model 类型不兼容
  modelValue: string
  options: { value: string; label: string }[]
}>()

defineEmits<{
  add: []
  'update:modelValue': [value: string]
}>()
</script>

<style scoped>
.dash-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dash-toolbar h3 {
  margin: 0;
}

.dash-controls {
  margin-left: auto;
}

.dash-controls label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.dash-controls select {
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: var(--font-size-sm);
}
</style>
