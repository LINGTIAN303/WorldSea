<template>
  <div v-if="modelValue" class="efm-overlay" @click.self="close">
    <div class="efm-box" ref="boxRef" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="efm-header">
        <h3>{{ title }}</h3>
        <button class="efm-close" @click="close">✕</button>
      </div>
      <div class="efm-preset-bar">
        <span class="efm-preset-label">布局：</span>
        <CustomDropdown v-model="activePreset" :options="presetOptions" />
        <span class="efm-preset-hint">切换即按该预设重排字段；新建或删除预设请到设置「实体详情」</span>
      </div>
      <div class="efm-body">
        <div
          v-for="(field, i) in sortedFields"
          :key="field.key"
          class="efm-field"
          :class="{ 'efm-field-full': isFullWidth(field.type), 'efm-drag-over': dragOverIdx === i }"
          draggable="true"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent="onDragOver(i)"
          @dragleave="onDragLeave"
          @drop="onDrop(i)"
        >
          <label><WsIcon name="grip" size="xs" class="efm-drag-handle" /> {{ field.label }}<span v-if="field.required" class="efm-required">*</span><button v-if="field.source && field.source !== 'builtin'" class="efm-field-del" @click="removeField(field.key)" title="删除此字段">✕</button></label>
          <slot
            name="field"
            :field="field"
            :value="formData[field.key]"
            :set="(val: any) => { formData[field.key] = val; onFieldInput(field) }"
            :form="formData"
          >
            <FieldControl
              :value="formData[field.key]"
              :raw-type="field.type"
              :label="field.label"
              :editing="true"
              :options="field.options"
              :placeholder="field.placeholder"
              :ref-type="field.refType"
              :entity-id="entity?.id"
              :cover-position="String(formData._coverPosition ?? '')"
              :cover-zoom="Number(formData._coverZoom) || 1"
              @update:value="val => { formData[field.key] = val; onFieldInput(field) }"
              @update:cover-position="val => formData._coverPosition = val"
              @update:cover-zoom="val => formData._coverZoom = val"
            />
          </slot>
        </div>
        <div class="efm-add-field">
          <button v-if="!showAddField" class="efm-add-btn" @click="showAddField = true">＋ 添加字段</button>
          <div v-else class="efm-adder">
            <input v-model="newFieldKey" class="efm-adder-input" placeholder="字段 key（英文）" aria-label="字段 key" />
            <input v-model="newFieldLabel" class="efm-adder-input" placeholder="显示名" aria-label="显示名" />
            <select v-model="newFieldType" class="efm-adder-type" aria-label="字段类型">
              <option value="text">文本</option>
              <option value="textarea">长文本</option>
              <option value="number">数字</option>
              <option value="boolean">开关</option>
              <option value="date">日期</option>
              <option value="select">选项</option>
              <option value="color">颜色</option>
            </select>
            <input v-if="newFieldType === 'select'" v-model="newFieldOptions" class="efm-adder-input" placeholder="选项（逗号分隔）" aria-label="选项" />
            <button class="efm-adder-ok" @click="confirmAddField">确定</button>
            <button class="efm-adder-cancel" @click="cancelAddField">取消</button>
          </div>
        </div>
      </div>
      <div v-if="nameError" class="efm-error">{{ nameError }}</div>
      <div class="efm-footer">
        <div class="efm-footer-spacer"></div>
        <button class="efm-btn efm-btn-cancel" @click="close">取消</button>
        <button class="efm-btn efm-btn-save" @click="save">保存</button>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResizable } from '../composables'
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { WsIcon, useModalShortcuts } from '@worldsea/ui-kit'
import CustomDropdown from './CustomDropdown.vue'
import FieldControl from '../detail/FieldControl.vue'
import { useFieldOrderStore, useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'

import type { FormFieldDef } from './types'
import { useFieldPresets } from './entity/useFieldPresets'
import { useDynamicForm } from './entity/useDynamicForm'
import { useEntityFormSave } from './entity/useEntityFormSave'

const modalResizable = useResizable({ panelId: 'modal-entity-form', defaultWidth: 560, minWidth: 320, side: 'right' })

const boxRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// 焦点陷阱：Tab 仅在弹窗内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Tab') {
    const box = boxRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

const props = defineProps<{
  modelValue: boolean
  title: string
  entity: Entity | null
  fields: FormFieldDef[]
  entityType: string
  /** 新建时的预填属性（仅 entity 为空时生效） */
  preset?: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _entityRefFields?: FormFieldDef[]; _autoLinkFields?: FormFieldDef[]; _coverPosition?: string; _coverZoom?: number }]
}>()

// Esc 关闭收编 useModalShortcuts（modal 层；修复 view 层命中消费阻断弹窗 Esc）。
// 【顺序约束】必须在 props 声明之后——组合器的 watch immediate 会同步求值 getter，
// 放在 props 前会触发 TDZ ReferenceError 使 setup 抛错、Vue 渲染树损坏（踩坑复盘教训）。
useModalShortcuts(() => props.modelValue, { id: 'entity-form.close', onEscape: () => close() })

const fieldOrderStore = useFieldOrderStore()
const entityStore = useEntityStore()

// ── 字段与预设 ─────────────────────────────────────────────────────────
const presets = useFieldPresets({
  fields: () => props.fields,
  entityType: () => props.entityType,
  entity: () => props.entity,
  fieldOrderStore,
  getFormData: () => form.formData,
})
const {
  sortedFields, resolvedEntityType, activePreset, presetOptions, isFullWidth,
  dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop,
  showAddField, newFieldKey, newFieldLabel, newFieldType, newFieldOptions,
  confirmAddField, cancelAddField, removeField,
} = presets

// ── 动态表单 ───────────────────────────────────────────────────────────
const form = useDynamicForm({
  entity: () => props.entity,
  sortedFields,
  resolvedEntityType,
  preset: () => props.preset ?? null,
})
const { formData, nameError, initFormData, onFieldInput } = form

// ── 保存 ────────────────────────────────────────────────────────────────
const { save, syncEntityRefAfterCreate } = useEntityFormSave({
  formData,
  nameError,
  sortedFields,
  entityStore,
  entity: () => props.entity,
  emit,
})

// ── 编排：打开弹窗时初始化表单与预设 ───────────────────────────────────
watch(() => props.modelValue, (v) => {
  if (v) {
    initFormData()
    activePreset.value = fieldOrderStore.getActivePreset(resolvedEntityType.value)
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const first =
        boxRef.value?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? boxRef.value
      first?.focus({ preventScroll: true })
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
}, { immediate: true })

function close() {
  nameError.value = ''
  emit('update:modelValue', false)
}

defineExpose({ syncEntityRefAfterCreate })

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.efm-overlay {
  position: fixed;
  inset: var(--titlebar-height, 32px) 0 0 0;
  z-index: 99998;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.efm-box {
  background: var(--sf-overlay-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-xl) * var(--sf-radius-scale));
  padding: 28px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--sf-overlay-shadow), inset 0 1px 0 var(--sf-highlight);
  backdrop-filter: var(--sf-overlay-filter, none);
  position: relative;
}
.efm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.efm-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--accent);
}
.efm-close {
  background: none;
  border: none;
  font-size: var(--font-size-lg);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.efm-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
.efm-preset-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-tertiary, var(--color-bg-elevated));
  border-radius: 6px;
  margin-bottom: 8px;
}
.efm-preset-label { font-size: var(--font-size-sm); color: var(--text-secondary); white-space: nowrap; }
.efm-preset-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
.efm-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.efm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background 0.15s, box-shadow 0.15s;
  border-radius: var(--radius-sm);
  padding: 4px;
}
.efm-field.efm-drag-over {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  box-shadow: 0 0 0 2px var(--accent) inset;
}
.efm-field-full {
  grid-column: 1 / -1;
}
.efm-field label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}
.efm-drag-handle {
  cursor: grab;
  opacity: 0.3;
  transition: opacity 0.15s;
  user-select: none;
  font-size: var(--font-size-base);
  letter-spacing: -1px;
}
.efm-drag-handle:hover {
  opacity: 0.8;
}
.efm-field:active .efm-drag-handle {
  cursor: grabbing;
}
.efm-required {
  color: var(--danger);
  margin-left: 2px;
}
.efm-field-del { background: none; border: none; color: var(--danger, var(--color-danger)); font-size: var(--font-size-xs); cursor: pointer; padding: 0 2px; margin-left: 4px; opacity: 0.3; transition: opacity 0.15s; }
.efm-field-del:hover { opacity: 1; }
.efm-footer-spacer {
  flex: 1;
}
.efm-field input:not([type="checkbox"]):not([type="color"]):not([type="date"]),
.efm-field textarea,
.efm-field select {
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  color: var(--text-color);
  background: var(--input-bg);
  outline: none;
}
.efm-field input:not([type="checkbox"]):not([type="color"]):focus,
.efm-field textarea:focus,
.efm-field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.efm-field input[type="color"] {
  width: 48px;
  height: 36px;
  padding: 2px;
  cursor: pointer;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
}
.efm-field input[type="date"] {
  color-scheme: dark;
}
.efm-error {
  color: var(--danger);
  font-size: var(--font-size-sm);
  margin-top: 8px;
}
.efm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.efm-btn {
  padding: 7px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  border: 1px solid var(--border);
}
.efm-btn-cancel {
  background: var(--bg-tertiary);
  color: var(--color-text-tertiary);
}
.efm-btn-cancel:hover {
  background: var(--border);
}
.efm-btn-save {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}
.efm-btn-save:hover {
  background: var(--color-primary-hover);
}
.efm-add-field { grid-column: 1 / -1; margin-top: 4px; }
.efm-add-btn { font-size: var(--font-size-sm); padding: 4px 12px; background: none; border: 1px dashed var(--border); border-radius: 4px; cursor: pointer; color: var(--text-tertiary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.efm-add-btn:hover { border-color: var(--accent); color: var(--accent); }
.efm-adder { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.efm-adder-input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text); max-width: 120px; }
.efm-adder-type { padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text); }
.efm-adder-ok { padding: 4px 12px; background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; font-size: var(--font-size-sm); cursor: pointer; }
.efm-adder-ok:hover { background: var(--accent); color: var(--color-text-inverse); }
.efm-adder-cancel { padding: 4px 12px; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-sm); cursor: pointer; }

.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
