<template>
  <div ref="panelRef" class="ms-stats-panel" :style="panelStyle">
    <div class="ms-stats-title">写作统计</div>

    <div class="ms-stats-today">
      <div class="ms-stats-today-num">
        今日 <strong>{{ todayWords }}</strong> 字
        <span v-if="goal > 0" class="ms-stats-goal-hint">/ 目标 {{ goal }} 字</span>
      </div>
      <div v-if="goal > 0" class="ms-stats-progress" role="progressbar" :aria-valuenow="progressPct" aria-valuemin="0" aria-valuemax="100">
        <div class="ms-stats-progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>

    <div class="ms-stats-goal-row">
      <label class="ms-stats-goal-label" for="ms-stats-goal-input">每日目标</label>
      <input
        id="ms-stats-goal-input"
        v-model.number="goalInput"
        class="ms-stats-goal-input"
        type="number"
        min="0"
        step="100"
        @keyup.enter="saveGoal"
        @blur="saveGoal"
      />
      <span class="ms-stats-goal-unit">字</span>
    </div>

    <div class="ms-stats-summary">
      <span>连续写作 <strong>{{ streak }}</strong> 天</span>
      <span>全书 <strong>{{ bookWords }}</strong> 字</span>
    </div>

    <div class="ms-stats-chart" aria-hidden="true">
      <div
        v-for="d in recent14"
        :key="d.key"
        class="ms-stats-col"
        :title="`${d.key}：${d.words} 字`"
      >
        <div class="ms-stats-bar" :style="{ height: barHeight(d.words) + '%' }" :class="{ empty: d.words === 0 }"></div>
      </div>
    </div>
    <p class="ms-stats-hint">未归书章节不计入统计</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 写作统计面板（批1）：编辑器头部「统计」按钮触发的就地小卡（同 TypographyPanel 定位形态）。
 * 数据源 = 所属书 properties.writingStats（goal + daily 日键映射），经 useWritingStats 读写；
 * 目标编辑在 blur/Enter 时落库（skipUndo 不适用——用户主动改目标，允许进撤销栈）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import {
  readWritingStats, statsDayKey, calcStreak, recentDays,
} from '../composables/useWritingStats'

const props = defineProps<{ bookId: string; anchor: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()

const es = useEntityStore()

const book = computed(() => (es.entities ?? []).find(e => e.id === props.bookId) ?? null)
const stats = computed(() => readWritingStats(book.value))
const goal = computed(() => stats.value.goal)
const todayWords = computed(() => stats.value.daily[statsDayKey()] || 0)
const streak = computed(() => calcStreak(stats.value.daily))
const recent14 = computed(() => recentDays(stats.value.daily, 14))
const bookWords = computed(() =>
  (es.entities ?? [])
    .filter(e => e.type === 'manuscript' && ((e.properties.bookId as string) || '') === props.bookId)
    .reduce((s, m) => s + ((m.properties.wordCount as number) || 0), 0),
)

const progressPct = computed(() => {
  if (goal.value <= 0) return 0
  return Math.min(100, Math.round((todayWords.value / goal.value) * 100))
})

// 目标编辑（打开时同步当前值；0 = 未设置）
const goalInput = ref(stats.value.goal)

async function saveGoal() {
  const value = Math.max(0, Math.floor(Number(goalInput.value) || 0))
  goalInput.value = value
  if (!book.value || value === stats.value.goal) return
  await es.update(book.value.id, {
    properties: { ...book.value.properties, writingStats: { goal: value, daily: stats.value.daily } },
  })
}

const chartMax = computed(() => Math.max(...recent14.value.map(d => d.words), 1))
function barHeight(words: number): number {
  return Math.round((words / chartMax.value) * 100)
}

const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; right: string }>({ top: '0px', right: '0px' })

function position() {
  const rect = props.anchor?.getBoundingClientRect()
  if (!rect) return
  panelStyle.value = {
    top: `${Math.min(rect.bottom + 6, window.innerHeight - 300)}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
}

function onDocMousedown(e: MouseEvent) {
  const t = e.target as Node
  if (panelRef.value?.contains(t)) return
  if (props.anchor?.contains(t)) return
  emit('close')
}

onMounted(() => {
  position()
  document.addEventListener('mousedown', onDocMousedown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
})
</script>

<style scoped>
.ms-stats-panel {
  position: fixed;
  z-index: var(--z-popover, 400);
  width: 300px;
  padding: 12px;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: var(--shadow-md);
}
.ms-stats-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  margin-bottom: 10px;
}
.ms-stats-today-num {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.ms-stats-today-num strong { font-size: var(--font-size-xl); color: var(--text-color); }
.ms-stats-goal-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.ms-stats-progress {
  height: 6px;
  margin-top: 8px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}
.ms-stats-progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}
.ms-stats-goal-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.ms-stats-goal-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.ms-stats-goal-input {
  width: 72px;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-sm);
}
.ms-stats-goal-unit { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.ms-stats-summary {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.ms-stats-summary strong { color: var(--text-color); }
.ms-stats-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 56px;
  margin-top: 12px;
  padding: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-xs);
}
.ms-stats-col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.ms-stats-bar {
  width: 100%;
  min-height: 2px;
  background: var(--primary);
  border-radius: 2px 2px 0 0;
  opacity: 0.85;
}
.ms-stats-bar.empty { background: var(--border-color); }
.ms-stats-hint {
  margin: 8px 0 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
