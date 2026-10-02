// 字段与预设 composable：字段合并（SYSTEM_KEYS + fieldRegistry）、预设切换、拖拽排序、字段增删。
// 预设的增删改在设置「实体详情」Tab，此处只留切换。详细说明见 docs/details/注释/packages/plugin-sdk/entity-form-modal.md
import { ref, computed, watch } from 'vue'
import { fieldRegistry, useFieldOrderStore, type Entity } from '@worldsea/entity-core'
import { toastSuccess, toastWarn } from '@worldsea/ui-kit'
import type { FormFieldDef } from '../types'

export interface UseFieldPresetsOptions {
  fields: () => FormFieldDef[]
  entityType: () => string
  entity: () => Entity | null
  fieldOrderStore: ReturnType<typeof useFieldOrderStore>
  /** 惰性获取 formData（useFieldPresets 先于 useDynamicForm 调用，运行时才求值） */
  getFormData: () => { value: Record<string, unknown> }
}

export function useFieldPresets(options: UseFieldPresetsOptions) {
  const SYSTEM_KEYS = new Set(['name', 'description', 'tags'])

  const resolvedEntityType = computed(() => options.entityType() || options.entity()?.type || '')

  const sortedFields = computed(() => {
    void fieldRegistry.version.value
    const systemFields = options.fields().filter(f => SYSTEM_KEYS.has(f.key))
    const builtinPropKeys = new Set(options.fields().filter(f => !SYSTEM_KEYS.has(f.key)).map(f => f.key))
    const regFields = fieldRegistry.getFields(resolvedEntityType.value)
    const seenKeys = new Set<string>()
    const propertyFields: FormFieldDef[] = []
    for (const f of regFields) {
      if (SYSTEM_KEYS.has(f.key)) continue
      seenKeys.add(f.key)
      const fromProps = builtinPropKeys.has(f.key) ? options.fields().find(p => p.key === f.key) : undefined
      propertyFields.push({
        key: f.key,
        label: fromProps?.label ?? f.label,
        /** 原样透传 fieldType：归一是控件层 normalizeFieldType 的唯一职责，此处不再设白名单
         *  （白名单会把 multiSelect/image/formula 静默降级成 text，正是抽屉那套的同型缺陷）*/
        type: (fromProps?.type ?? f.fieldType) as FormFieldDef['type'],
        required: fromProps?.required ?? f.required,
        placeholder: fromProps?.placeholder ?? f.placeholder,
        options: fromProps?.options ?? f.options?.map(o => typeof o === 'string' ? { value: o, label: o } : o as any),
        rows: f.fieldType === 'textarea' ? 3 : undefined,
        source: f.source,
        refType: (fromProps as any)?.refType ?? (f as any).refType,
        relationType: (fromProps as any)?.relationType ?? (f as any).relationType,
        autoLink: (fromProps as any)?.autoLink ?? (f as any).autoLink,
      })
    }
    for (const f of options.fields()) {
      if (SYSTEM_KEYS.has(f.key) || seenKeys.has(f.key)) continue
      propertyFields.push({ ...f, source: 'builtin' })
    }
    return [...systemFields, ...propertyFields]
  })

  const activePreset = ref('默认')
  const presetOptions = computed(() => {
    const names = options.fieldOrderStore.getPresetNames(resolvedEntityType.value)
    if (names.length === 0) return [{ value: '默认', label: '默认' }]
    return names.map(n => ({ value: n, label: n }))
  })

  watch(activePreset, (name) => {
    options.fieldOrderStore.loadPreset(resolvedEntityType.value, name)
  })

  function isFullWidth(type: string): boolean {
    return type === 'textarea' || type === 'richtext'
  }

  // ── 拖拽排序 ──────────────────────────────────────────────
  let dragIdx = -1
  const dragOverIdx = ref(-1)

  function onDragStart(idx: number, e: DragEvent) {
    dragIdx = idx
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(idx: number) {
    dragOverIdx.value = idx
  }

  function onDragLeave() {
    dragOverIdx.value = -1
  }

  function onDrop(idx: number) {
    dragOverIdx.value = -1
    if (dragIdx === idx || dragIdx < 0) return
    const fields = [...sortedFields.value]
    const [moved] = fields.splice(dragIdx, 1)
    fields.splice(idx, 0, moved)
    const propertyKeys = fields.filter(f => !SYSTEM_KEYS.has(f.key)).map(f => f.key)
    fieldRegistry.setOrder(resolvedEntityType.value, propertyKeys)
    dragIdx = -1
  }

  // ── 预设管理 ──────────────────────────────────────────────
  // 增删改（另存/删除）已搬到设置「实体详情」Tab 的「命名预设」卡，弹窗侧只留**切换**：
  // 同一份数据不该有两个 CRUD 面（1a 刚把四套字段控件收成一套，这是同型问题）。
  // 切换由上面 `watch(activePreset)` → `loadPreset` 完成，且已是「并入不抹除」语义。

  // ── 添加/删除字段 ─────────────────────────────────────────
  const showAddField = ref(false)
  const newFieldKey = ref('')
  const newFieldLabel = ref('')
  const newFieldType = ref<'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'select' | 'color'>('text')
  const newFieldOptions = ref('')

  function confirmAddField() {
    const key = newFieldKey.value.trim()
    const label = newFieldLabel.value.trim() || key
    if (!key) return
    const optionsVal = newFieldType.value === 'select'
      ? newFieldOptions.value.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s }))
      : undefined
    console.log(`[EntityFormModal] addUserField: key=${key}, label=${label}, type=${newFieldType.value}`)
    const ok = fieldRegistry.addUserField(resolvedEntityType.value, { key, label, fieldType: newFieldType.value, options: optionsVal })
    if (!ok) {
      toastWarn(`字段 "${key}" 已存在`)
      return
    }
    console.log(`[EntityFormModal] field added, registry fields:`, fieldRegistry.getFields(resolvedEntityType.value).map(f => `${f.key}=${f.label}`))
    options.getFormData().value[key] = ''
    cancelAddField()
    toastSuccess(`已添加字段「${label}」`)
  }

  function cancelAddField() {
    showAddField.value = false
    newFieldKey.value = ''
    newFieldLabel.value = ''
    newFieldType.value = 'text'
    newFieldOptions.value = ''
  }

  function removeField(key: string) {
    fieldRegistry.removeField(resolvedEntityType.value, key)
    const { [key]: _, ...rest } = options.getFormData().value
    options.getFormData().value = rest
    toastSuccess(`已删除字段「${key}」`)
  }

  return {
    resolvedEntityType,
    sortedFields,
    activePreset,
    presetOptions,
    isFullWidth,
    dragOverIdx,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    showAddField,
    newFieldKey,
    newFieldLabel,
    newFieldType,
    newFieldOptions,
    confirmAddField,
    cancelAddField,
    removeField,
  }
}
