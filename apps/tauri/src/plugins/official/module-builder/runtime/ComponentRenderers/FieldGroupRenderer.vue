<template>
  <div class="field-group-renderer" :class="{ collapsed: isCollapsed }">
    <div class="fg-header" @click="isCollapsed = !isCollapsed">
      <span class="fg-toggle"><WsIcon :name="isCollapsed ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
      <span class="fg-label">{{ config.label || '字段分组' }}</span>
    </div>
    <div v-if="!isCollapsed" class="fg-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{ config: Record<string, unknown>; componentId: string }>()
const isCollapsed = ref(false)
</script>

<style scoped>
.field-group-renderer { border: 1px solid var(--border-color); border-radius: var(--radius-sm); overflow: hidden; }
.fg-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--bg-secondary); cursor: pointer; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.fg-toggle { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.fg-content { padding: 12px; }
.collapsed .fg-content { display: none; }
</style>
