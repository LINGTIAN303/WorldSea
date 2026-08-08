<template>
  <div class="toolbar-renderer">
    <template v-for="action in actions" :key="action">
      <button class="tb-btn" @click="onAction(action)">{{ actionLabel(action) }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'
import type { ActionType } from '../../types/layoutSchema'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const actions = computed(() => (props.config.actions as ActionType[]) || [])

function actionLabel(action: string): string {
  const map: Record<string, string> = { create: '新建', delete: '删除', save: '保存', export: '导出', import: '导入', duplicate: '复制', refresh: '刷新' }
  return map[action] || action
}

function onAction(action: string) {
  const type = action as ActionType
  if (type === 'create') {
    const entityType = ctx?.manifest.entityTypes[0]
    if (entityType && ctx) {
      const fullType = `custom.${ctx.moduleId}.${entityType.name}`
      ctx.createEntity(fullType, { _name: `新${entityType.label}` })
    }
  } else if (type === 'delete') {
    if (ctx?.selectedEntityId.value) ctx.deleteEntity(ctx.selectedEntityId.value)
  } else if (type === 'save') {
    ctx?.emit('action:save')
  } else if (type === 'refresh') {
    const entityType = ctx?.manifest.entityTypes[0]
    if (entityType && ctx) {
      ctx.getEntitiesByType(`custom.${ctx.moduleId}.${entityType.name}`)
    }
  } else {
    ctx?.emit(`action:${type}`)
  }
}
</script>

<style scoped>
.toolbar-renderer { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
.tb-btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg); color: var(--text-color); font-size: var(--font-size-sm); cursor: pointer; }
.tb-btn:hover { background: var(--hover-bg); }
</style>
