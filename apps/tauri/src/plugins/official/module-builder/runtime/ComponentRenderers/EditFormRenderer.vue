<template>
  <div class="edit-form-renderer">
    <h4 class="ef-title">{{ formTitle }}</h4>
    <div class="ef-fields" :class="[`ef-layout-${config.layout || 'vertical'}`]">
      <div v-for="f in formFields" :key="f.key" class="ef-field">
        <label class="ef-label">{{ f.label }}</label>
        <input
          v-if="isSimpleInput(f.type)"
          class="ef-input"
          :type="inputType(f.type)"
          :value="fieldValue(f.key)"
          @input="onFieldInput(f.key, ($event.target as HTMLInputElement).value)"
        />
        <textarea
          v-else-if="f.type === 'textarea' || f.type === 'rich-text' || f.type === 'markdown'"
          class="ef-textarea"
          :value="fieldValue(f.key)"
          @input="onFieldInput(f.key, ($event.target as HTMLTextAreaElement).value)"
        />
        <select
          v-else-if="f.type === 'select'"
          class="ef-select"
          :value="fieldValue(f.key)"
          @change="onFieldInput(f.key, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in (f.options || [])" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <label v-else-if="f.type === 'boolean'" class="ef-checkbox">
          <input type="checkbox" :checked="!!formData[f.key]" @change="onFieldInput(f.key, ($event.target as HTMLInputElement).checked)" />
          {{ f.label }}
        </label>
      </div>
    </div>
    <div class="ef-actions">
      <button class="ef-btn ef-btn-primary" @click="onSave">保存</button>
      <button class="ef-btn ef-btn-ghost" @click="onReset">重置</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, inject, watch } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const formTitle = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  return et ? `编辑${et.label}` : '编辑表单'
})

const formFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  return et?.fields || []
})

const formData = reactive<Record<string, unknown>>({})

/** 将 formData 中的 unknown 值转为 input/textarea 可接受的 string */
function fieldValue(key: string): string {
  const v = formData[key]
  return v == null ? '' : String(v)
}

function isSimpleInput(type: string) {
  return ['text', 'number', 'date', 'time', 'datetime', 'url', 'email', 'color', 'rating', 'slider'].includes(type)
}

function inputType(type: string) {
  const map: Record<string, string> = { number: 'number', date: 'date', time: 'time', email: 'email', url: 'url', color: 'color' }
  return map[type] || 'text'
}

function onFieldInput(key: string, value: unknown) {
  formData[key] = value
}

function onSave() {
  if (ctx?.selectedEntityId.value) {
    ctx.updateEntity(ctx.selectedEntityId.value, { ...formData })
  }
}

function onReset() {
  if (ctx?.selectedEntity.value) {
    Object.keys(formData).forEach(k => delete formData[k])
    Object.assign(formData, { ...ctx.selectedEntity.value.properties })
  }
}

watch(() => ctx?.selectedEntity.value, (entity) => {
  Object.keys(formData).forEach(k => delete formData[k])
  if (entity) Object.assign(formData, { ...entity.properties })
}, { immediate: true })
</script>

<style scoped>
.edit-form-renderer { padding: 16px; }
.ef-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); margin: 0 0 12px; color: var(--text-secondary); }
.ef-fields { display: flex; flex-direction: column; gap: 10px; }
.ef-layout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ef-field { display: flex; flex-direction: column; gap: 3px; }
.ef-label { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.ef-input, .ef-textarea, .ef-select { padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
.ef-textarea { min-height: 60px; resize: vertical; }
.ef-checkbox { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); }
.ef-actions { display: flex; gap: 8px; margin-top: 16px; }
.ef-btn { padding: 6px 14px; border-radius: 4px; font-size: var(--font-size-sm); cursor: pointer; border: none; }
.ef-btn-primary { background: var(--primary); color: var(--on-accent); }
.ef-btn-ghost { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); }
</style>
