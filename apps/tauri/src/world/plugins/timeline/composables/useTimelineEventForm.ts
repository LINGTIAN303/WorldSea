/** 时间线事件表单保存：新建/编辑共用，保留表单未展示的历史属性。 */
import type { Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { toastSuccess } from '@worldsea/ui-kit'
import type { Calendar } from '../calendar/types'

export interface TimelineEventFormPayload {
  name: string
  description: string
  properties: Record<string, any>
  tags: string[]
  _coverPosition?: string
  _coverZoom?: number
}

export interface TimelineEventFormOptions {
  showForm: Ref<boolean>
  editingEvent: Ref<Entity | null>
  activeCalendar: Ref<Calendar>
  /** 新建预填属性（画布拖拽建事件预填起止日期） */
  preset: Ref<Record<string, unknown> | null>
  entityStore: {
    add: (entity: Entity) => Promise<unknown>
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>
    loadAll: () => Promise<unknown>
  }
  formModalRef: Ref<{ syncEntityRefAfterCreate: (id: string) => Promise<void> | void } | null>
  checkAndConfirmName: (name: string, excludeId?: string, entityType?: string) => Promise<string | null>
}

export function useTimelineEventForm(options: TimelineEventFormOptions) {
  function openNewForm(preset: Record<string, unknown> | null = null): void {
    options.editingEvent.value = null
    options.preset.value = preset
    options.showForm.value = true
  }

  async function onFormSave(data: TimelineEventFormPayload): Promise<void> {
    const now = new Date().toISOString()
    // 表单不展示的历史属性（era 等）必须保留：update 的 properties 是整体替换语义
    const properties: Record<string, any> = {
      ...(options.editingEvent.value?.properties ?? {}),
      ...data.properties,
      calendarId: data.properties.calendarId || options.activeCalendar.value.id,
      dateCertainty: data.properties.dateCertainty || 'exact',
    }

    if (options.editingEvent.value) {
      const updateData: Record<string, unknown> = { description: data.description, properties, tags: data.tags }
      // 表单无 name/title 字段时 data.name 为空串——不带 name 键，防止抹掉既有名（方言守卫）
      if (data.name) updateData.name = data.name
      if (data._coverPosition) updateData.coverPosition = data._coverPosition
      if (data._coverZoom) updateData.coverZoom = data._coverZoom
      await options.entityStore.update(options.editingEvent.value.id, updateData)
    } else {
      const checkedName = await options.checkAndConfirmName(data.name, undefined, 'event')
      if (!checkedName) return
      const entity: Entity = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'event',
        name: checkedName,
        description: data.description,
        properties,
        tags: data.tags,
        createdAt: now,
        updatedAt: now,
      }
      await options.entityStore.add(entity)
      toastSuccess('已创建')
      await options.formModalRef.value?.syncEntityRefAfterCreate(entity.id)
    }

    options.showForm.value = false
    options.editingEvent.value = null
    options.preset.value = null
    await options.entityStore.loadAll()
  }

  return { openNewForm, onFormSave }
}
