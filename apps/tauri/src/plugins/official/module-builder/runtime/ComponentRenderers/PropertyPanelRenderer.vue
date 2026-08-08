<template>
  <div class="property-panel-renderer">
    <div v-if="!ctx?.selectedEntity.value" class="pp-empty">选择实体查看属性</div>
    <template v-else>
      <div v-for="f in displayFields" :key="f.key" class="pp-row">
        <span class="pp-label">{{ f.label }}</span>
        <input
          class="pp-value"
          :value="ctx.selectedEntity.value.properties[f.key] ?? ''"
          @change="onFieldChange(f.key, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const displayFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  if (!et) return []
  const fields = props.config.fields as string[] | undefined
  if (fields && fields.length > 0) return et.fields.filter(f => fields.includes(f.key))
  return et.fields
})

function onFieldChange(key: string, value: string) {
  if (ctx?.selectedEntityId.value) {
    ctx.updateEntity(ctx.selectedEntityId.value, { [key]: value })
  }
}
</script>

<style scoped>
.property-panel-renderer { padding: 12px; }
.pp-empty { color: var(--text-tertiary); font-size: var(--font-size-sm); text-align: center; padding: 20px; }
.pp-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.pp-label { font-size: var(--font-size-sm); color: var(--text-tertiary); min-width: 80px; flex-shrink: 0; }
.pp-value { flex: 1; padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 3px; font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
</style>
