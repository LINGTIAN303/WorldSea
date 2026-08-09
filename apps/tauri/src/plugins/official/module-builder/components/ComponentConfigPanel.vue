<template>
  <div class="config-panel">
    <h4 class="cp-title">属性面板</h4>
    <div v-if="!selectedComponent" class="cp-empty">
      <p>选择一个组件<br/>在此配置属性</p>
    </div>
    <div v-else class="cp-form">
      <h5 class="cp-comp-name">{{ compDef?.label || selectedComponent.type }}</h5>
      <div v-for="field in compDef?.configSchema || []" :key="field.key" class="cp-field">
        <label class="cp-field-label">{{ field.label }}</label>
        <input v-if="field.type === 'text'" class="cp-input" v-model="config[field.key]" @input="onConfigChange" />
        <input v-else-if="field.type === 'number'" class="cp-input" type="number" v-model.number="config[field.key]" @input="onConfigChange" />
        <label v-else-if="field.type === 'boolean'" class="cp-toggle"><input type="checkbox" v-model="config[field.key]" @change="onConfigChange" /> {{ field.label }}</label>
        <select v-else-if="field.type === 'select'" class="cp-select" v-model="config[field.key]" @change="onConfigChange">
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <select v-else-if="field.type === 'multiselect'" class="cp-select" multiple v-model="config[field.key]" @change="onConfigChange">
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <select v-else-if="field.type === 'entity-type-ref'" class="cp-select" v-model="config[field.key]" @change="onConfigChange">
          <option value="">-- 选择 --</option>
          <option v-for="et in entityTypeOptions" :key="et.value" :value="et.value">{{ et.label }}</option>
        </select>
        <select v-else-if="field.type === 'field-ref'" class="cp-select" v-model="config[field.key]" @change="onConfigChange">
          <option value="">-- 选择字段 --</option>
          <option v-for="f in fieldRefOptions(config.entityType as string || '')" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </div>
      <div v-if="linkableComponents.length > 0" class="cp-link-section">
        <label class="cp-field-label">联动目标</label>
        <div v-for="lc in linkableComponents" :key="lc.id" class="cp-link-item">
          <label class="cp-toggle">
            <input type="checkbox" :checked="isLinked(lc.id)" @change="toggleLink(lc.id)" />
            <WsIcon :name="lc.icon" size="xs" /> {{ lc.label }}
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { PlacedComponent } from '../types/layoutSchema'
import { getComponentType } from '../registry/componentTypeRegistry'
import type { CustomModule } from '@worldsmith/entity-core'

const LINKABLE_PAIRS: Record<string, string[]> = {
  'search-box': ['entity-list', 'entity-grid', 'entity-table', 'kanban-board'],
  'filter-bar': ['entity-list', 'entity-grid', 'entity-table', 'kanban-board'],
  'sort-control': ['entity-list', 'entity-grid', 'entity-table'],
  'entity-list': ['detail-panel', 'edit-form'],
  'entity-grid': ['detail-panel', 'edit-form'],
  'entity-table': ['detail-panel', 'edit-form'],
  'kanban-board': ['detail-panel'],
  'entity-card': ['detail-panel'],
}

const props = defineProps<{
  selectedComponent: PlacedComponent | null
}>()

const emit = defineEmits<{
  'update-config': [componentId: string, config: Record<string, unknown>]
}>()

const module = inject<CustomModule>('module', { id: '', name: '', icon: 'settings', description: '', entityTypes: [], relationTypes: [], views: [], createdAt: '', updatedAt: '' })

const compDef = computed(() => props.selectedComponent ? getComponentType(props.selectedComponent.type) : null)

const entityTypeOptions = computed(() => module.entityTypes.map(et => ({ value: et.name, label: et.label || et.name })))

function fieldRefOptions(entityType: string) {
  const et = module.entityTypes.find(e => e.name === entityType)
  return (et?.fields || []).map(f => ({ value: f.key, label: f.label || f.key }))
}

const config = reactive<Record<string, unknown>>({})

const allComponents = computed(() => {
  return (module as any).layoutSchema?.components || []
})

const linkableComponents = computed(() => {
  if (!props.selectedComponent) return []
  const allowedTypes = LINKABLE_PAIRS[props.selectedComponent.type]
  if (!allowedTypes) return []
  return allComponents.value
    .filter((c: PlacedComponent) => c.id !== props.selectedComponent!.id && allowedTypes.includes(c.type))
    .map((c: PlacedComponent) => ({
      id: c.id,
      type: c.type,
      label: getComponentType(c.type)?.label || c.type,
      icon: getComponentType(c.type)?.icon || 'item',
    }))
})

function isLinked(targetId: string): boolean {
  return (props.selectedComponent?.linkTo || []).includes(targetId)
}

function toggleLink(targetId: string) {
  if (!props.selectedComponent) return
  const links = [...(props.selectedComponent.linkTo || [])]
  const idx = links.indexOf(targetId)
  if (idx >= 0) links.splice(idx, 1)
  else links.push(targetId)
  props.selectedComponent.linkTo = links
}

watch(() => props.selectedComponent, (comp) => {
  Object.keys(config).forEach(k => delete config[k])
  if (comp) Object.assign(config, { ...comp.config })
}, { immediate: true })

function onConfigChange() {
  if (props.selectedComponent) {
    emit('update-config', props.selectedComponent.id, { ...config })
  }
}
</script>

<style scoped>
.config-panel { width: 280px; border-left: 1px solid var(--border-color); padding: 12px; overflow-y: auto; flex-shrink: 0; }
.cp-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 12px; }
.cp-empty { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-tertiary); font-size: var(--font-size-sm); text-align: center; }
.cp-form { display: flex; flex-direction: column; gap: 8px; }
.cp-comp-name { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0 0 8px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
.cp-field { display: flex; flex-direction: column; gap: 3px; }
.cp-field-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.cp-input, .cp-select { padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
.cp-toggle { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); }
.cp-link-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
.cp-link-item { padding: 3px 0; }
</style>
