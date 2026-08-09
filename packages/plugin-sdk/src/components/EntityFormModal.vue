<template>
  <div v-if="modelValue" class="efm-overlay" @click.self="close">
    <div class="efm-box" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="efm-header">
        <h3>{{ title }}</h3>
        <button class="efm-close" @click="close">✕</button>
      </div>
      <div class="efm-preset-bar">
        <span class="efm-preset-label">布局：</span>
        <CustomDropdown v-model="activePreset" :options="presetOptions" />
        <button class="efm-preset-btn efm-preset-save" @click="saveCurrentPreset" title="保存当前布局"><WsIcon name="check" size="xs" /> 保存</button>
        <button class="efm-preset-btn efm-preset-apply" @click="applyCurrentPreset" title="应用此布局"><WsIcon name="arrow-up" size="xs" /> 使用</button>
        <button class="efm-preset-btn efm-preset-delete" v-if="activePreset !== '默认'" @click="deleteCurrentPreset" title="删除此布局"><WsIcon name="delete" size="xs" /></button>
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
          @mouseenter="onFieldMouseEnter(field.key)"
          @mouseleave="onFieldMouseLeave(field.key)"
        >
          <label><WsIcon name="grip" size="xs" class="efm-drag-handle" /> {{ field.label }}<span v-if="field.required" class="efm-required">*</span><button v-if="isSparkleVisible(field)" class="efm-smart-fill-btn" @click="onSmartFillClick(field)" title="AI 建议">✨</button><button v-if="field.source && field.source !== 'builtin'" class="efm-field-del" @click="removeField(field.key)" title="删除此字段">✕</button></label>
          <div v-if="field.type === 'text'" class="efm-input-wrap">
            <input v-model="formData[field.key]" :placeholder="field.placeholder" :aria-label="field.label" @input="onFieldInput(field)" @focus="onFieldFocus(field.key); onFieldFocusForTrigger(field, $event)" @blur="onFieldBlur(field.key); onFieldBlurForTrigger(field)" @keydown="onFieldKeydown(field, $event)" />
            <SmartFillGhostText v-if="isSmartFillField(field) && ghostVisible && ghostFieldKey === field.key" :visible="true" :suggestion="ghostText" :current-text="formData[field.key] || ''" />
          </div>
          <div v-else-if="field.type === 'textarea'" class="efm-input-wrap">
            <textarea v-model="formData[field.key]" :rows="field.rows || 3" :placeholder="field.placeholder" :aria-label="field.label" @input="onFieldInput(field)" @focus="onFieldFocus(field.key); onFieldFocusForTrigger(field, $event)" @blur="onFieldBlur(field.key); onFieldBlurForTrigger(field)" @keydown="onFieldKeydown(field, $event)"></textarea>
            <SmartFillGhostText v-if="isSmartFillField(field) && ghostVisible && ghostFieldKey === field.key" :visible="true" :suggestion="ghostText" :current-text="formData[field.key] || ''" />
          </div>
          <div v-else-if="field.type === 'richtext'" class="efm-richtext-wrap">
            <RichTextEditor v-model="formData[field.key]" />
            <button v-if="isSparkleVisible(field)" class="efm-smart-fill-inline" @click="onSmartFillClick(field)" title="AI 建议">✨</button>
          </div>
          <CustomDropdown v-else-if="field.type === 'select'" :model-value="formData[field.key]" @update:model-value="formData[field.key] = $event" :options="[{ value: '', label: '—' }, ...(field.options || [])]" />
          <input v-else-if="field.type === 'tags'" v-model="formData[field.key]" placeholder="逗号分隔" :aria-label="field.label" />
          <input v-else-if="field.type === 'color'" type="color" v-model="formData[field.key]" :aria-label="field.label" />
          <input v-else-if="field.type === 'number'" type="number" v-model="formData[field.key]" :aria-label="field.label" />
          <input v-else-if="field.type === 'boolean'" type="checkbox" v-model="formData[field.key]" :aria-label="field.label" />
          <input v-else-if="field.type === 'date'" type="date" v-model="formData[field.key]" :aria-label="field.label" />
          <div v-else-if="field.type === 'entityRef'" class="efm-eref">
            <input v-model="formData[field.key]" :placeholder="field.placeholder || '搜索实体...'" :aria-label="field.label"
              @focus="openEntityRef(field)" @input="onEntityRefSearch(field)" />
            <div v-if="activeEntityRef === field.key && entityRefResults.length > 0" class="efm-eref-dropdown">
              <div v-for="item in entityRefResults" :key="item.id" class="efm-eref-opt"
                @click="selectEntityRef(field, item.name)">
                <WsIcon class="efm-eref-icon" :name="item.iconName" size="xs" />
                <span class="efm-eref-name">{{ item.name }}</span>
                <span class="efm-eref-type">{{ item.typeLabel }}</span>
              </div>
            </div>
          </div>
          <ImageField
            v-else-if="field.type === 'image'"
            :value="formData[field.key]"
            :editing="true"
            :entity-id="entity?.id"
            :cover-position="entity?.coverPosition"
            :cover-zoom="entity?.coverZoom"
          @update:value="formData[field.key] = String($event)"
          @update:cover-position="formData._coverPosition = $event"
          @update:cover-zoom="formData._coverZoom = String($event)"
          />
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
      <EmptyFieldHint
        :visible="showEmptyFieldHint"
        @click="onSmartFillAll"
      />
      <FieldFocusTrigger
        :visible="focusTriggerVisible"
        :field-rect="focusTriggerRect"
        @click="onFieldFocusTriggerClick"
      />
      <div v-if="nameError" class="efm-error">{{ nameError }}</div>
      <div class="efm-footer">
        <button class="efm-btn efm-btn-smart-fill" @click="onSmartFillAll" title="为所有空字段生成 AI 建议">✨ AI 智能填充</button>
        <div class="efm-footer-spacer"></div>
        <button class="efm-btn efm-btn-cancel" @click="close">取消</button>
        <button class="efm-btn efm-btn-save" @click="save">保存</button>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
    <!-- Smart Fill 预览面板 -->
    <SmartFillPreview
      :visible="smartFillPreview.visible"
      :current-fields="smartFillPreview.currentFields"
      :suggestions="smartFillPreview.suggestions"
      :field-labels="smartFillPreview.fieldLabels"
      :accepted="smartFillPreview.accepted"
      :rejected="smartFillPreviewRejected"
      :include-existing="smartFillIncludeExisting"
      @close="onSmartFillPreviewClose"
      @accept="onSmartFillPreviewAccept"
      @reject="onSmartFillPreviewReject"
      @accept-all="onSmartFillPreviewAcceptAll"
      @reject-all="onSmartFillPreviewRejectAll"
      @apply="onSmartFillPreviewApply"
      @toggle-include-existing="onToggleIncludeExisting"
    />
  </div>
</template>

<script setup lang="ts">
import { toastSuccess, toastWarn } from '@worldsmith/ui-kit'
import { useDialog, useResizable } from '../composables'
import { ref, watch, computed, reactive, onUnmounted } from 'vue'
import { RichTextEditor, WsIcon } from '@worldsmith/ui-kit'
import CustomDropdown from './CustomDropdown.vue'
import ImageField from './ImageField.vue'
import SmartFillGhostText from './SmartFillGhostText.vue'
import SmartFillPreview from './SmartFillPreview.vue'
import EmptyFieldHint from './EmptyFieldHint.vue'
import FieldFocusTrigger from './FieldFocusTrigger.vue'
import { useFieldOrderStore, useEntityStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'

import type { FormFieldDef } from './types'
import { useFieldPresets } from './entity/useFieldPresets'
import { useDynamicForm } from './entity/useDynamicForm'
import { useEntityRefSearch } from './entity/useEntityRefSearch'
import { useEntityFormSave } from './entity/useEntityFormSave'

const modalResizable = useResizable({ panelId: 'modal-entity-form', defaultWidth: 560, minWidth: 320, side: 'right' })

const props = defineProps<{
  modelValue: boolean
  title: string
  entity: Entity | null
  fields: FormFieldDef[]
  entityType: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _entityRefFields?: FormFieldDef[]; _autoLinkFields?: FormFieldDef[]; _coverPosition?: string; _coverZoom?: number }]
}>()

const fieldOrderStore = useFieldOrderStore()
const dialog = useDialog()
const entityStore = useEntityStore()

// ── Smart Fill 基础状态（完整逻辑见下方 Smart Fill 区块；refs 提前声明供 useDynamicForm 依赖注入）──
const SMART_FILL_TYPES = new Set(['text', 'textarea', 'richtext'])
const focusedFieldKey = ref<string | null>(null)
const hoveredFieldKey = ref<string | null>(null)
const ghostText = ref('')
const ghostFieldKey = ref('')
const ghostVisible = ref(false)
const focusTriggerVisible = ref(false)
const focusTriggerRect = ref<DOMRect | null>(null)
const focusTriggerFieldKey = ref<string | null>(null)

function isSmartFillField(field: FormFieldDef): boolean {
  if (field.smartFill === false) return false
  return SMART_FILL_TYPES.has(field.type)
}

// ── 字段与预设 ─────────────────────────────────────────────────────────
const presets = useFieldPresets({
  fields: () => props.fields,
  entityType: () => props.entityType,
  entity: () => props.entity,
  fieldOrderStore,
  dialog,
  getFormData: () => form.formData,
})
const {
  sortedFields, resolvedEntityType, activePreset, presetOptions, isFullWidth,
  dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop,
  saveCurrentPreset, applyCurrentPreset, deleteCurrentPreset,
  showAddField, newFieldKey, newFieldLabel, newFieldType, newFieldOptions,
  confirmAddField, cancelAddField, removeField,
} = presets

// ── 动态表单 ───────────────────────────────────────────────────────────
const form = useDynamicForm({
  entity: () => props.entity,
  sortedFields,
  resolvedEntityType,
  isSmartFillField,
  ghostVisible,
})
const { formData, nameError, initFormData, onFieldInput } = form

// ── 实体引用搜索 ───────────────────────────────────────────────────────
const { activeEntityRef, entityRefResults, openEntityRef, onEntityRefSearch, selectEntityRef } = useEntityRefSearch({
  formData,
  entityStore,
})

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
  }
}, { immediate: true })

function close() {
  nameError.value = ''
  emit('update:modelValue', false)
}

defineExpose({ syncEntityRefAfterCreate })

// ── Smart Fill（智能填充）──────────────────────────────────────────────

const emptyFieldCount = computed(() => {
  return sortedFields.value.filter(f => {
    if (!isSmartFillField(f)) return false
    const value = formData.value[f.key]
    return !value || !value.trim()
  }).length
})

const showEmptyFieldHint = computed(() => emptyFieldCount.value >= 3)

function onFieldMouseEnter(key: string) {
  hoveredFieldKey.value = key
}

function onFieldMouseLeave(key: string) {
  if (hoveredFieldKey.value === key) {
    hoveredFieldKey.value = null
  }
}

/** 判断✨图标是否可见：hover 且非输入状态 */
function isSparkleVisible(field: FormFieldDef): boolean {
  if (!isSmartFillField(field)) return false
  // 输入中且有 ghost text 时隐藏✨
  if (focusedFieldKey.value === field.key && ghostVisible.value) return false
  // 仅 hover 时显示
  return hoveredFieldKey.value === field.key
}

function onFieldFocus(key: string) {
  focusedFieldKey.value = key
}

function onFieldBlur(key: string) {
  if (focusedFieldKey.value === key) {
    focusedFieldKey.value = null
    if (ghostFieldKey.value === key) {
      ghostVisible.value = false
    }
  }
}

function onFieldFocusForTrigger(field: FormFieldDef, event: FocusEvent) {
  if (!isSmartFillField(field)) return
  const target = event.target as HTMLElement
  focusTriggerRect.value = target.getBoundingClientRect()
  focusTriggerFieldKey.value = field.key
  focusTriggerVisible.value = true
}

function onFieldBlurForTrigger(_field: FormFieldDef) {
  setTimeout(() => {
    focusTriggerVisible.value = false
  }, 200)
}

function onFieldFocusTriggerClick() {
  if (!focusTriggerFieldKey.value) return
  const field = sortedFields.value.find(f => f.key === focusTriggerFieldKey.value)
  if (!field) return
  window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:chat-open', {
    detail: {
      entityType: resolvedEntityType.value,
      entityId: props.entity?.id,
      entityName: props.entity?.name,
      fieldKey: field.key,
    },
  }))
  focusTriggerVisible.value = false
}

function onFieldKeydown(field: FormFieldDef, e: KeyboardEvent) {
  if (!ghostVisible.value || ghostFieldKey.value !== field.key) return
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault()
    formData.value[field.key] = (formData.value[field.key] || '') + ghostText.value
    ghostVisible.value = false
    ghostText.value = ''
    ghostFieldKey.value = ''
  } else if (e.key === 'Escape') {
    e.preventDefault()
    ghostVisible.value = false
    ghostText.value = ''
    ghostFieldKey.value = ''
  }
}

/** ✨ 按钮点击：请求字段级独立建议 */
function onSmartFillClick(field: FormFieldDef) {
  const detail = {
    type: 'suggest_field' as const,
    entityType: resolvedEntityType.value,
    entityId: props.entity?.id,
    fieldKey: field.key,
    fieldLabel: field.label,
    currentText: formData.value[field.key] || '',
    mode: 'suggest' as const,
    isEditing: !!props.entity?.id,
  }
  window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:request', { detail }))
}

/** "AI 智能填充"按钮：请求一键填充 */
function onSmartFillAll() {
  const emptyFields: string[] = []
  const fieldLabels: Record<string, string> = {}
  for (const field of sortedFields.value) {
    const value = formData.value[field.key]
    if (isSmartFillField(field) && (!value || !value.trim())) {
      emptyFields.push(field.key)
      fieldLabels[field.key] = field.label
    }
  }
  if (!smartFillIncludeExisting.value && emptyFields.length === 0) {
    toastWarn('没有空字段需要填充')
    return
  }
  const detail = {
    type: 'smart_fill' as const,
    entityType: resolvedEntityType.value,
    entityId: props.entity?.id,
    currentFields: { ...formData.value },
    emptyFields: smartFillIncludeExisting.value ? [] : emptyFields,
    includeExisting: smartFillIncludeExisting.value,
  }
  window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:request', { detail }))
}

// 监听 Smart Fill 结果
function handleSmartFillResult(e: Event) {
  const result = (e as CustomEvent).detail
  if (!result) return

  if (result.type === 'field_suggestion' && result.fieldKey) {
    // 字段级建议 → 设置 ghost text
    ghostText.value = result.suggestion || ''
    ghostFieldKey.value = result.fieldKey
    ghostVisible.value = true
  } else if (result.type === 'smart_fill_result' && result.suggestions) {
    // 一键填充结果 → 由预览面板处理（见下方匿名监听器），此处不再直接填入
  }
}

// 注册/清理事件监听
window.addEventListener('worldsmith:smart-fill:result', handleSmartFillResult)

// ── Smart Fill Preview 状态 ──────────────────────────────────────────

const smartFillIncludeExisting = ref(false)

function onToggleIncludeExisting(value: boolean) {
  smartFillIncludeExisting.value = value
  // 仅在有实际填充需求时重新请求，避免无空字段时弹出 toastWarn
  if (value || emptyFieldCount.value > 0) {
    onSmartFillAll()
  }
}

const smartFillPreview = reactive({
  visible: false,
  currentFields: {} as Record<string, string>,
  suggestions: {} as Record<string, string>,
  fieldLabels: {} as Record<string, string>,
  accepted: new Set<string>(),
})

const smartFillPreviewRejected = computed(() => {
  const all = new Set(Object.keys(smartFillPreview.suggestions))
  for (const key of smartFillPreview.accepted) all.delete(key)
  return all
})

function onSmartFillPreviewClose() {
  smartFillPreview.visible = false
}

function onSmartFillPreviewAccept(key: string) {
  smartFillPreview.accepted.add(key)
}

function onSmartFillPreviewReject(key: string) {
  smartFillPreview.accepted.delete(key)
}

function onSmartFillPreviewAcceptAll() {
  smartFillPreview.accepted = new Set(Object.keys(smartFillPreview.suggestions))
}

function onSmartFillPreviewRejectAll() {
  smartFillPreview.accepted = new Set()
}

function onSmartFillPreviewApply() {
  // 将已接受的建议写入表单
  for (const key of smartFillPreview.accepted) {
    if (smartFillPreview.suggestions[key] !== undefined) {
      formData.value[key] = smartFillPreview.suggestions[key]
    }
  }
  smartFillPreview.visible = false
  const count = smartFillPreview.accepted.size
  toastSuccess(`已应用 ${count} 个字段建议`)
}

// 预览面板专用结果监听器（命名函数以便清理）
function handleSmartFillPreviewResult(e: Event) {
  const result = (e as CustomEvent).detail
  if (!result) return
  if (result.type === 'smart_fill_result' && result.suggestions) {
    const labels: Record<string, string> = {}
    for (const field of sortedFields.value) {
      labels[field.key] = field.label
    }
    smartFillPreview.currentFields = { ...formData.value }
    smartFillPreview.suggestions = result.suggestions
    smartFillPreview.fieldLabels = labels
    smartFillPreview.accepted = new Set()
    smartFillPreview.visible = true
  }
}

window.addEventListener('worldsmith:smart-fill:result', handleSmartFillPreviewResult)

// ── Smart Fill Write-Back 监听 ──────────────────────────────────────────
function handleSmartFillWriteBack(e: Event) {
  const detail = (e as CustomEvent).detail as { fieldKey: string; value: string } | undefined
  if (!detail?.fieldKey) return
  formData.value[detail.fieldKey] = detail.value
}

window.addEventListener('worldsmith:smart-fill:write-back', handleSmartFillWriteBack)

onUnmounted(() => {
  window.removeEventListener('worldsmith:smart-fill:result', handleSmartFillResult)
  window.removeEventListener('worldsmith:smart-fill:result', handleSmartFillPreviewResult)
  window.removeEventListener('worldsmith:smart-fill:write-back', handleSmartFillWriteBack)
})
</script>

<style scoped>
.efm-overlay {
  position: fixed;
  inset: 0;
  z-index: 99998;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.efm-box {
  background: var(--glass-bg, var(--modal-bg));
  border: 1px solid var(--glass-border, var(--border));
  border-radius: var(--radius-xl);
  padding: 28px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(var(--glass-blur));
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
.efm-preset-label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  white-space: nowrap;
}
.efm-preset-btn {
  font-size: var(--font-size-xs);
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--input-bg, var(--color-bg-surface));
  cursor: pointer;
  transition: background 0.12s;
}
.efm-preset-btn:hover {
  background: var(--hover-bg, var(--color-bg-hover));
}
.efm-preset-save {
  color: var(--accent, var(--color-primary));
  border-color: var(--accent, var(--color-primary));
}
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
/* Smart Fill ✨ 按钮 */
.efm-smart-fill-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 0 3px;
  margin-left: 4px;
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
}
.efm-field:hover .efm-smart-fill-btn {
  opacity: 1;
}
.efm-smart-fill-btn:hover {
  transform: scale(1.2);
}
/* Input wrap (for ghost text overlay) */
.efm-input-wrap {
  position: relative;
}
.efm-input-wrap .sf-ghost-text {
  position: absolute;
  top: 0;
  left: 0;
  padding: 7px 10px;
  font-size: var(--font-size-base);
  font-family: inherit;
  line-height: normal;
  pointer-events: none;
  max-width: 100%;
  overflow: hidden;
}
/* Richtext smart fill button */
.efm-richtext-wrap {
  position: relative;
}
.efm-smart-fill-inline {
  position: absolute;
  top: 4px;
  right: 4px;
  background: var(--glass-bg, var(--color-bg-surface));
  border: 1px solid var(--border-color, var(--border));
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;
}
.efm-field:hover .efm-smart-fill-inline {
  opacity: 1;
}
.efm-smart-fill-inline:hover {
  opacity: 1;
}
/* AI 智能填充按钮 */
.efm-btn-smart-fill {
  background: transparent;
  color: var(--accent);
  border: 1px dashed var(--accent);
  font-size: var(--font-size-sm);
  padding: 7px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-style 0.15s;
}
.efm-btn-smart-fill:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-style: solid;
}
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

.efm-eref { position: relative; }
.efm-eref input {
  padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text); width: 100%; box-sizing: border-box;
}
.efm-eref-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  background: var(--modal-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); max-height: 160px; overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-top: 2px;
}
.efm-eref-opt {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  cursor: pointer; font-size: var(--font-size-sm); transition: background 0.1s;
}
.efm-eref-opt:hover { background: var(--hover-bg); }
.efm-eref-icon { font-size: var(--font-size-base); }
.efm-eref-name { flex: 1; color: var(--text); }
.efm-eref-type { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--tag-bg); padding: 1px 4px; border-radius: 3px; }
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
