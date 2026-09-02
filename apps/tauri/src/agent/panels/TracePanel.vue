<template>
  <div class="trace-panel">
    <div class="trace-header">
      <h3 class="trace-title">轨迹</h3>
      <span v-if="rows.length > 0" class="trace-meta">{{ rows.length }} 项</span>
    </div>
    <!-- 空态 -->
    <div v-if="rows.length === 0" class="trace-empty">暂无轨迹。运行 Agent 后展示阶段级执行轨迹。</div>

    <!-- Turn 表格 -->
    <div v-else class="trace-table">
      <div v-for="row in rows" :key="row.id" class="trace-row" :class="`trace-${row.status}`">
        <span class="trace-dot" :class="`dot-${row.status}`" />
        <span class="trace-type">
          <WsIcon :name="row.icon" :size="14" :stroke-width="1.7" />
        </span>
        <div class="trace-main">
          <span class="trace-label">{{ row.label }}</span>
          <span class="trace-sub">{{ row.sub }}</span>
        </div>
        <div class="trace-metrics">
          <span v-if="row.tools" class="trace-tool-count">{{ row.tools }}</span>
          <span v-if="row.duration" class="trace-duration">{{ row.duration }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TracePanel：Agent 空间右侧执行面板「轨迹」Tab。
 * [⑤] turn/阶段级结构化表格（对齐 Harness TrajectoryView）：消费 useAgentRust deepSegments（偏向阶段序列）
 * + useActivityLog 日志（偏事件流），合并派生出阶段级行（状态 dot + 进度/工具数 + 耗时）。
 * 与「活动」Tab（ActivityLog 事件流）区分：轨迹 = 结构化阶段表格。
 */
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useActivityLog } from '@/agent/composables/useActivityLog'

export interface TraceRow {
  id: string
  label: string
  sub: string
  status: 'active' | 'done' | 'streaming' | 'pending'
  icon: string
  tools?: string
  duration?: string
}

const { logs } = useActivityLog()

/** 阶段行 → 轨迹行（三模式移除 2026-08-31：deepSegments 阶段序列已移除，由活动日志派生） */
function fmtDuration(start: number, end?: number): string {
  if (!start) return ''
  const ms = (end || Date.now()) - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`
}

function fmtTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const rows = computed<TraceRow[]>(() => {
  const out: TraceRow[] = []
  for (const log of logs.value.slice(-20)) {
    if (log.type !== 'tool' && log.type !== 'knowledge' && log.type !== 'memory') continue
    out.push({
      id: log.id,
      label: log.message,
      sub: fmtTime(log.timestamp),
      status: 'done',
      icon: log.type === 'tool' ? 'wrench' : log.type === 'knowledge' ? 'book' : 'memory',
      duration: fmtDuration(log.timestamp),
    })
  }
  return out.reverse().slice(0, 20)
})
</script>

<style scoped>
.trace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 8px;
}
.trace-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
}
.trace-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.trace-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 20px;
  font-size: var(--font-size-xs);
}
.trace-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.trace-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  font-size: var(--font-size-xs);
  transition: background 0.1s;
}
.trace-row:hover {
  background: var(--color-surface);
}
.trace-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-tertiary);
}
.dot-active, .dot-streaming {
  background: var(--color-primary);
  animation: trace-dot-pulse 1.5s ease-in-out infinite;
}
.dot-done {
  background: var(--success, #34d399);
}
.trace-type {
  display: flex;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.trace-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.trace-label {
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trace-sub {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
}
.trace-metrics {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}
.trace-tool-count {
  font-variant-numeric: tabular-nums;
}
.trace-duration {
  font-variant-numeric: tabular-nums;
}
@keyframes trace-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
:root[data-anim-status='off'] .dot-active, :root[data-anim-status='off'] .dot-streaming { animation: none; }
</style>