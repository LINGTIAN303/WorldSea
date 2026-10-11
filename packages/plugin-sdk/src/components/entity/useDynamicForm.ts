// 动态表单 composable：formData 状态、初始化、字段输入事件（含 name/text 事件总线）。
// 详细说明见 docs/details/注释/packages/plugin-sdk/entity-form-modal.md
import { ref, watch, type Ref } from 'vue'
import { getEventBus, type Entity } from '@worldsea/entity-core'
import { toArrayValue } from '../../detail/fieldValue'
import type { FormFieldDef } from '../types'

export interface UseDynamicFormOptions {
  entity: () => Entity | null
  sortedFields: Ref<FormFieldDef[]>
  resolvedEntityType: Ref<string>
}

/** formData 值不再统一收成字符串——数组型字段（tags/multiSelect）要按数组进出 */
export type FormValues = Record<string, unknown>

export function useDynamicForm(options: UseDynamicFormOptions) {
  const formData = ref<FormValues>({})
  const nameError = ref('')
  const prevFieldValues = ref<FormValues>({})

  function initFormData() {
    const data: FormValues = {}
    for (const field of options.sortedFields.value) {
      if (field.key === 'name' || field.key === 'title') {
        // V2 方言：identifiable 的 title 即实体名（翻译真源 detail/fieldAccessor.ts），读实体顶层 name
        data[field.key] = options.entity()?.name ?? ''
      } else if (field.key === 'description') {
        data[field.key] = options.entity()?.description ?? ''
      } else if (field.key === 'tags') {
        data[field.key] = [...(options.entity()?.tags ?? [])]
      } else if (field.type === 'multiSelect') {
        data[field.key] = toArrayValue(options.entity()?.properties?.[field.key])
      } else {
        data[field.key] = options.entity()?.properties?.[field.key] ?? ''
      }
    }
    data._coverPosition = options.entity()?.coverPosition || '50% 50%'
    data._coverZoom = options.entity()?.coverZoom || 1
    formData.value = data
    prevFieldValues.value = { ...data }
    nameError.value = ''
  }

  function onFieldInput(field: FormFieldDef) {
    const entityId = options.entity()?.id
    if (field.key === 'name' || field.key === 'title') {
      const text = String(formData.value[field.key] ?? '')
      getEventBus().emit('name:input', { entityId, text })
    }
  }

  watch(() => formData.value, (newVal) => {
    const entityId = options.entity()?.id
    if (!entityId) return
    for (const key of Object.keys(newVal)) {
      // 文本增量事件只对字符串语义有意义：数组每次都是新引用，直接比会误报「变了」
      const prev = String(prevFieldValues.value[key] ?? '')
      const curr = String(newVal[key] ?? '')
      if (curr !== prev) {
        const field = options.sortedFields.value.find(f => f.key === key)
        if (field && (field.type === 'textarea' || field.type === 'richtext')) {
          const delta = curr.length > prev.length ? curr.slice(prev.length) : curr
          getEventBus().emit('text:input', { entityId, field: key, text: delta })
        }
        prevFieldValues.value[key] = newVal[key]
      }
    }
  }, { deep: true })

  return { formData, nameError, initFormData, onFieldInput }
}
