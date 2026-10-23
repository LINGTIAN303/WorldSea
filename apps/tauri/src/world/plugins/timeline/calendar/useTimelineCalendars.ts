/** 时间线历法状态（项目级加载 / 保存 / 激活），供视图与面板共用。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createSimpleCalendar } from './defaults'
import type { Calendar } from './types'
import {
  ensureTimelineCalendars, removeCalendar, saveActiveCalendarId, saveCalendar,
} from './store'

export function useTimelineCalendars() {
  const calendars = ref<Calendar[]>([])
  const activeId = ref('')
  const loading = ref(false)
  const error = ref('')

  const active = computed(() =>
    calendars.value.find(item => item.id === activeId.value)
    ?? calendars.value[0]
    ?? createSimpleCalendar(),
  )

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const result = await ensureTimelineCalendars()
      calendars.value = result.calendars
      activeId.value = result.activeId
    } catch (err) {
      error.value = err instanceof Error ? err.message : '历法加载失败'
    } finally {
      loading.value = false
    }
  }

  async function upsert(calendar: Calendar): Promise<void> {
    await saveCalendar(calendar)
    await load()
  }

  async function remove(id: string): Promise<void> {
    await removeCalendar(id)
    await load()
  }

  async function activate(id: string): Promise<void> {
    activeId.value = id
    await saveActiveCalendarId(id)
  }

  function byId(id?: string | null): Calendar {
    return calendars.value.find(item => item.id === id) ?? active.value
  }

  // 切项目后项目库已指向新库；视图若未重建也要重读历法配置
  onMounted(() => window.addEventListener('project:switched', load))
  onBeforeUnmount(() => window.removeEventListener('project:switched', load))

  return { calendars, activeId, active, loading, error, load, upsert, remove, activate, byId }
}
