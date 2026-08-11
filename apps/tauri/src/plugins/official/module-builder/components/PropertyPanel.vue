<template>
  <div class="property-panel">
    <h4 class="pp-title">属性</h4>
    <div v-if="!selectedComponent" class="pp-empty">选择一个组件<br/>在此配置属性</div>
    <div v-else class="pp-form">
      <h5 class="pp-name">{{ compDef?.label || selectedComponent.type }}</h5>
      <div v-for="field in compDef?.configSchema || []" :key="field.key" class="pp-field">
        <label class="pp-label">{{ field.label }}</label>
        <input v-if="field.type === 'text'" class="pp-input" v-model="config[field.key]" @input="onChange" />
        <input v-else-if="field.type === 'number'" class="pp-input" type="number" v-model.number="config[field.key]" @input="onChange" />
        <label v-else-if="field.type === 'boolean'" class="pp-toggle"><input type="checkbox" v-model="config[field.key]" @change="onChange" /> {{ field.label }}</label>
        <select v-else-if="field.type === 'select'" class="pp-input" v-model="config[field.key]" @change="onChange">
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <select v-else-if="field.type === 'multiselect'" class="pp-input" multiple v-model="config[field.key]" @change="onChange">
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <select v-else-if="field.type === 'entity-type-ref'" class="pp-input" v-model="config[field.key]" @change="onChange">
          <option value="">-- 选择 --</option>
          <option v-for="et in entityTypeOptions" :key="et.value" :value="et.value">{{ et.label }}</option>
        </select>
        <select v-else-if="field.type === 'field-ref'" class="pp-input" v-model="config[field.key]" @change="onChange">
          <option value="">-- 选择字段 --</option>
          <option v-for="f in fieldRefOptions(config.entityType as string || '')" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch, inject } from 'vue'
import { getComponentType } from '../registry/componentTypeRegistry'
import type { PlacedComponent } from '../types/layoutSchema'
import type { CustomModule } from '@worldsmith/entity-core'

const props = defineProps<{ selectedComponent: PlacedComponent | null }>()
const emit = defineEmits<{ 'update-config': [id: string, config: Record<string, unknown>] }>()

const module = inject<CustomModule>('module', {
  id: '', name: '', icon: 'settings', description: '', entityTypes: [], relationTypes: [], views: [], createdAt: '', updatedAt: '',
})

const compDef = computed(() => props.selectedComponent ? getComponentType(props.selectedComponent.type) : null)
const entityTypeOptions = computed(() => module.entityTypes.map(et => ({ value: et.name, label: et.label || et.name })))

function fieldRefOptions(entityType: string) {
  const et = module.entityTypes.find(e => e.name === entityType)
  return (et?.fields || []).map(f => ({ value: f.key, label: f.label || f.key }))
}

const config = reactive<Record<string, unknown>>({})
watch(() => props.selectedComponent, (comp) => {
  Object.keys(config).forEach(k => delete config[k])
  if (comp) Object.assign(config, { ...comp.config })
}, { immediate: true })

function onChange() {
  if (props.selectedComponent) emit('update-config', props.selectedComponent.id, { ...config })
}
</script>

<style scoped>
.property-panel { display: flex; flex-direction: column; }
.pp-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 8px; }
.pp-empty { color: var(--text-tertiary); font-size: var(--font-size-sm); text-align: center; padding: 20px; line-height: 1.5; }
.pp-form { display: flex; flex-direction: column; gap: 8px; }
.pp-name { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0 0 4px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
.pp-field { display: flex; flex-direction: column; gap: 3px; }
.pp-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.pp-input { padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
.pp-toggle { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); }
</style>