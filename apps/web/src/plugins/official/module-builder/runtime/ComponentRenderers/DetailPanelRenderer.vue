<template>
  <div class="detail-panel-renderer">
    <div v-if="!ctx?.selectedEntity.value" class="dp-empty">
      <span class="dp-empty-icon"><WsIcon name="outline" size="xl" /></span>
      <p>选择一个实体查看详情</p>
    </div>
    <template v-else>
      <div class="dp-header">
        <span class="dp-icon"><WsIcon :name="entityIcon" size="md" /></span>
        <h3 class="dp-name">{{ ctx.selectedEntity.value.name }}</h3>
      </div>
      <div class="dp-fields">
        <div v-for="f in displayFields" :key="f.key" class="dp-field">
          <label class="dp-field-label">{{ f.label }}</label>
          <span class="dp-field-value">{{ ctx.selectedEntity.value.properties[f.key] ?? '—' }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const entityIcon = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  return types.find(t => t.name === props.config.entityType)?.icon || 'manuscript'
})

const displayFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  if (!et) return []
  const showFields = props.config.showFields as string[] | undefined
  if (showFields && showFields.length > 0) {
    return et.fields.filter(f => showFields.includes(f.key))
  }
  return et.fields
})
</script>

<style scoped>
.detail-panel-renderer { padding: 16px; height: 100%; overflow-y: auto; }
.dp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); gap: 8px; }
.dp-empty-icon { font-size: var(--font-size-3xl); }
.dp-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); }
.dp-icon { font-size: var(--font-size-2xl); }
.dp-name { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 0; }
.dp-fields { display: flex; flex-direction: column; gap: 10px; }
.dp-field { display: flex; flex-direction: column; gap: 2px; }
.dp-field-label { font-size: var(--font-size-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.dp-field-value { font-size: var(--font-size-base); color: var(--text-color); }
</style>
