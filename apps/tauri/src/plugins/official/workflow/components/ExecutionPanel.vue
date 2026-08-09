<template>
  <div class="ep-panel">
    <!-- ── Agent 通道（原内容） ───────────────────────────────── -->

    <!-- 进度条 -->
    <div class="ep-progress">
      <div class="ep-progress__bar" :style="{ width: progress + '%' }"></div>
      <span class="ep-progress__text">{{ progress }}%</span>
    </div>

    <!-- 当前执行步骤 -->
    <div v-if="currentStep" class="ep-current">
      <span class="ep-current__label">正在执行：</span>
      <span class="ep-current__step">{{ currentStep.title }}</span>
      <span class="ep-current__type">{{ typeLabel(currentStep.type) }}</span>
    </div>

    <!-- 子 Agent 状态 -->
    <div v-if="activeSubAgents.length > 0" class="ep-agents">
      <div v-for="agent in activeSubAgents" :key="agent.id" class="ep-agent">
        <span class="ep-agent__icon">{{ agent.icon }}</span>
        <span class="ep-agent__name">{{ agent.name }}</span>
        <span class="ep-agent__status" :class="`agent-status--${agent.status}`">
          {{ agentStatusLabel(agent.status) }}
        </span>
        <span v-if="agent.duration" class="ep-agent__duration">
          {{ formatDuration(agent.duration) }}
        </span>
      </div>
    </div>

    <!-- 执行日志 -->
    <div v-if="executionLog.length > 0" class="ep-log">
      <h4 class="ep-log__title">执行日志</h4>
      <div v-for="(msg, i) in executionLog" :key="i" class="ep-log__line">{{ msg }}</div>
    </div>

    <div v-if="!currentStep && executionLog.length === 0 && activeSubAgents.length === 0 && !engineState" class="ep-idle">
      <p>等待执行... 点击「交给 Agent 执行」或「⚡ 直接执行」</p>
    </div>

    <!-- ── Engine 通道（直接 Dispatch 兜底） ───────────────────── -->

    <div v-if="engineState" class="ep-engine">
      <div class="ep-engine__header">
        <span class="ep-engine__badge" :class="`ep-engine__badge--${engineState.status}`">
          ⚡ Engine · {{ engineStatusLabel(engineState.status) }}
        </span>
        <span v-if="engineState.runId" class="ep-engine__runid" :title="engineState.runId">
          run: {{ engineState.runId.slice(0, 8) }}
        </span>
        <button
          v-if="engineState.status === 'running'"
          class="ep-engine__cancel"
          @click="$emit('cancel-engine')"
        >取消</button>
      </div>

      <!-- Engine 进度条 -->
      <div class="ep-engine__progress">
        <div
          class="ep-engine__progress-bar"
          :class="`ep-engine__progress-bar--${engineState.status}`"
          :style="{ width: (engineState.progress * 100).toFixed(0) + '%' }"
        ></div>
        <span class="ep-engine__progress-text">
          {{ (engineState.progress * 100).toFixed(0) }}%
        </span>
      </div>

      <!-- 当前节点 -->
      <div v-if="engineState.currentNodeId" class="ep-engine__current">
        <span class="ep-engine__current-label">当前节点：</span>
        <code class="ep-engine__current-node">{{ engineState.currentNodeId }}</code>
      </div>

      <!-- 错误 -->
      <div v-if="engineState.error" class="ep-engine__error">
        {{ engineState.error }}
      </div>

      <!-- Engine 日志 -->
      <div v-if="engineState.log.length > 0" class="ep-engine__log">
        <div
          v-for="(line, i) in engineState.log"
          :key="i"
          class="ep-engine__log-line"
        >{{ line }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineStep, StepType } from '../types'
import { STEP_TYPE_LABELS } from '../composables/useStepLibrary'
import { useOrchestrator } from '@/agent/composables/useOrchestrator'
import type { EngineRunState, EngineRunStatus } from '../composables/useWorkflowEngineRun'

const props = defineProps<{
  currentStep: PipelineStep | null
  progress: number
  executionLog: string[]
  /** Engine 通道状态（直接 Dispatch 兜底）；不传则不显示该区域 */
  engineState?: EngineRunState | null
}>()

defineEmits<{
  'cancel-engine': []
}>()

const { getSubAgents } = useOrchestrator()

/** 获取当前活跃的子 Agent（与 Pipeline 相关的） */
const activeSubAgents = computed(() => {
  return getSubAgents().filter(a =>
    a.id.startsWith('pipeline-') &&
    (a.status === 'running' || a.status === 'pending')
  )
})

function typeLabel(type: StepType): string {
  return STEP_TYPE_LABELS[type] || type
}

function agentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    timeout: '超时',
    cancelled: '已取消',
  }
  return map[status] || status
}

function engineStatusLabel(status: EngineRunStatus): string {
  const map: Record<EngineRunStatus, string> = {
    idle: '空闲',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    unknown: '未知',
  }
  return map[status] || status
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
.ep-panel {
  flex-shrink: 0;
}

.ep-progress {
  height: 4px; background: var(--bg-tertiary, #21262d); border-radius: 2px;
  position: relative; overflow: hidden;
}
.ep-progress__bar { height: 100%; background: var(--success, #3fb950); border-radius: 2px; transition: width 0.3s; }
.ep-progress__text { position: absolute; right: 0; top: -16px; font-size: var(--fs-xs); opacity: 0.5; }

.ep-current {
  margin-top: 8px; padding: 8px 10px; background: var(--bg-tertiary, #21262d);
  border-radius: var(--radius-sm); display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm);
}
.ep-current__label { opacity: 0.6; }
.ep-current__step { font-weight: 500; }
.ep-current__type { font-size: var(--fs-xs); opacity: 0.5; margin-left: auto; }

.ep-agents {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ep-agent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-tertiary, #21262d);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}
.ep-agent__icon { font-size: var(--fs-base); }
.ep-agent__name { font-weight: 500; }
.ep-agent__status { font-size: var(--fs-xs); margin-left: auto; }
.agent-status--running { color: var(--warning, #d29922); }
.agent-status--pending { color: var(--text-secondary, #8b949e); }
.agent-status--completed { color: var(--success, #3fb950); }
.agent-status--failed { color: var(--danger, #f85149); }
.ep-agent__duration { font-size: var(--fs-xs); opacity: 0.5; }

.ep-log { margin-top: 8px; padding: 12px; background: var(--bg-tertiary, #21262d); border-radius: 8px; }
.ep-log__title { margin: 0 0 8px; font-size: var(--fs-md); opacity: 0.7; }
.ep-log__line { font-size: var(--fs-sm); font-family: monospace; opacity: 0.6; line-height: 1.6; }

.ep-idle { text-align: center; padding: 24px; opacity: 0.4; font-size: var(--fs-md); }

/* ── Engine 通道样式 ─────────────────────────────────────────── */
.ep-engine {
  margin-top: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--success, #3fb950) 6%, var(--bg-secondary, #161b22));
  border: 1px solid color-mix(in srgb, var(--success, #3fb950) 25%, transparent);
  border-radius: 8px;
}
.ep-engine__header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.ep-engine__badge {
  font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: 4px;
  background: var(--bg-tertiary, #21262d);
}
.ep-engine__badge--running { color: var(--warning, #d29922); }
.ep-engine__badge--completed { color: var(--success, #3fb950); }
.ep-engine__badge--failed { color: var(--danger, #f85149); }
.ep-engine__badge--cancelled { color: var(--text-secondary, #8b949e); }
.ep-engine__badge--idle { color: var(--text-secondary, #8b949e); }
.ep-engine__badge--unknown { color: var(--text-secondary, #8b949e); }

.ep-engine__runid {
  font-size: var(--fs-xs); opacity: 0.5; font-family: monospace;
  margin-left: auto;
}

.ep-engine__cancel {
  padding: 2px 10px; border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--danger, #f85149) 40%, transparent);
  background: transparent; color: var(--danger, #f85149);
  font-size: var(--fs-xs); cursor: pointer;
}
.ep-engine__cancel:hover {
  background: color-mix(in srgb, var(--danger, #f85149) 12%, transparent);
}

.ep-engine__progress {
  margin-top: 8px; height: 4px;
  background: var(--bg-tertiary, #21262d);
  border-radius: 2px; position: relative; overflow: hidden;
}
.ep-engine__progress-bar {
  height: 100%; border-radius: 2px; transition: width 0.3s;
  background: var(--success, #3fb950);
}
.ep-engine__progress-bar--failed { background: var(--danger, #f85149); }
.ep-engine__progress-bar--cancelled { background: var(--text-secondary, #8b949e); }
.ep-engine__progress-text {
  position: absolute; right: 0; top: -16px;
  font-size: var(--fs-xs); opacity: 0.5;
}

.ep-engine__current {
  margin-top: 8px; font-size: var(--fs-sm); opacity: 0.7;
}
.ep-engine__current-label { opacity: 0.6; }
.ep-engine__current-node {
  font-family: monospace; font-size: var(--fs-xs);
  padding: 1px 6px; border-radius: 3px;
  background: var(--bg-tertiary, #21262d);
}

.ep-engine__error {
  margin-top: 8px; padding: 6px 10px;
  background: color-mix(in srgb, var(--danger, #f85149) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger, #f85149) 30%, transparent);
  border-radius: 4px; font-size: var(--fs-sm); color: var(--danger, #f85149);
}

.ep-engine__log {
  margin-top: 8px; max-height: 160px; overflow: auto;
  padding: 6px 8px; background: var(--bg-tertiary, #21262d);
  border-radius: 4px;
}
.ep-engine__log-line {
  font-size: var(--fs-xs); font-family: monospace; opacity: 0.7;
  line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
</style>
