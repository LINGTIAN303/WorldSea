/** 时间线历法动作：保存/删除/激活/旧日期迁移（视图只拿状态与回调）。 */
import { ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { toastError, toastSuccess } from '@worldsea/ui-kit'
import type { Calendar } from './types'
import { useTimelineCalendars } from './useTimelineCalendars'
import { migrateEventDates } from './migrate'
import { markLegacyMigrated } from './store'

export interface ConfirmOptions {
  type: string
  title: string
  description: string
}

export interface TimelineCalendarActionsOptions {
  events: () => Entity[]
  entityStore: {
    update: (
      id: string,
      changes: Partial<Entity>,
      source?: 'user' | 'agent' | 'import',
      opts?: { skipUndo?: boolean },
    ) => Promise<void>
  }
  loadTimeline: () => Promise<void>
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export function useTimelineCalendarActions(options: TimelineCalendarActionsOptions) {
  const state = useTimelineCalendars()
  const showPanel = ref(false)
  const migrating = ref(false)

  async function saveCalendar(calendar: Calendar): Promise<void> {
    const isNew = !state.calendars.value.some(item => item.id === calendar.id)
    await state.upsert(calendar)
    if (isNew) await state.activate(calendar.id)
    toastSuccess(isNew ? '已新建历法' : '历法已保存')
  }

  async function removeCalendar(id: string): Promise<void> {
    const ok = await options.confirm({
      type: 'danger',
      title: '删除历法',
      description: '删除后该历法下的事件日期不会自动转换；确定删除？',
    })
    if (!ok) return
    await state.remove(id)
    toastSuccess('历法已删除')
  }

  async function activateCalendar(id: string): Promise<void> {
    await state.activate(id)
    toastSuccess('已设为默认历法')
  }

  async function migrateDates(): Promise<void> {
    if (migrating.value) return
    const result = migrateEventDates(options.events(), state.active.value)
    if (!result.updates.length) {
      toastSuccess(`没有可迁移的事件${result.failed.length ? `（${result.failed.length} 个无法解析）` : ''}`)
      return
    }
    const suffix = result.failed.length ? `；${result.failed.length} 个无法解析会保留原文` : ''
    const ok = await options.confirm({
      type: 'warning',
      title: '迁移旧日期',
      description: `将把 ${result.updates.length} 个事件转换为「${state.active.value.name}」的规范文本${suffix}。`,
    })
    if (!ok) return
    migrating.value = true
    try {
      for (const item of result.updates) {
        await options.entityStore.update(item.id, { properties: item.properties }, 'import', { skipUndo: true })
      }
      await markLegacyMigrated()
      await options.loadTimeline()
      toastSuccess(`已迁移 ${result.updates.length} 个事件`)
    } catch (err) {
      toastError('迁移失败')
      console.warn('[timeline migrate]', err)
    } finally {
      migrating.value = false
    }
  }

  return {
    ...state,
    showPanel,
    migrating,
    saveCalendar,
    removeCalendar,
    activateCalendar,
    migrateDates,
  }
}
