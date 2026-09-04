<template>
  <!-- 统一等候动画（2026-09-04 用户拍板）：高亮平移文字。
       运行时（isStreaming）常驻显示，替代原 scanner「正在处理…」/「思考中…」/TurnStatus「Deep diving...」三态分叉；
       标题生成等短时提示复用（compact 小号态）。
       icon 插槽：由宿主注入品牌 logo 替换默认图标。 -->
  <div class="wait-hint" :class="{ compact }" role="status" aria-live="polite">
    <span v-if="(compact && $slots.icon) || !compact" class="wait-hint-icon">
      <slot name="icon"><WsIcon name="profile" size="xs" /></slot>
    </span>
    <span class="ws-shine-text">{{ text }}</span><span v-if="showClock" class="wait-hint-clock">{{ elapsedLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
// ws-shine-text 高亮平移工具类定义在流区全局 stream.css（行段折叠条同用）
import '../stream/stream.css'

const props = withDefaults(defineProps<{
  /** 等候文案（默认「正在处理…」） */
  text?: string
  /** 可选的 turn 开始时间（ms）；缺省用挂载时间。≥15s 显示耗时 */
  startTime?: number | null
  /** 小号态：标题生成等短时提示 */
  compact?: boolean
}>(), {
  text: '正在处理…',
  startTime: null,
  compact: false,
})

const SHOW_CLOCK_AFTER_MS = 15_000

const mountedAt = ref(Date.now())
const anchor = computed(() => props.startTime ?? mountedAt.value)
const elapsedMs = ref(0)

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
.wait-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* 2026-09-04 用户建议：等候动画再小一些（缩小字号/图标/内边距） */
  padding: 3px 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--agent-text-secondary);
  font-family: var(--agent-font);
}
.wait-hint.compact {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  padding: 2px 4px;
}
.wait-hint-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  border-radius: 50%;
  background: var(--agent-hover-bg);
}
.wait-hint-clock {
  margin-left: 4px;
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>