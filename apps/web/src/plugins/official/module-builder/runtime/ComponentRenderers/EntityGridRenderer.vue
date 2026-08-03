<template>
  <div class="entity-grid-renderer">
    <WsEmpty v-if="displayList.length === 0" preset="no-data" />
    <div class="eg-grid" :style="gridStyle">
      <div
        v-for="entity in displayList"
        :key="entity.id"
        class="eg-card"
        :class="{ selected: ctx?.selectedEntityId.value === entity.id }"
        @click="onSelect(entity)"
      >
        <span class="eg-icon"><WsIcon :name="entityIcon" size="md" /></span>
        <span class="eg-name">{{ entity.name || '(未命名)' }}</span>
        <div class="eg-fields">
          <span v-for="f in previewFields" :key="f.key" class="eg-field">
            {{ entity.properties[f.key] ?? '—' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const displayList = computed(() => ctx?.filteredList.value || [])

const entityIcon = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  return types.find(t => t.name === props.config.entityType)?.icon || 'manuscript'
})

const previewFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  if (!et) return []
  const show = props.config.previewFields as string[] | undefined
  if (show && show.length > 0) return et.fields.filter(f => show.includes(f.key)).slice(0, 3)
  return et.fields.slice(0, 3)
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.config.columns || 3}, 1fr)`,
}))

function onSelect(entity: any) {
  if (ctx) ctx.selectedEntityId.value = entity.id
}
</script>

<style scoped>
.entity-grid-renderer { overflow-y: auto; height: 100%; padding: 8px; }
.eg-grid { display: grid; gap: 8px; }
.eg-card { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.eg-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.eg-card.selected { border-color: var(--primary); background: rgba(79, 70, 229, 0.08); }
.eg-icon { font-size: var(--font-size-2xl); }
.eg-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--text-color); }
.eg-fields { display: flex; flex-direction: column; gap: 2px; width: 100%; }
.eg-field { font-size: var(--font-size-xs); color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
