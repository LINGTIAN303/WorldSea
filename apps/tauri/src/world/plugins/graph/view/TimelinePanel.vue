<template>
  <Transition name="ws-fade">
    <div v-if="visible" class="g-time">
      <div class="g-time-head">
        <WsIcon name="timeline" size="xs" />
        <span class="g-time-title">世界时间轴</span>
        <span class="g-time-sub">{{ datedCount }} / {{ totalCount }} 个实体带日期</span>
        <button class="g-time-close" aria-label="关闭时间轴" @click="$emit('close')">
          <WsIcon name="close" size="xs" />
        </button>
      </div>

      <div v-if="datedCount === 0" class="g-time-empty">尚未为任何实体填写日期，时间轴暂不可用</div>
      <template v-else>
        <div class="g-time-body">
          <div class="g-time-row">
            <span class="g-time-label">起 {{ formatAbsYear(start) }}</span>
            <input
              class="g-time-range"
              type="range"
              :min="min"
              :max="max"
              :step="step"
              :value="start"
              aria-label="时间轴起点"
              @input="onStart(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div class="g-time-row">
            <span class="g-time-label">止 {{ formatAbsYear(end) }}</span>
            <input
              class="g-time-range"
              type="range"
              :min="min"
              :max="max"
              :step="step"
              :value="end"
              aria-label="时间轴终点"
              @input="onEnd(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>
        <div class="g-time-foot">
          <span>{{ active ? '过滤已生效' : '拖动滑杆开始过滤' }} · 无日期实体保持常显</span>
          <button class="g-time-reset" @click="$emit('reset')">重置</button>
        </div>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { formatAbsYear } from '../model/timeline'

const props = defineProps<{
  visible: boolean
  min: number
  max: number
  start: number
  end: number
  datedCount: number
  totalCount: number
  active: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:range': [start: number, end: number]
  reset: []
}>()

/** 大跨度时按比例放大步长，避免滑杆每一个年份都成为一档 */
const step = computed(() => Math.max(1, Math.round((props.max - props.min) / 400)))

function onStart(value: number): void {
  emit('update:range', Math.min(value, props.end), props.end)
}

function onEnd(value: number): void {
  emit('update:range', props.start, Math.max(value, props.start))
}
</script>

<style scoped>
.g-time {
  position: absolute; bottom: 64px; left: 12px; right: 214px;
  display: flex; flex-direction: column;
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-mid);
  background: var(--g-panel-bg, rgba(8,12,20,0.94)); backdrop-filter: blur(12px);
  z-index: 8; overflow: hidden;
}
.g-time-head { display: flex; align-items: center; gap: 7px; padding: 8px 12px 6px; border-bottom: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); color: var(--g-text-dim, #94a3b8); }
.g-time-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); }
.g-time-sub { margin-left: auto; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); white-space: nowrap; }
.g-time-close { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-time-close:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-time-empty { padding: 10px 12px 12px; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
.g-time-body { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px 6px; }
.g-time-row { display: flex; align-items: center; gap: 10px; }
.g-time-label { min-width: 120px; font-size: var(--font-size-xs); color: var(--g-text, #cbd5e1); font-variant-numeric: tabular-nums; white-space: nowrap; }
.g-time-range { flex: 1; min-width: 0; accent-color: var(--g-accent, #6ea8fe); cursor: pointer; }
.g-time-foot { display: flex; align-items: center; gap: 8px; padding: 6px 12px 8px; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
.g-time-reset { margin-left: auto; padding: 2px 8px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.12)); border-radius: var(--radius-sm); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); cursor: pointer; }
.g-time-reset:hover { background: var(--g-hover, rgba(255,255,255,0.08)); color: var(--g-text-strong, #e2e8f0); }
</style>
