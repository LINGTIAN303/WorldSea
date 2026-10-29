<template>
  <Teleport to="body">
    <Transition name="ws-fade">
      <div v-if="show" class="cp-backdrop" @click="emit('close')"></div>
    </Transition>
    <Transition name="ws-slide-right">
      <div v-if="show" class="cp-panel" role="dialog" aria-modal="true" aria-label="时间体系">
        <header class="cp-header">
          <h3>时间体系</h3>
          <button type="button" class="cp-close" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="cp-toolbar">
          <select v-model="selectedId" class="cp-control" @change="loadDraft(($event.target as HTMLSelectElement).value)">
            <option v-for="cal in calendars" :key="cal.id" :value="cal.id">
              {{ cal.name }}{{ cal.id === activeId ? '（默认）' : '' }}
            </option>
          </select>
          <input v-model="draft.name" class="cp-control cp-name" placeholder="历法名称" />
          <button type="button" class="cp-btn" @click="emit('activate', draft.id)">设为默认</button>
        </div>

        <div class="cp-toolbar">
          <select v-model="selectedPreset" class="cp-control">
            <option v-for="preset in CALENDAR_PRESETS" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
          </select>
          <button type="button" class="cp-btn" @click="createPreset">新建</button>
          <button type="button" class="cp-btn cp-danger" :disabled="draft.id === 'simple'" @click="emit('remove', draft.id)">删除</button>
        </div>

        <div class="cp-body">
          <section class="cp-section">
            <h4>单位链 <small>从大到小；最后一个是标量基</small></h4>
            <UnitChainEditor v-model="draft.units" />
          </section>

          <section class="cp-section">
            <h4>周与日以下</h4>
            <label class="cp-check"><input type="checkbox" :checked="!!draft.week" @change="toggleWeek" /> 启用周循环</label>
            <div v-if="draft.week" class="cp-grid">
              <label>每周天数 <input v-model.number="draft.week.length" class="cp-control cp-number" type="number" min="1" /></label>
              <label>星期名 <input v-model="weekNames" class="cp-control" placeholder="周一,周二,..." /></label>
              <label>日单位
                <select v-model="draft.week.dayUnit" class="cp-control">
                  <option v-for="unit in draft.units" :key="unit.id" :value="unit.id">{{ unit.name }}</option>
                </select>
              </label>
              <label>锚点标量 <input v-model.number="draft.week.anchorScalar" class="cp-control cp-number" type="number" /></label>
              <label>锚点星期 <input v-model.number="draft.week.anchorIndex" class="cp-control cp-number" type="number" min="0" /></label>
            </div>

            <label class="cp-check"><input type="checkbox" :checked="!!draft.timeOfDay" @change="toggleTimeOfDay" /> 启用日以下时间</label>
            <div v-if="draft.timeOfDay" class="cp-grid">
              <label>每天小时 <input v-model.number="draft.timeOfDay.hoursPerDay" class="cp-control cp-number" type="number" min="1" /></label>
            </div>
          </section>

          <section class="cp-section">
            <h4>期段 <small>用于色带与分组</small></h4>
            <PeriodEditor v-model="draft.periods" :calendar="draft" />
          </section>
        </div>

        <footer class="cp-footer">
          <div class="cp-errors">
            <span v-for="error in errors.slice(0, 3)" :key="error.path">{{ error.path }}：{{ error.message }}</span>
            <span v-if="errors.length > 3">…共 {{ errors.length }} 项</span>
          </div>
          <button type="button" class="cp-btn" :disabled="migrating" @click="emit('migrate')">
            {{ migrating ? '迁移中…' : '迁移旧日期' }}
          </button>
          <button type="button" class="cp-btn" @click="emit('close')">取消</button>
          <button type="button" class="cp-btn cp-primary" :disabled="errors.length > 0" @click="save">保存</button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Calendar, CalendarError } from '../types'
import { validateCalendar } from '../validate'
import { createCalendarRuntime } from '../math'
import { parseTimePoint } from '../parse'
import { CALENDAR_PRESETS, createSimpleCalendar } from '../defaults'
import UnitChainEditor from './UnitChainEditor.vue'
import PeriodEditor from './PeriodEditor.vue'

const props = withDefaults(defineProps<{
  show: boolean
  calendars: Calendar[]
  activeId: string
  migrating?: boolean
}>(), {
  migrating: false,
})

const emit = defineEmits<{
  close: []
  save: [calendar: Calendar]
  remove: [id: string]
  activate: [id: string]
  migrate: []
}>()

const draft = ref<Calendar>(createSimpleCalendar())
const selectedId = ref('')
const selectedPreset = ref('simple')
const periodErrors = computed<CalendarError[]>(() => {
  const list: CalendarError[] = []
  const periods = draft.value.periods ?? []
  let runtime: ReturnType<typeof createCalendarRuntime> | null = null
  try {
    runtime = createCalendarRuntime(draft.value)
  } catch {
    runtime = null
  }
  periods.forEach((period, index) => {
    const start = parseTimePoint(period.start ?? '', draft.value)
    const end = parseTimePoint(period.end ?? '', draft.value)
    if (!start || !end) {
      list.push({ path: `periods[${index}]`, message: '起止日期无法按当前历法解析' })
      return
    }
    if (runtime) {
      try {
        if (runtime.toScalar(end.point) < runtime.toScalar(start.point)) {
          list.push({ path: `periods[${index}]`, message: '结束早于开始' })
        }
      } catch {
        list.push({ path: `periods[${index}]`, message: '期段日期无法换算' })
      }
    }
  })
  return list
})

const errors = computed(() => [...validateCalendar(draft.value), ...periodErrors.value])

const weekNames = computed({
  get: () => draft.value.week?.names.join('，') ?? '',
  set: (value: string) => {
    if (!draft.value.week) return
    draft.value.week.names = value.split(/[，,]/).map(item => item.trim()).filter(Boolean)
  },
})

function loadDraft(id: string): void {
  const found = props.calendars.find(item => item.id === id) ?? props.calendars[0]
  selectedId.value = found?.id ?? ''
  draft.value = found ? JSON.parse(JSON.stringify(found)) as Calendar : createSimpleCalendar()
}

watch(() => [props.show, props.activeId], () => {
  if (props.show) loadDraft(props.activeId)
}, { immediate: true })

watch(() => props.calendars, () => {
  if (props.show && !props.calendars.some(item => item.id === draft.value.id)) loadDraft(props.activeId)
})

function toggleWeek(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  draft.value.week = checked
    ? { length: 7, names: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], dayUnit: 'day', anchorScalar: 0, anchorIndex: 0 }
    : undefined
}

function toggleTimeOfDay(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  draft.value.timeOfDay = checked ? { hoursPerDay: 24 } : undefined
}

function createPreset(): void {
  const preset = CALENDAR_PRESETS.find(item => item.id === selectedPreset.value)
  if (!preset) return
  const calendar = preset.create()
  calendar.id = `${preset.id}-${Date.now().toString(36)}`
  calendar.name = preset.name
  draft.value = calendar
  selectedId.value = calendar.id
  emit('save', calendar)
}

function save(): void {
  if (errors.value.length) return
  emit('save', JSON.parse(JSON.stringify(draft.value)) as Calendar)
}
</script>

<style scoped>
.cp-backdrop { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-detail-backdrop); background: rgba(0, 0, 0, 0.2); }
.cp-panel {
  position: fixed; right: 0; top: var(--layout-menubar-height); bottom: 0; width: 560px; max-width: 92vw;
  background: var(--glass-bg, var(--panel-bg, var(--content-bg))); border-left: 1px solid var(--glass-border, var(--border-color));
  padding: 18px; display: flex; flex-direction: column; gap: 10px; overflow: hidden;
  z-index: var(--z-detail-backdrop); backdrop-filter: blur(var(--glass-blur)); box-shadow: var(--shadow-xl);
}
.cp-header { display: flex; align-items: center; justify-content: space-between; }
.cp-header h3 { margin: 0; font-size: var(--font-size-lg); }
.cp-close { border: none; background: transparent; color: var(--text-tertiary); font-size: var(--font-size-lg); cursor: pointer; }
.cp-toolbar { display: flex; align-items: center; gap: 6px; }
.cp-control {
  padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm); outline: none;
}
.cp-control:focus { border-color: var(--primary); }
.cp-name { flex: 1; min-width: 100px; }
.cp-number { width: 72px; }
.cp-btn {
  border: 1px solid var(--border-color); background: var(--bg-tertiary, var(--hover-bg)); color: var(--text-secondary);
  border-radius: var(--radius-sm); padding: 5px 10px; font-size: var(--font-size-sm); cursor: pointer;
}
.cp-btn:hover { border-color: var(--primary); color: var(--primary); }
.cp-btn:disabled { opacity: 0.4; cursor: default; }
.cp-primary { background: var(--primary); border-color: var(--primary); color: var(--color-text-inverse, #fff); }
.cp-danger { color: var(--danger); }
.cp-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px; }
.cp-section { display: flex; flex-direction: column; gap: 6px; }
.cp-section h4 { margin: 0; font-size: var(--font-size-sm); color: var(--primary); border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
.cp-section small { color: var(--text-tertiary); font-weight: normal; }
.cp-check { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); }
.cp-grid { display: flex; flex-wrap: wrap; gap: 8px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.cp-grid label { display: flex; align-items: center; gap: 4px; }
.cp-footer { display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 10px; }
.cp-errors { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-xs); color: var(--danger); overflow: hidden; }
</style>
