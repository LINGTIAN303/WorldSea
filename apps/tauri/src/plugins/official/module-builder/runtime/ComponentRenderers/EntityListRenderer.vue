<template>
  <div class="entity-list-renderer">
    <WsEmpty v-if="displayList.length === 0" preset="no-data" />
    <div
      v-for="entity in displayList"
      :key="entity.id"
      class="el-item"
      :class="{ selected: ctx?.selectedEntityId.value === entity.id }"
      @click="onSelect(entity)"
    >
      <span class="el-icon"><WsIcon :name="entityIcon" size="sm" /></span>
      <div class="el-info">
        <span class="el-name">{{ entity.name || '(未命名)' }}</span>
        <span v-if="config.showDescription" class="el-desc">{{ entity.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const displayList = computed(() => ctx?.getFilteredByType(props.config.entityType as string) || [])

const entityIcon = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  return types.find(t => t.name === props.config.entityType)?.icon || 'manuscript'
})

function onSelect(entity: any) {
  if (ctx) ctx.selectedEntityId.value = entity.id
}
</script>

<style scoped>
.entity-list-renderer { display: flex; flex-direction: column; overflow-y: auto; height: 100%; }
.el-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background 0.1s; }
.el-item:hover { background: var(--hover-bg); }
.el-item.selected { background: var(--accent-soft, rgba(79, 70, 229, 0.08)); border-left: 3px solid var(--primary); }
.el-icon { font-size: var(--font-size-xl); flex-shrink: 0; }
.el-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.el-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.el-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
