<template>
  <div class="plan-panel">
    <div class="panel-header">
      <h3 class="panel-title">任务计划</h3>
      <button class="panel-close-btn" @click="close" title="关闭">✕</button>
    </div>
    <div class="panel-body">
      <!-- 计划区（弹性伸展，可滚动） -->
      <div class="plan-scroll-area">
        <div class="section-header" @click="planExpanded = !planExpanded">
          <span class="section-label">计划</span>
          <span v-if="planProgress.total > 0" class="section-meta">{{ planProgress.completed }}/{{ planProgress.total }}</span>
          <WsIcon name="chevron-down" size="xs" class="section-chevron" :class="{ collapsed: !planExpanded }" />
        </div>
        <div v-show="planExpanded">
          <div v-if="!planStore.hasPlan.value" class="panel-empty">暂无任务计划</div>
          <div
            v-for="(item, idx) in planStore.items.value"
            :key="item.id"
            class="plan-item"
            :class="[`plan-${item.status}`]"
          >
            <span class="item-step" :class="`step-${item.status}`">
              <WsIcon v-if="item.status === 'completed'" name="check" size="xs" />
              <WsIcon v-else-if="item.status === 'skipped'" name="skip-forward" size="xs" />
              <template v-else>{{ idx + 1 }}</template>
            </span>
            <div class="item-content">
              <span class="item-title" :class="{ 'item-done': item.status === 'completed' || item.status === 'skipped' }">{{ item.title }}</span>
              <span v-if="item.description" class="item-desc">{{ item.description }}</span>
            </div>
          </div>
          <div v-if="planProgress.total > 0" class="plan-mini-bar">
            <div class="plan-mini-fill" :style="{ width: planProgress.pct + '%' }"></div>
          </div>
        </div>
      </div>

      <!-- 底部固定区：用量 + 上下文 -->
      <div class="panel-bottom">
        <div class="section-divider"></div>

      <!-- 用量区 -->
      <div class="section-header" @click="usageExpanded = !usageExpanded">
        <span class="section-label">用量</span>
        <span class="section-meta">${{ calculatedCost.total.toFixed(4) }}</span>
        <WsIcon name="chevron-down" size="xs" class="section-chevron" :class="{ collapsed: !usageExpanded }" />
      </div>
      <div v-show="usageExpanded">
        <div class="usage-columns">
          <!-- 当前会话 -->
          <div class="usage-col">
            <div class="usage-col-title">当前会话</div>
            <div class="usage-compact">
              <div class="usage-row"><span class="usage-k">请求</span><span class="usage-v">{{ totalUsage.requestCount }}</span></div>
              <div class="usage-row"><span class="usage-k">输入</span><span class="usage-v">{{ formatTokens(totalUsage.inputTokens + totalUsage.cacheReadTokens + totalUsage.cacheWriteTokens) }}</span></div>
              <div class="usage-row"><span class="usage-k">输出</span><span class="usage-v">{{ formatTokens(totalUsage.outputTokens) }}</span></div>
              <div class="usage-row" :class="{ 'row-cache': cacheHitRate > 0 }"><span class="usage-k">缓存</span><span class="usage-v">{{ cacheHitRate }}%</span></div>
              <div class="usage-row"><span class="usage-k">费用</span><span class="usage-v">${{ calculatedCost.total.toFixed(4) }}</span></div>
              <div v-if="calculatedCost.savedByCache > 0" class="usage-row row-saved"><span class="usage-k">节省</span><span class="usage-v">-${{ calculatedCost.savedByCache.toFixed(4) }}</span></div>
            </div>
          </div>
          <!-- 累计 -->
          <div class="usage-col">
            <div class="usage-col-title">累计</div>
            <div class="usage-compact">
              <div class="usage-row"><span class="usage-k">请求</span><span class="usage-v">{{ cumulativeUsage.requestCount }}</span></div>
              <div class="usage-row"><span class="usage-k">输入</span><span class="usage-v">{{ formatTokens(cumulativeUsage.inputTokens + cumulativeUsage.cacheReadTokens + cumulativeUsage.cacheWriteTokens) }}</span></div>
              <div class="usage-row"><span class="usage-k">输出</span><span class="usage-v">{{ formatTokens(cumulativeUsage.outputTokens) }}</span></div>
              <div class="usage-row"><span class="usage-k">费用</span><span class="usage-v">${{ cumulativeUsage.totalCost.toFixed(4) }}</span></div>
              <div v-if="cumulativeUsage.savedByCache > 0" class="usage-row row-saved"><span class="usage-k">节省</span><span class="usage-v">-${{ cumulativeUsage.savedByCache.toFixed(4) }}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 上下文窗口进度 -->
      <div class="section-divider"></div>
      <div class="ctx-section">
        <div class="ctx-header">
          <span class="section-label">上下文</span>
          <span class="ctx-pct" :class="{ warn: contextPct > 70, danger: contextPct > 90 }">{{ Math.round(contextPct) }}%</span>
        </div>
        <div class="ctx-bar">
          <div class="ctx-bar-fill" :style="{ width: contextPct + '%' }" :class="{ warn: contextPct > 70, danger: contextPct > 90 }"></div>
        </div>
        <div class="ctx-meta">{{ formatTokens(contextUsed) }} / {{ formatTokens(contextTotal) }}</div>
      </div>
      </div><!-- end panel-bottom -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlanStore } from '../../agent/composables/usePlanStore'
import { useSpaceStore } from '../stores/space-store'
import { useAgent } from '../../agent/composables/useAgent'
import { calculateCost } from '@worldsmith/agent-runtime'
import WsIcon from '../../ui/WsIcon.vue'

const planStore = usePlanStore()
const spaceStore = useSpaceStore()
const { totalUsage, lastRequestUsage, cumulativeUsage, cacheHitRate } = useAgent()

const planProgress = planStore.progress
const planExpanded = ref(true)
const usageExpanded = ref(true)

const calculatedCost = computed(() => {
  const modelId = localStorage.getItem('agent_current_model')
  let mid = 'deepseek-chat'
  try { if (modelId) mid = JSON.parse(modelId).modelId } catch {}
  return calculateCost(
    mid,
    totalUsage.value.inputTokens,
    totalUsage.value.outputTokens,
    totalUsage.value.cacheReadTokens,
    totalUsage.value.cacheWriteTokens,
  )
})

// 上下文窗口进度
const contextTotal = computed(() => {
  const modelId = localStorage.getItem('agent_current_model')
  try { if (modelId) return JSON.parse(modelId).contextLength || 128000 } catch {}
  return 128000
})
const contextUsed = computed(() =>
  lastRequestUsage.value.inputTokens + lastRequestUsage.value.cacheReadTokens + lastRequestUsage.value.cacheWriteTokens
)
const contextPct = computed(() => {
  const total = contextTotal.value
  return total > 0 ? Math.min(100, (contextUsed.value / total) * 100) : 0
})

function close(): void {
  spaceStore.planPanelOpen = false
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1000000).toFixed(2)}M`
}
</script>

<style scoped>
.plan-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-left: 1px solid var(--color-border);
  contain: layout paint style;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  margin: 0;
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
}

.plan-scroll-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  contain: layout paint style;
}

.panel-bottom {
  flex-shrink: 0;
}

.panel-empty {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
  padding: 16px 0;
}

/* --- Section Header --- */

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}

.section-header:hover .section-label {
  color: var(--color-text);
}

.section-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: var(--font-weight-semibold);
  transition: color 0.15s;
}

.section-meta {
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.section-chevron {
  color: var(--color-text-tertiary);
  transition: transform 0.2s;
  margin-left: auto;
}

.section-chevron.collapsed {
  transform: rotate(-90deg);
}

.section-divider {
  height: 1px;
  background: var(--color-border);
  margin: 8px 0;
}

/* --- Plan Item --- */

.plan-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  margin-bottom: 3px;
  border-radius: 6px;
  background: var(--color-surface);
  transition: background 0.15s, opacity 0.2s;
}

.plan-item.plan-in_progress {
  background: var(--color-primary-muted);
  border-left: 3px solid var(--color-primary);
}

.plan-item.plan-completed,
.plan-item.plan-skipped {
  opacity: 0.5;
}

.item-step {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: var(--font-weight-semibold, 600);
  flex-shrink: 0;
  margin-top: 1px;
  transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s;
}

.step-pending {
  background: var(--color-surface);
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border);
}

.step-in_progress {
  background: var(--color-primary);
  color: #fff;
  box-shadow: 0 0 0 3px var(--color-primary-muted);
  animation: step-pulse 2s ease-in-out infinite;
}

@keyframes step-pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--color-primary-muted); }
  50% { box-shadow: 0 0 0 5px rgba(108, 92, 231, 0.1); }
}

.step-completed {
  background: #00b894;
  color: #fff;
}

.step-skipped {
  background: var(--color-surface);
  color: var(--color-text-tertiary);
}

.item-content { flex: 1; min-width: 0; }

.item-title {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  line-height: 1.4;
}

.item-title.item-done {
  text-decoration: line-through;
  color: var(--color-text-tertiary);
}

.item-desc {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: 1px;
  line-height: 1.3;
}

.plan-mini-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--color-border);
  overflow: hidden;
  margin-top: 6px;
}

.plan-mini-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transition: width 0.3s ease;
}

/* --- Usage (平行双列) --- */

.usage-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.usage-col {
  background: var(--color-surface);
  border-radius: 6px;
  padding: 6px 8px;
}

.usage-col-title {
  font-size: 10px;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 3px;
  font-weight: var(--font-weight-semibold);
}

.usage-compact {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.usage-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  line-height: 1.5;
}

.usage-k {
  color: var(--color-text-tertiary);
}

.usage-v {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.row-cache .usage-v { color: #00b894; }
.row-saved .usage-v { color: #00b894; }

/* --- Context Window --- */

.ctx-section {
  padding: 2px 0 0;
}

.ctx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}

.ctx-pct {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.ctx-pct.warn { color: var(--color-warning, #f0a500); }
.ctx-pct.danger { color: var(--color-danger, #e74c3c); }

.ctx-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--color-border);
  overflow: hidden;
}

.ctx-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transition: width 0.3s ease;
}

.ctx-bar-fill.warn { background: var(--color-warning, #f0a500); }
.ctx-bar-fill.danger { background: var(--color-danger, #e74c3c); }

.ctx-meta {
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
