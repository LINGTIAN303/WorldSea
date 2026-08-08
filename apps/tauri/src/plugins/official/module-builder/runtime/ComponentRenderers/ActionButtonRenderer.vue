<template>
  <button class="action-btn-renderer" @click="onAction">
    <span v-if="config.icon" class="ab-icon">{{ config.icon }}</span>
    <span class="ab-label">{{ config.label || actionLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'
import type { ActionType } from '../../types/layoutSchema'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const actionLabel = computed(() => {
  const map: Record<string, string> = { create: '新建', delete: '删除', save: '保存', export: '导出', import: '导入', duplicate: '复制', refresh: '刷新' }
  return map[props.config.action as string] || (props.config.action as string)
})

function onAction() {
  const action = props.config.action as ActionType
  if (action === 'create') {
    const entityType = ctx?.manifest.entityTypes[0]
    if (entityType && ctx) {
      ctx.createEntity(`custom.${ctx.moduleId}.${entityType.name}`, { _name: `新${entityType.label}` })
    }
  } else if (action === 'delete') {
    if (ctx?.selectedEntityId.value) ctx.deleteEntity(ctx.selectedEntityId.value)
  } else {
    ctx?.emit(`action:${action}`)
  }
}
</script>

<style scoped>
.action-btn-renderer { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg); color: var(--text-color); font-size: var(--font-size-sm); cursor: pointer; }
.action-btn-renderer:hover { background: var(--hover-bg); }
.ab-icon { font-size: var(--font-size-base); }
.ab-label { font-weight: var(--font-weight-medium); }
</style>
