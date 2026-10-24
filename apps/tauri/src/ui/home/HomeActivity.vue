<template>
  <section class="home-section home-activity">
    <header class="home-section-head">
      <h2>创作活跃度</h2>
      <span class="home-section-note">实体与关系 · 按创建 / 最后更新</span>
    </header>

    <div class="home-activity-grid">
      <div class="home-activity-card home-heatmap-card">
        <div class="home-heatmap-scroll">
          <div class="home-heatmap" role="img" :aria-label="heatmapSummary">
            <div class="home-heat-months" aria-hidden="true">
              <span v-for="(w, i) in weeks" :key="i" class="home-heat-month">{{ w.monthLabel ?? '' }}</span>
            </div>
            <div class="home-heat-body">
              <div class="home-heat-weekdays" aria-hidden="true">
                <span v-for="(label, i) in HEAT_WEEKDAYS" :key="i">{{ label }}</span>
              </div>
              <div class="home-heat-grid">
                <span
                  v-for="cell in heatCells"
                  :key="cell.date"
                  class="home-heat-cell"
                  :class="`is-l${cell.level}`"
                  :data-date="cell.date"
                  :title="cell.title"
                ></span>
              </div>
            </div>
          </div>
        </div>
        <div class="home-heat-foot">
          <div class="home-heat-legend" aria-hidden="true">
            <span>少</span>
            <i v-for="level in LEVELS" :key="level" :class="`is-l${level}`"></i>
            <span>多</span>
          </div>
          <span class="home-heat-summary">近 53 周活跃 {{ windowActiveDays }} 天 · 最高 {{ windowMax }} 项/天</span>
        </div>
      </div>

      <div class="home-activity-card home-calendar-card">
        <header class="home-calendar-head">
          <button type="button" class="home-calendar-nav" aria-label="上个月" :disabled="prevDisabled" @click="monthOffset -= 1">
            <WsIcon name="chevron-left" size="xs" />
          </button>
          <span class="home-calendar-title">{{ monthLabel }}</span>
          <button type="button" class="home-calendar-nav" aria-label="下个月" :disabled="nextDisabled" @click="monthOffset += 1">
            <WsIcon name="chevron-right" size="xs" />
          </button>
        </header>

        <table class="home-calendar">
          <caption class="home-sr-only">{{ monthLabel }}创作活跃度</caption>
          <thead>
            <tr><th v-for="label in WEEKDAYS" :key="label" scope="col">{{ label }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(week, wi) in calendarWeeks" :key="wi">
              <td
                v-for="(cell, di) in week"
                :key="di"
                :class="cell ? cell.className : 'is-out'"
                :title="cell?.title"
                :aria-current="cell?.isToday ? 'date' : undefined"
              ><span v-if="cell">{{ cell.day }}</span></td>
            </tr>
          </tbody>
        </table>

        <p class="home-calendar-foot">{{ monthActiveDays }} 天有更新 · {{ monthCount }} 项内容</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  /** 本地日 YYYY-MM-DD → 当日活跃内容数 */
  daily: Record<string, number>
  /** 当日实体名（最多 3 个） */
  dayNames?: Record<string, string[]>
  /** 当日关系条数 */
  dayRelationCounts?: Record<string, number>
  /** 测试注入的「今天」；运行时留空取本机当天 */
  today?: string
}>()

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const HEAT_WEEKDAYS = ['一', '', '三', '', '五', '', '']
const LEVELS = [0, 1, 2, 3, 4] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function toKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
}

function dayTip(date: string, count: number): string {
  if (!count) return `${date} · 无更新`
  const names = props.dayNames?.[date] ?? []
  const relations = props.dayRelationCounts?.[date] ?? 0
  if (!names.length) return `${date} · ${count} 项${relations ? `：${relations} 条关系` : ''}`
  const moreNames = count > names.length + relations ? '…' : ''
  const relPart = relations ? ` · 另有 ${relations} 条关系` : ''
  return `${date} · ${count} 项：${names.join('、')}${moreNames}${relPart}`
}

const todayKey = computed(() => props.today ?? toKey(new Date()))
const todayDate = computed(() => parseKey(todayKey.value))

/** 热力图：53 周 × 7 天，周一为一周起点，最后一列包含今天 */
const heatStart = computed(() => {
  const mondayIndex = (todayDate.value.getDay() + 6) % 7
  return addDays(todayDate.value, -(52 * 7 + mondayIndex))
})

interface HeatCell { date: string; count: number; level: number; title: string; dateObj: Date }

const windowMax = computed(() => {
  let max = 0
  for (let i = 0; i < 53 * 7; i++) {
    const key = toKey(addDays(heatStart.value, i))
    max = Math.max(max, props.daily[key] ?? 0)
  }
  return max
})

const weeks = computed(() => {
  const out: Array<{ monthLabel: string | null; cells: HeatCell[] }> = []
  for (let w = 0; w < 53; w++) {
    const cells: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const dateObj = addDays(heatStart.value, w * 7 + d)
      const date = toKey(dateObj)
      const count = props.daily[date] ?? 0
      cells.push({
        date,
        count,
        level: levelOf(count, windowMax.value),
        title: dayTip(date, count),
        dateObj,
      })
    }
    const first = cells.find(c => c.dateObj.getDate() === 1)
    const monthLabel = first
      ? `${first.dateObj.getMonth() + 1}月`
      : w === 0 ? `${cells[0].dateObj.getMonth() + 1}月` : null
    out.push({ monthLabel, cells })
  }
  return out
})

const heatCells = computed(() => weeks.value.flatMap(w => w.cells))
const windowActiveDays = computed(() => heatCells.value.filter(c => c.count > 0).length)
const heatmapSummary = computed(() => `近 53 周创作活跃度，活跃 ${windowActiveDays.value} 天，最高一天 ${windowMax.value} 项内容`)

/** 月历：周一开头，可翻近 12 个月（含本月） */
const monthOffset = ref(0)
const monthDate = computed(() => {
  const date = new Date(todayDate.value.getFullYear(), todayDate.value.getMonth() + monthOffset.value, 1)
  return date
})
const monthLabel = computed(() => `${monthDate.value.getFullYear()} 年 ${monthDate.value.getMonth() + 1} 月`)
const prevDisabled = computed(() => monthOffset.value <= -11)
const nextDisabled = computed(() => monthOffset.value >= 0)

interface CalendarCell {
  day: number; date: string; count: number; isToday: boolean; isFuture: boolean; title: string; className: string
}

const calendarWeeks = computed(() => {
  const year = monthDate.value.getFullYear()
  const month = monthDate.value.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = (monthDate.value.getDay() + 6) % 7
  const cells: Array<CalendarCell | null> = Array.from({ length: lead }, () => null)

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d)
    const date = toKey(dateObj)
    const count = props.daily[date] ?? 0
    const isFuture = dateObj > todayDate.value
    const isToday = date === todayKey.value
    const classes = [
      count > 0 ? `is-l${levelOf(count, windowMax.value)}` : '',
      isToday ? 'is-today' : '',
      isFuture ? 'is-future' : '',
    ].filter(Boolean)
    cells.push({
      day: d,
      date,
      count,
      isToday,
      isFuture,
      title: isFuture ? date : dayTip(date, count),
      className: classes.join(' '),
    })
  }
  while (cells.length % 7) cells.push(null)

  const out: Array<Array<CalendarCell | null>> = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
})

const monthStats = computed(() => {
  let activeDays = 0
  let total = 0
  for (const week of calendarWeeks.value) {
    for (const cell of week) {
      if (!cell || cell.isFuture) continue
      if (cell.count > 0) activeDays++
      total += cell.count
    }
  }
  return { activeDays, total }
})
const monthActiveDays = computed(() => monthStats.value.activeDays)
const monthCount = computed(() => monthStats.value.total)
</script>
