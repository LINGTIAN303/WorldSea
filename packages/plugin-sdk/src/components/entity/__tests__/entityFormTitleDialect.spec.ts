// 实体名方言守卫：V2 trait 的 title 即实体名（identifiable trait），弹窗管线三件套
// （useFieldPresets / useDynamicForm / useEntityFormSave）必须与抽屉侧 fieldAccessor.TOP_LEVEL_FIELD
// 同源翻译——title 读写 entity.name，绝不落 properties.title（死值）。
// 旧 schema（orchestration 等自带 name 字段）行为保持不变。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { fieldRegistry, useFieldOrderStore, useEntityStore } from '@worldsea/entity-core'

import { useFieldPresets } from '../useFieldPresets'
import { useDynamicForm } from '../useDynamicForm'
import { useEntityFormSave, type EntityFormSavePayload } from '../useEntityFormSave'
import type { FormFieldDef } from '../../types'

/** 与 V2 芽（building）编译 schema 同形的字段清单 */
const V2_FIELDS = [
  { key: 'title', label: '标题', type: 'text', required: true },
  { key: 'description', label: '描述', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
  { key: 'coverImage', label: '封面图', type: 'image' },
  { key: 'condition', label: '现状', type: 'select' },
  { key: 'buildingType', label: '类型', type: 'select' },
] as never as FormFieldDef[]

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  fieldRegistry.resetToBuiltin()
  fieldRegistry.registerBuiltin('building', [
    { key: 'coverImage', label: '封面图', fieldType: 'image' },
    { key: 'condition', label: '现状', fieldType: 'select' },
    { key: 'buildingType', label: '类型', fieldType: 'select' },
  ] as never)
})

describe('useFieldPresets —— title 进系统字段区', () => {
  it('V2 字段下 title 排首位（系统区），属性区不含 title/description/tags', () => {
    const store = useFieldOrderStore()
    const api = useFieldPresets({
      fields: () => V2_FIELDS,
      entityType: () => 'building',
      entity: () => null,
      fieldOrderStore: store,
      getFormData: () => ({ value: {} as Record<string, unknown> }),
    })
    const keys = api.sortedFields.value.map(f => f.key)
    expect(keys[0]).toBe('title')
    expect(keys).toContain('description')
    expect(keys).toContain('tags')
    // 属性区（有 source 标记的行）只剩真正的 properties 字段
    expect(api.sortedFields.value.filter(f => f.source).map(f => f.key))
      .toEqual(['coverImage', 'condition', 'buildingType'])
  })
})

describe('useDynamicForm —— title 读写 entity.name', () => {
  it('initFormData：title 取实体顶层 name，不取 properties.title（死值）', () => {
    const store = useFieldOrderStore()
    const api = useFieldPresets({
      fields: () => V2_FIELDS,
      entityType: () => 'building',
      entity: () => null,
      fieldOrderStore: store,
      getFormData: () => ({ value: {} as Record<string, unknown> }),
    })
    const form = useDynamicForm({
      entity: () => ({
        id: '', type: 'building', name: '黑鸦堡', description: 'desc', tags: ['主城'],
        properties: { title: '不该被读到的死值' }, createdAt: '', updatedAt: '',
      }) as never,
      sortedFields: api.sortedFields,
      resolvedEntityType: api.resolvedEntityType,
    })
    form.initFormData()
    expect(form.formData.value.title).toBe('黑鸦堡')
    expect(form.formData.value.description).toBe('desc')
    expect(form.formData.value.tags).toEqual(['主城'])
  })
})

describe('useEntityFormSave —— title 上抛为 name', () => {
  function mkSave(formData: Record<string, unknown>) {
    const emitted: EntityFormSavePayload[] = []
    const save = useEntityFormSave({
      formData: ref(formData),
      nameError: ref(''),
      sortedFields: ref(V2_FIELDS),
      entityStore: useEntityStore(),
      entity: () => null,
      emit: ((_ev, data) => { emitted.push(data) }) as never,
    })
    return { save, emitted }
  }

  it('title 填值 → emit.name 收到值；properties 不含 title/description/tags', () => {
    const { save, emitted } = mkSave({
      title: '黑鸦堡', description: 'desc', tags: ['主城'],
      coverImage: 'x.png', buildingType: '城堡',
    })
    save.save()
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('黑鸦堡')
    expect(emitted[0].tags).toEqual(['主城'])
    expect(Object.keys(emitted[0].properties).sort()).toEqual(['buildingType', 'condition', 'coverImage'])
  })

  it('title 必填为空 → nameError 且不 emit（不再静默产出空名实体）', () => {
    const nameError = ref('')
    const emitted: EntityFormSavePayload[] = []
    const save = useEntityFormSave({
      formData: ref({ title: '  ', description: '', tags: [] }),
      nameError,
      sortedFields: ref(V2_FIELDS),
      entityStore: useEntityStore(),
      entity: () => null,
      emit: ((_ev, data) => { emitted.push(data) }) as never,
    })
    save.save()
    expect(nameError.value).toBe('标题不能为空')
    expect(emitted).toHaveLength(0)
  })

  it('旧方言回归：自带 name 字段的 schema（orchestration）行为不变', () => {
    const emitted: EntityFormSavePayload[] = []
    const save = useEntityFormSave({
      formData: ref({ name: '计划A', steps: '[]' }),
      nameError: ref(''),
      sortedFields: ref([
        { key: 'name', label: '名称', type: 'text', required: true },
        { key: 'steps', label: '步骤', type: 'textarea' },
      ] as never as FormFieldDef[]),
      entityStore: useEntityStore(),
      entity: () => null,
      emit: ((_ev, data) => { emitted.push(data) }) as never,
    })
    save.save()
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('计划A')
    expect(emitted[0].properties).toEqual({ steps: '[]' })
  })
})
