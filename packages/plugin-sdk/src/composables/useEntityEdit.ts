import { ref, watch, type Ref } from 'vue'
import { fieldRegistry, useEntityStore, type Entity, type FieldSchema } from '@worldsea/entity-core'
import { toastSuccess, toastError } from '@worldsea/ui-kit'
import { splitDraft } from '../detail/draftKeys'

export interface EditFormValues {
  _name: string
  _description: string
  [key: string]: unknown
}

/**
 * 详情行内编辑的草稿与唯一写路径。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
export function useEntityEdit(selectedEntity: Ref<Entity | null>) {
  const isEditing = ref(false)
  const editForm = ref<EditFormValues>({ _name: '', _description: '' })
  const customFieldDefs = ref<FieldSchema[]>([])

  function buildForm(e: Entity): EditFormValues {
    // 顶层承载的字段用草稿键种下，否则详情里它们永远读成 properties 的空值
    return {
      _name: e.name || '',
      _description: e.description || '',
      _tags: [...(e.tags ?? [])],
      _coverImage: e.coverImage || '',
      _coverPosition: e.coverPosition || '50% 50%',
      _coverZoom: e.coverZoom ?? 1,
      ...(e.properties || {}),
    } as EditFormValues
  }

  watch(selectedEntity, (e) => {
    isEditing.value = false
    if (e) editForm.value = buildForm(e)
  })

  function startEdit() {
    if (!selectedEntity.value) return
    isEditing.value = true
    editForm.value = buildForm(selectedEntity.value)
  }

  function cancelEdit() {
    isEditing.value = false
    if (selectedEntity.value) {
      customFieldDefs.value = []
      editForm.value = buildForm(selectedEntity.value)
    }
  }

  /** 自定义字段落**类型级**注册表（同类型共享），不再塞进实体 properties（裁定 ⑩） */
  function persistCustomFields(entityType: string) {
    for (const f of customFieldDefs.value) {
      if (fieldRegistry.getFields(entityType).some(cur => cur.key === f.key)) continue
      fieldRegistry.addUserField(entityType, f)
    }
  }

  async function saveEdit(
    entityStore?: ReturnType<typeof useEntityStore>,
    afterSave?: (entityId: string, form: EditFormValues) => Promise<void>,
  ) {
    const store = entityStore || useEntityStore()
    const entity = selectedEntity.value
    if (!entity) return

    const { topLevel, properties } = splitDraft(editForm.value)
    // properties 是整体替换语义，必须与旧值合并，否则未编辑的字段会被抹掉
    const updateData: Record<string, unknown> = {
      ...topLevel,
      properties: { ...(entity.properties ?? {}), ...properties },
    }
    try {
      persistCustomFields(entity.type)
      await store.update(entity.id, updateData)
      if (afterSave) {
        await afterSave(entity.id, editForm.value)
      }
      isEditing.value = false
      await store.loadAll()
      const updated = store.entities.find(e => e.id === entity.id)
      if (updated) selectedEntity.value = updated
      toastSuccess('已保存')

      // 触发 AutoLink 索引（新架构）
      try {
        const { indexPotentialLinks } = await import('@worldsea/entity-core')
        await indexPotentialLinks(entity.id, entity.type, properties)
      } catch { /* AutoLink 索引失败不影响主流程 */ }
    } catch (err) {
      toastError('保存失败')
      console.error('[useEntityEdit] save error:', err)
    }
  }

  return {
    isEditing,
    editForm,
    customFieldDefs,
    startEdit,
    cancelEdit,
    saveEdit,
    resetForm(name = '', description = '') {
      editForm.value = { _name: name, _description: description }
    },
  }
}
