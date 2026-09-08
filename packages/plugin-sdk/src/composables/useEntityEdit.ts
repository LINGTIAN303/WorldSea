import { ref, watch, type Ref } from 'vue'
import { useEntityStore, type Entity, type FieldSchema } from '@worldsea/entity-core'
import { toastSuccess, toastError } from '@worldsea/ui-kit'

export interface EditFormValues {
  _name: string
  _description: string
  [key: string]: unknown
}

export function useEntityEdit(selectedEntity: Ref<Entity | null>) {
  const isEditing = ref(false)
  const editForm = ref<EditFormValues>({ _name: '', _description: '' })
  const customFieldDefs = ref<FieldSchema[]>([])

  function buildForm(e: Entity): EditFormValues {
    const props = e.properties || {}
    if (props.__customFieldDefs) {
      try {
        customFieldDefs.value = JSON.parse(props.__customFieldDefs as string) as FieldSchema[]
      } catch { customFieldDefs.value = [] }
    } else {
      customFieldDefs.value = []
    }
    return {
      _name: e.name || '',
      _description: e.description || '',
      _coverPosition: e.coverPosition || '50% 50%',
      _coverZoom: e.coverZoom || 1,
      ...props,
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

  async function saveEdit(
    entityStore?: ReturnType<typeof useEntityStore>,
    afterSave?: (entityId: string, form: EditFormValues) => Promise<void>,
  ) {
    const store = entityStore || useEntityStore()
    const entity = selectedEntity.value
    if (!entity) return

    const { _name, _description, _coverPosition, _coverZoom, __customFieldDefs, ...properties } = editForm.value
    if (customFieldDefs.value.length > 0) {
      properties.__customFieldDefs = JSON.stringify(customFieldDefs.value)
    } else {
      delete properties.__customFieldDefs
    }
    const updateData: Record<string, unknown> = {
      name: _name || entity.name,
      description: _description !== undefined ? _description : entity.description,
      properties,
    }
    if (_coverPosition !== undefined) {
      updateData.coverPosition = _coverPosition
    }
    if (_coverZoom !== undefined) {
      updateData.coverZoom = _coverZoom
    }
    try {
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
