// 动态表单 composable：formData 状态、初始化、字段输入事件（含 name/text 事件总线与 ghost 500ms 防抖）。
// 详细说明见 docs/details/注释/packages/plugin-sdk/entity-form-modal.md
import { ref, watch, type Ref } from 'vue'
import { getEventBus, type Entity } from '@worldsmith/entity-core'
import type { FormFieldDef } from '../types'

export interface UseDynamicFormOptions {
  entity: () => Entity | null
  sortedFields: Ref<FormFieldDef[]>
  resolvedEntityType: Ref<string>
  isSmartFillField: (field: FormFieldDef) => boolean
  ghostVisible: Ref<boolean>
}

export function useDynamicForm(options: UseDynamicFormOptions) {
  const formData = ref<Record<string, string>>({})
  const nameError = ref('')
  const prevFieldValues = ref<Record<string, string>>({})

  let _ghostDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function initFormData() {
    const data: Record<string, string> = {}
    for (const field of options.sortedFields.value) {
      if (field.key === 'name') {
        data[field.key] = options.entity()?.name ?? ''
      } else if (field.key === 'description') {
        data[field.key] = options.entity()?.description ?? ''
      } else if (field.key === 'tags') {
        data[field.key] = (options.entity()?.tags ?? []).join(',')
      } else {
        data[field.key] = String(options.entity()?.properties?.[field.key] ?? '')
      }
    }
    data._coverPosition = options.entity()?.coverPosition || '50% 50%'
    data._coverZoom = String(options.entity()?.coverZoom || 1)
    formData.value = data
    prevFieldValues.value = { ...data }
    nameError.value = ''
  }

  function onFieldInput(field: FormFieldDef) {
    const entityId = options.entity()?.id
    if (field.key === 'name') {
      const text = formData.value[field.key] || ''
      getEventBus().emit('name:input', { entityId, text })
    }
    // Smart Fill: 字段输入时触发 ghost text 接续预览（500ms 防抖）
    if (options.isSmartFillField(field)) {
      const currentText = String(formData.value[field.key] || '')
      if (!currentText.trim()) {
        options.ghostVisible.value = false
        if (_ghostDebounceTimer) clearTimeout(_ghostDebounceTimer)
        return
      }
      if (_ghostDebounceTimer) clearTimeout(_ghostDebounceTimer)
      _ghostDebounceTimer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:request', {
          detail: {
            type: 'suggest_field',
            entityType: options.resolvedEntityType.value,
            entityId: options.entity()?.id,
            fieldKey: field.key,
            fieldLabel: field.label,
            currentText,
            mode: 'continue',
            isEditing: !!options.entity()?.id,
          },
        }))
      }, 500)
    }
  }

  watch(() => formData.value, (newVal) => {
    const entityId = options.entity()?.id
    if (!entityId) return
    for (const key of Object.keys(newVal)) {
      const prev = prevFieldValues.value[key] || ''
      const curr = newVal[key] || ''
      if (curr !== prev) {
        const field = options.sortedFields.value.find(f => f.key === key)
        if (field && (field.type === 'textarea' || field.type === 'richtext')) {
          const delta = curr.length > prev.length ? curr.slice(prev.length) : curr
          getEventBus().emit('text:input', { entityId, field: key, text: delta })
        }
        prevFieldValues.value[key] = curr
      }
    }
  }, { deep: true })

  return { formData, nameError, initFormData, onFieldInput }
}
