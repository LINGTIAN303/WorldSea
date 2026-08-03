<template>
  <div class="request-monitor">
    <div class="section-label" @click="expanded = !expanded">
      <span class="toggle-arrow">{{ expanded ? '▼' : '▶' }}</span>
      请求监控
      <span v-if="pendingCount > 0" class="pending-badge">{{ pendingCount }} 进行中</span>
    </div>

    <template v-if="expanded">
      <!-- Per-Agent 汇总 -->
      <div v-if="snapshot" class="agent-stats">
        <div v-for="(stats, agentId) in snapshot.perAgent" :key="agentId" class="agent-stat-row">
          <span class="stat-name">{{ getAgentName(agentId) }}</span>
          <span class="stat-total">{{ stats.total }} 次</span>
          <span class="stat-success" v-if="stats.success > 0">{{ stats.success }} 成功</span>
          <span class="stat-error" v-if="stats.errors > 0">{{ stats.errors }} 失败</span>
          <span class="stat-latency" v-if="stats.avgLatencyMs > 0">{{ stats.avgLatencyMs }}ms</span>
        </div>
        <div v-if="Object.keys(snapshot.perAgent).length === 0" class="empty-hint">暂无请求记录</div>
      </div>

      <!-- 最近请求列表 -->
      <div v-if="recentRecords.length > 0" class="records-list">
        <div v-for="r in recentRecords" :key="r.id" class="record-row" :class="r.status">
          <span class="rec-name">{{ r.agentName }}</span>
          <span class="rec-protocol" v-if="r.protocol">{{ shortProtocol(r.protocol) }}</span>
          <span class="rec-status" :class="r.status">{{ statusLabel(r.status) }}</span>
          <span class="rec-latency" v-if="r.latencyMs">{{ r.latencyMs }}ms</span>
          <span class="rec-time">{{ formatTime(r.startTime) }}</span>
          <span class="rec-error" v-if="r.error" :title="r.error">!</span>
        </div>
      </div>

      <div class="monitor-actions">
        <button class="clear-btn" @click="onClear">清空记录</button>
        <button class="refresh-btn" @click="refresh">刷新</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { RequestTrackerSnapshot } from '../types'

const props = defineProps<{
  getSnapshot: () => RequestTrackerSnapshot
  getAgentName: (id: string) => string
  onClearRecords: () => void
}>()

const expanded = ref(false)
const snapshot = ref<RequestTrackerSnapshot | null>(null)

const pendingCount = computed(() => {
  if (!snapshot.value) return 0
  return snapshot.value.records.filter(r => r.status === 'pending').length
})

const recentRecords = computed(() => {
  if (!snapshot.value) return []
  return [...snapshot.value.records].reverse().slice(0, 30)
})

function refresh(): void {
  snapshot.value = props.getSnapshot()
}

function onClear(): void {
  props.onClearRecords()
  snapshot.value = props.getSnapshot()
}

function statusLabel(status: string): string {
  if (status === 'pending') return '...'
  if (status === 'success') return 'OK'
  return 'ERR'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function shortProtocol(p: string): string {
  if (p === 'openai-completions') return 'OpenAI'
  if (p === 'anthropic-messages') return 'Anthropic'
  if (p === 'google-generative-ai') return 'Google'
  return p
}

// 展开时自动刷新
import { watch } from 'vue'
watch(expanded, (v) => { if (v) refresh() })
</script>

<style scoped>
.request-monitor { margin-bottom: 14px; }
.section-label { font-size: 11px; color: var(--color-text-tertiary); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.toggle-arrow { font-size: 8px; }
.pending-badge { font-size: 9px; background: var(--color-primary); color: white; padding: 1px 6px; border-radius: 8px; font-weight: 400; text-transform: none; letter-spacing: 0; }

.agent-stats { margin-bottom: 8px; }
.agent-stat-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
.stat-name { font-weight: 600; min-width: 60px; }
.stat-total { color: var(--color-text-secondary); }
.stat-success { color: #10b981; }
.stat-error { color: #ef4444; }
.stat-latency { color: var(--color-text-tertiary); font-size: 10px; }
.empty-hint { font-size: 10px; color: var(--color-text-tertiary); padding: 8px 0; }

.records-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 6px; margin-bottom: 8px; }
.record-row { display: flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 10px; border-bottom: 1px solid var(--color-border); }
.record-row:last-child { border-bottom: none; }
.record-row.success { }
.record-row.error { background: rgba(239,68,68,0.05); }
.record-row.pending { background: rgba(108,92,231,0.05); }
.rec-name { font-weight: 600; min-width: 50px; }
.rec-protocol { font-size: 9px; color: var(--color-primary); background: rgba(108,92,231,0.08); padding: 1px 4px; border-radius: 3px; }
.rec-status { font-weight: 600; min-width: 24px; }
.rec-status.success { color: #10b981; }
.rec-status.error { color: #ef4444; }
.rec-status.pending { color: var(--color-primary); }
.rec-latency { color: var(--color-text-tertiary); }
.rec-time { color: var(--color-text-tertiary); margin-left: auto; }
.rec-error { color: #ef4444; font-weight: 700; cursor: help; }

.monitor-actions { display: flex; gap: 6px; }
.clear-btn, .refresh-btn { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 10px; cursor: pointer; background: var(--color-surface); color: var(--color-text-secondary); }
.clear-btn:hover, .refresh-btn:hover { border-color: var(--color-primary); }
</style>
