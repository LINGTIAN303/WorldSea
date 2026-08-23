<template>
  <!-- [④] Turn 状态条：整 running turn 常驻（不随单工具闪烁），运行 ≥15s 显示耗时 -->
  <div v-if="running" class="turn-status" role="status" aria-live="polite">
    <span class="turn-status-dot" />
    <span class="turn-status-text">Deep diving...</span>
    <span v-if="showClock" class="turn-status-clock" aria-hidden>{{ elapsedLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  running: boolean
  /** 可选的 turn 开始时间（ms）；缺省用挂载时间 */
  startTime?: number | null
}>()

const SHOW_CLOCK_AFTER_MS = 15_000

const mountedAt = ref(Date.now())
const anchor = computed(() => props.startTime ?? mountedAt.value)
const elapsedMs = ref(Date.now() - anchor.value)

let timer: ReturnType<typeof setInterval> | null = null

function tick(): void {
  elapsedMs.value = Math.max(0, Date.now() - anchor.value)
}

const showClock = computed(() => elapsedMs.value >= SHOW_CLOCK_AFTER_MS)
const elapsedLabel = computed(() => formatDuration(elapsedMs.value))

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<style scoped>
.turn-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}
.turn-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--agent-primary);
  animation: turn-dot-pulse 1.6s ease-in-out infinite;
}
.turn-status-text {
  font-family: var(--agent-font, inherit);
}
.turn-status-clock {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
}
@keyframes turn-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
:root[data-anim-messages='off'] .turn-status-dot { animation: none; }
</style>