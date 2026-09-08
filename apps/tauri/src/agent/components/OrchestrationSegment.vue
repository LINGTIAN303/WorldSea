<template>
  <!-- 编排段：对话流内特殊消息单元（A0-1/A3），一次请求一个。
       时态规则（A0-3/A0-5）：运行中逐步展开 → 完成后自动收拢为折叠任务流。 -->
  <div class="orch-segment" :class="{ collapsed: collapsed }">
    <div class="orch-segment-head">
      <!-- 判型结论 + 可展开/收拢（键盘可达） -->
      <button
        type="button"
        class="orch-segment-toggle"
        role="button"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开编排过程' : '收拢编排过程'"
        @click="collapsed = !collapsed"
        @keydown.enter.prevent="collapsed = !collapsed"
        @keydown.space.prevent="collapsed = !collapsed"
      >
        <WsIcon :name="collapsed ? 'chevron-right' : 'chevron-down'" size="xs" />
        <span class="orch-pipeline">{{ pipelineLabel }}</span>
        <span v-if="run.reason" class="orch-reason" :title="run.reason">{{ run.reason }}</span>
      </button>

      <!-- 运行中：中止按钮（M2-4，复用 abort 命令） -->
      <button
        v-if="run.status === 'running'"
        type="button"
        class="orch-abort"
        @click="emit('abort-request')"
      >
        中止
      </button>

      <!-- 折叠统计行（Cursor 范式） -->
      <span v-if="collapsed" class="orch-stats">
        {{ run.phases.length }} 阶段 · {{ durationText }}
      </span>

      <!-- 首次弱提示（A0-16：仅首次，localStorage 记忆） -->
      <span v-if="showFirstHint" class="orch-first-hint">{{ FIRST_HINT }}</span>
    </div>

    <!-- 展开态：阶段卡序列（状态点 + WsIcon 双编码） -->
    <div v-show="!collapsed" class="orch-phases">
      <div
        v-for="phase in run.phases"
        :key="`${run.runId}-${phase.phase}`"
        class="orch-phase"
        :class="`phase-${phase.status}`"
      >
        <span class="orch-phase-dot" :class="`dot-${phase.status}`" aria-hidden="true"></span>
        <span class="orch-phase-name">{{ phase.phase }}</span>
        <span v-if="phase.summary" class="orch-phase-summary">{{ phase.summary }}</span>
        <span v-if="phase.finishedAt && phase.enteredAt && phase.finishedAt !== phase.enteredAt" class="orch-phase-duration">
          {{ phaseDurationText(phase) }}
        </span>
      </div>

      <!-- 2026-09-02 内联计划卡：plan_execute run 的计划步骤列表（每步可展开查看执行产出/原因） -->
      <div v-if="planItems.length" class="orch-plan-steps">
        <div class="orch-plan-head">
          <span class="orch-plan-title">执行计划</span>
          <span v-if="planProgress.total > 0" class="orch-plan-meta">
            {{ planProgress.done }}/{{ planProgress.total }}
          </span>
        </div>
        <div
          v-for="(item, idx) in planItems"
          :key="item.id"
          class="orch-plan-step"
          :class="`ps-${item.status}`"
        >
          <button
            type="button"
            class="orch-plan-step-toggle"
            role="button"
            :aria-expanded="openSteps.has(idx)"
            @click="toggleStep(idx)"
            @keydown.enter.prevent="toggleStep(idx)"
            @keydown.space.prevent="toggleStep(idx)"
          >
            <span class="orch-plan-step-num" :class="`num-${item.status}`">
              <WsIcon v-if="item.status === 'completed'" name="check" size="xs" />
              <template v-else>{{ idx + 1 }}</template>
            </span>
            <span class="orch-plan-step-title" :class="{ 'step-done': stepDone(item) }">{{ item.title }}</span>
            <WsIcon name="chevron-down" size="xs" class="orch-plan-step-chevron" :class="{ collapsed: !openSteps.has(idx) }" />
          </button>
          <div v-show="openSteps.has(idx)" class="orch-plan-step-body">
            <div v-if="item.description" class="orch-plan-step-desc">{{ item.description }}</div>
            <div v-if="item.output" class="orch-plan-step-output">
              <div class="orch-plan-step-label">产出</div>
              <pre class="orch-plan-step-code">{{ item.output }}</pre>
            </div>
            <div v-if="item.reason" class="orch-plan-step-reason">{{ item.reason }}</div>
          </div>
        </div>
      </div>

      <!-- M3 详图入口卡（A4）：深水区模式 → 点击驱动右栏切对应详图（ToT/GoT/Supervisor/MultiAgent 入口） -->
      <div v-if="detailEntry" class="orch-detail-entry">
        <button
          type="button"
          class="orch-detail-btn"
          role="button"
          tabindex="0"
          @click="emit('open-detail', detailEntry.tab)"
          @keydown.enter.prevent="emit('open-detail', detailEntry.tab)"
          @keydown.space.prevent="emit('open-detail', detailEntry.tab)"
        >
          <WsIcon name="zoom-in" size="xs" />
          {{ detailEntry.label }}
        </button>
      </div>

      <!-- 终局结论（pipe_finished） -->
      <div v-if="run.finalMessage" class="orch-final">
        {{ run.finalMessage }}
      </div>
      <div
        v-else-if="run.status === 'finished'"
        class="orch-final orch-degraded"
      >
        {{ finishedReasonText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { usePlanStore } from '@worldsea/shared-composables/agent/usePlanStore'
import type { OrchestrationRunView, TracePhaseView } from '../composables/useOrchestrationTrace'

const props = defineProps<{ run: OrchestrationRunView }>()
const emit = defineEmits<{
  (e: 'abort-request'): void
  (e: 'open-detail', tab: string): void
}>()

const FIRST_HINT = '这是你的请求被处理的过程，点击可展开'
const FIRST_HINT_KEY = 'worldsea.orchestration-trace.first-hint-dismissed'

const collapsed = ref(props.run.status === 'finished')
const showFirstHint = ref(false)

onMounted(() => {
  // 首次弱提示：仅第一次看到迹线时显示一次（localStorage）
  try {
    if (!localStorage.getItem(FIRST_HINT_KEY)) {
      showFirstHint.value = true
      localStorage.setItem(FIRST_HINT_KEY, '1')
      // 5s 后自动消失（弱提示，不抢占视线）
      setTimeout(() => (showFirstHint.value = false), 5000)
    }
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
})

// ─── 2026-09-02 内联计划卡（B 类迁移配套）：plan_execute run 在过程层内联计划步骤 ───
// 步骤数据来自 usePlanStore（plan_created/plan_update 事件驱动，PlanStepUpdate.output 已透传）。
const planStore = usePlanStore()
const isPlanRun = computed(() => props.run.pipeline === 'research-plan' || props.run.pipeline === 'quick-plan')
const planItems = computed(() => (isPlanRun.value ? planStore.items.value : []))
const planProgress = computed(() => {
  const total = planItems.value.length
  const done = planItems.value.filter(i => i.status === 'completed' || i.status === 'skipped').length
  return { total, done }
})
/** 每步展开态（点击步骤头切换） */
const openSteps = ref<Set<number>>(new Set())
function toggleStep(idx: number): void {
  const next = new Set(openSteps.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  openSteps.value = next
}
function stepDone(item: { status: string }): boolean {
  return item.status === 'completed' || item.status === 'skipped'
}

const pipelineLabel = computed(() => {
  const map: Record<string, string> = {
    'research-plan': '规划执行',
    'quick-plan': '规划执行',
    tot: '思维树探索',
    got: '思维图聚合',
    supervisor: '监督委派',
    'multi-agent': '多智能体协作',
  }
  return map[props.run.pipeline] ?? props.run.pipeline
})

const durationText = computed(() => {
  const start = props.run.startedAt
  const end = props.run.finishedAt ?? Date.now()
  const sec = Math.max(1, Math.round((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`
})

/** 详图入口（M3，A4）：phase → 右栏详图 tab（深水区模式；plan/supervisor 也有独立面板） */
const detailEntry = computed<{ tab: string; label: string } | null>(() => {
  const phases = props.run.phases
  // 匹配深水区/面板阶段：任一阶段命中即提供入口（优先思维探索类）
  const hit =
    phases.find((p) => p.phase === 'tot' || p.phase === 'thought') ??
    phases.find((p) => p.phase === 'got' || p.phase === 'graph') ??
    phases.find((p) => p.phase === 'supervisor') ??
    phases.find((p) => p.phase === 'multi_agent')
  if (!hit) return null
  const map: Record<string, { tab: string; label: string }> = {
    tot: { tab: 'tot', label: '查看思维树' },
    thought: { tab: 'tot', label: '查看思维树' },
    got: { tab: 'got', label: '查看聚合图' },
    graph: { tab: 'got', label: '查看聚合图' },
    supervisor: { tab: 'supervisor', label: '查看委派现场' },
    multi_agent: { tab: 'multi', label: '查看协作黑板' },
  }
  return map[hit.phase] ?? null
})

function phaseDurationText(phase: TracePhaseView): string {
  const sec = Math.max(0, Math.round((phase.finishedAt! - phase.enteredAt) / 1000))
  return sec > 0 ? `${sec}s` : ''
}

const finishedReasonText = computed(() => {
  const r = props.run
  if (!r.convergeReason) return '已完成'
  const map: Record<string, string> = {
    goal_reached: '目标达成',
    threshold_met: '达到评审阈值',
    limit_reached: '达到次数上限（带当前最优结果）',
    no_progress: '无进展收敛',
    aborted: '已中止',
    degraded: '降级完成（已保留部分结果）',
  }
  return map[r.convergeReason] ?? r.convergeReason
})
</script>

<style scoped>
/* 编排段 — 索引级视觉（12-13px），三区布局 + 克制动效（A0-8~11） */
.orch-segment {
  position: relative;
  margin: 6px 0;
  border: 1px solid var(--ws-border, #e5e7eb);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--ws-surface-2, transparent);
}
.orch-segment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
.orch-segment-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 12px;
  border-radius: 4px;
}
.orch-segment-toggle:hover {
  background: var(--ws-hover-bg, rgba(0, 0, 0, 0.04));
}
.orch-pipeline {
  font-weight: 600;
  font-size: 12px;
}
.orch-reason {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}
.orch-stats {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 12px;
  margin-left: auto;
}
.orch-first-hint {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 12px;
  margin-left: auto;
}
.orch-abort {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--ws-border, #e5e7eb);
  border-radius: 4px;
  background: none;
  color: var(--ws-danger, #dc2626);
  cursor: pointer;
}
.orch-abort:hover {
  background: var(--ws-danger-bg, rgba(220, 38, 38, 0.08));
}
.orch-phases {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding-left: 4px;
}
.orch-phase {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 20px;
  min-height: 20px;
}
.orch-phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-pending {
  background: var(--ws-text-tertiary, #9ca3af);
}
.dot-running {
  background: var(--ws-primary, #3b82f6);
  animation: ws-orch-pulse 1.2s ease-in-out infinite;
}
.dot-success {
  background: var(--ws-success, #22c55e);
}
.dot-degraded {
  background: var(--ws-warning, #f59e0b);
}
.dot-failed {
  background: var(--ws-danger, #dc2626);
}
.dot-skipped {
  background: var(--ws-text-tertiary, #9ca3af);
}
@keyframes ws-orch-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.orch-phase-name {
  font-weight: 500;
  flex-shrink: 0;
}
.orch-phase-summary {
  color: var(--ws-text-secondary, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.orch-phase-duration {
  color: var(--ws-text-tertiary, #9ca3af);
  margin-left: auto;
  flex-shrink: 0;
}
.orch-final {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--ws-border, #e5e7eb);
  font-size: 12px;
  color: var(--ws-text, #111827);
  white-space: pre-wrap;
}

/* ═══ 2026-09-02 内联计划卡（plan_execute 步骤列表） ═══ */
.orch-plan-steps {
  margin-top: 8px;
  border-top: 1px solid var(--ws-border, #e5e7eb);
  padding-top: 6px;
}
.orch-plan-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 4px;
}
.orch-plan-title {
  font-weight: 600;
}
.orch-plan-meta {
  color: var(--ws-primary, #3b82f6);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.orch-plan-step {
  border-radius: 4px;
  margin-bottom: 2px;
}
.orch-plan-step-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 12px;
  text-align: left;
  border-radius: 4px;
}
.orch-plan-step-toggle:hover {
  background: var(--ws-hover-bg, rgba(0, 0, 0, 0.04));
}
.orch-plan-step-num {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--ws-text-secondary, #6b7280);
  border: 1px solid var(--ws-border, #e5e7eb);
}
.orch-plan-step-num.num-in_progress {
  background: var(--ws-primary, #3b82f6);
  color: #fff;
  border-color: transparent;
}
.orch-plan-step-num.num-completed {
  background: var(--ws-success, #22c55e);
  color: #fff;
  border-color: transparent;
}
.orch-plan-step-num.num-failed {
  background: var(--ws-danger, #dc2626);
  color: #fff;
  border-color: transparent;
}
.orch-plan-step-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orch-plan-step-title.step-done {
  color: var(--ws-text-tertiary, #9ca3af);
  text-decoration: line-through;
}
.orch-plan-step-chevron {
  color: var(--ws-text-tertiary, #9ca3af);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.orch-plan-step-chevron.collapsed {
  transform: rotate(-90deg);
}
.orch-plan-step-body {
  padding: 4px 8px 6px 28px;
}
.orch-plan-step-desc {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 12px;
  margin-bottom: 4px;
}
.orch-plan-step-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-text-tertiary, #9ca3af);
  margin-bottom: 2px;
}
.orch-plan-step-code {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--ws-hover-bg, rgba(0, 0, 0, 0.04));
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ws-text-secondary, #6b7280);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
.orch-plan-step-reason {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-danger, #dc2626);
}
.orch-degraded {
  color: var(--ws-text-secondary, #6b7280);
}
.orch-detail-entry {
  margin-top: 6px;
}
.orch-detail-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid var(--ws-border, #e5e7eb);
  border-radius: 4px;
  background: var(--ws-surface-2, transparent);
  color: var(--ws-primary, #3b82f6);
  cursor: pointer;
}
.orch-detail-btn:hover {
  background: var(--ws-hover-bg, rgba(0, 0, 0, 0.04));
}
</style>