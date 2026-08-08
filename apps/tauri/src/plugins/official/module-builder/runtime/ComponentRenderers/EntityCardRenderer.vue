<template>
  <div class="entity-card-renderer" v-if="ctx?.selectedEntity.value">
    <div class="ec-header">
      <span class="ec-icon"><WsIcon :name="entityIcon" size="sm" /></span>
      <h4 class="ec-name">{{ ctx.selectedEntity.value.name }}</h4>
    </div>
    <div class="ec-fields">
      <div v-for="f in displayFields" :key="f.key" class="ec-field">
        <span class="ec-field-label">{{ f.label }}</span>
        <span class="ec-field-value">{{ ctx.selectedEntity.value.properties[f.key] ?? '—' }}</span>
      </div>
    </div>
  </div>
  <div v-else class="ec-empty">选择实体查看卡片</div>
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
  const show = props.config.showFields as string[] | undefined
  if (show && show.length > 0) return et.fields.filter(f => show.includes(f.key))
  return et.fields.slice(0, 5)
})
</script>

<style scoped>
.entity-card-renderer { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--bg); }
.ec-empty { color: var(--text-tertiary); font-size: var(--font-size-sm); text-align: center; padding: 20px; }
.ec-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color); }
.ec-icon { font-size: var(--font-size-xl); }
.ec-name { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); margin: 0; color: var(--text-color); }
.ec-fields { display: flex; flex-direction: column; gap: 6px; }
.ec-field { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ec-field-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.ec-field-value { font-size: var(--font-size-sm); color: var(--text-color); text-align: right; max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
