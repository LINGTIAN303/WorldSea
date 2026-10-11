<template>
  <Transition name="ws-slide-up">
    <div v-if="visible" class="gg-timeline">
      <div class="gg-timeline-header">
        <span class="gg-timeline-title">时间轴过滤</span>
        <button class="gg-timeline-reset" @click="resetRange">重置</button>
        <button class="gg-timeline-close" @click="$emit('close')" aria-label="关闭"><WsIcon name="x" size="xs" /></button>
      </div>
      <div class="gg-timeline-body">
        <div class="gg-timeline-range">
          <span class="gg-timeline-label">起始</span>
          <input type="number" class="gg-timeline-input" v-model.number="rangeStart" :min="minYear" :max="maxYear" @input="applyFilter" />
          <span class="gg-timeline-label">结束</span>
          <input type="number" class="gg-timeline-input" v-model.number="rangeEnd" :min="minYear" :max="maxYear" @input="applyFilter" />
        </div>
        <input type="range" class="gg-timeline-slider" :min="minYear" :max="maxYear" v-model.number="rangeStart" @input="applyFilter" />
        <input type="range" class="gg-timeline-slider" :min="minYear" :max="maxYear" v-model.number="rangeEnd" @input="applyFilter" />
        <div class="gg-timeline-info">
          显示 {{ rangeStart }} ~ {{ rangeEnd }} 年间的事件节点（共 {{ filteredCount }} 个）
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  visible: boolean
  minYear: number
  maxYear: number
  filteredCount: number
}>()

const emit = defineEmits<{
  close: []
  filter: [start: number, end: number]
  reset: []
}>()

const rangeStart = ref(props.minYear)
const rangeEnd = ref(props.maxYear)

watch(() => props.minYear, (v) => { rangeStart.value = v })
watch(() => props.maxYear, (v) => { rangeEnd.value = v })

function applyFilter(): void {
  const start = Math.min(rangeStart.value, rangeEnd.value)
  const end = Math.max(rangeStart.value, rangeEnd.value)
  emit('filter', start, end)
}

function resetRange(): void {
  rangeStart.value = props.minYear
  rangeEnd.value = props.maxYear
  emit('reset')
}
</script>

<style scoped>
.gg-timeline {
  position: absolute;
  bottom: 60px;
  left: 12px;
  right: 12px;
  background: var(--g-panel-bg, rgba(10, 14, 20, 0.95));
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md);
  backdrop-filter: blur(12px);
  z-index: 20;
  padding: 12px 16px;
}
.gg-timeline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.gg-timeline-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--g-text-strong, #e0e0e0);
  flex: 1;
}
.gg-timeline-reset {
  background: var(--g-hover, rgba(255,255,255,0.06));
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1));
  color: var(--g-text, #aaa);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 3px 10px;
  border-radius: var(--radius-xs);
}
.gg-timeline-reset:hover { color: var(--g-text-strong, #fff); background: var(--g-hover, rgba(255,255,255,0.1)); }
.gg-timeline-close {
  background: none;
  border: none;
  color: var(--g-text-dim, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px 4px;
  border-radius: var(--radius-xs);
}
.gg-timeline-close:hover { color: var(--g-text-strong, #fff); background: var(--g-hover, rgba(255,255,255,0.08)); }
.gg-timeline-range {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.gg-timeline-label {
  font-size: var(--font-size-xs);
  color: var(--g-text-dim, #888);
  min-width: 24px;
}
.gg-timeline-input {
  width: 80px;
  background: var(--g-hover, rgba(255,255,255,0.06));
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1));
  border-radius: var(--radius-xs);
  color: var(--g-text, #ccc);
  font-size: var(--font-size-sm);
  padding: 4px 8px;
  text-align: center;
}
.gg-timeline-input:focus { outline: none; border-color: rgba(79,195,247,0.5); }
.gg-timeline-slider {
  width: 100%;
  margin: 4px 0;
  accent-color: #4fc3f7;
}
.gg-timeline-info {
  font-size: var(--font-size-xs);
  color: var(--g-text-dim, #888);
  text-align: center;
  margin-top: 4px;
}

</style>
