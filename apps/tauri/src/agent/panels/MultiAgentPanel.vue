<template>
  <div class="multi-panel">
    <!-- 运行区 -->
    <div class="mp-run">
      <div class="mp-run-head">
        <span class="mp-label">多 Agent 协作</span>
      </div>
      <div class="mp-run-row">
        <input
          v-model="inputText"
          class="mp-input"
          placeholder="输入任务，由多 Agent 共享黑板协作完成…"
          :disabled="busy"
          @keydown.enter.prevent="run"
        />
        <button class="mp-run-btn" :disabled="busy || !inputText.trim() || !agents.length" @click="run">
          <template v-if="busy">协作中…</template>
          <template v-else>开始协作</template>
        </button>
      </div>
      <div v-if="error" class="mp-error">{{ error }}</div>
    </div>

    <!-- 协作 Agent 配置（默认折叠，弱提示分级显隐） -->
    <div class="mp-config">
      <button class="mp-collapse" :aria-expanded="configOpen" @click="configOpen = !configOpen">
        <WsIcon name="chevron-right" :size="13" :stroke-width="1.7" :class="{ spin90: configOpen }" />
        <span>协作 Agent（{{ agents.length }}）</span>
        <span class="mp-config-hint">配置</span>
      </button>
      <div v-show="configOpen" class="mp-config-body">
        <div class="mp-agent-list">
          <div v-for="(a, i) in agents" :key="i" class="mp-agent-row">
            <div class="mp-agent-fields">
              <input v-model="a.id" class="mp-cell mp-cell-id" placeholder="ID" aria-label="Agent ID" />
              <input v-model="a.name" class="mp-cell" placeholder="名称" aria-label="Agent 名称" />
              <TuiSelect
                :model-value="a.role"
                :options="roleOptions"
                size="sm"
                class="mp-role-select"
                aria-label="角色"
                @update:model-value="(v: string) => (a.role = v)"
              />
            </div>
            <textarea v-model="a.description" class="mp-cell mp-cell-desc" rows="1" placeholder="能力描述" aria-label="能力描述" />
            <textarea v-model="a.system_prompt" class="mp-cell mp-cell-prompt" rows="2" placeholder="系统提示词（定义专长与行为边界）" aria-label="系统提示词" />
            <input v-model="a.initial_message" class="mp-cell" placeholder="初始消息（可选，建议首个 Agent 配置）" aria-label="初始消息" />
            <button class="mp-cell-del" :disabled="busy" :aria-label="`删除 Agent ${a.name || a.id}`" @click="agents.splice(i, 1)"><WsIcon name="trash" :size="13" :stroke-width="1.7" /></button>
          </div>
        </div>
        <button class="mp-add" :disabled="busy" @click="addAgent"><WsIcon name="plus" :size="13" :stroke-width="1.7" />添加 Agent</button>
        <div class="mp-advanced">
          <label class="mp-field-label">
            <span>拓扑</span>
            <TuiSelect
              :model-value="topology"
              :options="topologyOptions"
              size="sm"
              class="mp-topo-select"
              aria-label="拓扑"
              @update:model-value="(v: string) => (topology = v as 'mesh' | 'ring' | 'star' | 'pipeline')"
            />
          </label>
          <label class="mp-field-label">
            <span>最大轮次</span>
            <input v-model.number="maxRounds" type="number" min="1" class="mp-cell" aria-label="最大轮次" />
          </label>
          <label class="mp-field-label mp-check">
            <input type="checkbox" v-model="requireSynthesis" />
            <span>最后综合输出</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 协作状态区（实时事件投影：轮次/消息/黑板/收敛） -->
    <div v-if="liveState" class="mp-live">
      <div class="mp-live-head">
        <span class="mp-live-title">协作现场</span>
        <span class="mp-live-status" :class="`st-${liveState.runStatus}`">{{ statusText }}</span>
      </div>
      <div class="mp-counter-grid">
        <div class="mp-counter"><span class="mp-counter-label">轮次</span><span class="mp-counter-value">{{ liveState.currentRound || liveState.roundsCompleted }}</span></div>
        <div class="mp-counter"><span class="mp-counter-label">消息</span><span class="mp-counter-value">{{ liveState.messagesSent }}</span></div>
        <div class="mp-counter"><span class="mp-counter-label">黑板更新</span><span class="mp-counter-value">{{ liveState.blackboardUpdates }}</span></div>
      </div>
      <div v-if="liveState.finalResult" class="mp-final">
        <span class="mp-final-label">最终结果</span>
        <div class="mp-final-content">{{ liveState.finalResult }}</div>
      </div>
      <div v-if="liveEvents.length" class="mp-events">
        <div class="mp-events-label">事件流（{{ liveState.events.length }}）</div>
        <div class="mp-event-list">
          <div v-for="(evt, idx) in liveEvents" :key="idx" class="mp-event-item" :class="`evt-${levelOf(evt)}`">
            <WsIcon :name="iconOf(evt)" size="xs" class="mp-event-icon" />
            <span class="mp-event-text">{{ formatEvent(evt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 结果区 -->
    <div v-if="result" class="mp-result">
      <div v-if="result.finalMessage" class="mp-final">{{ result.finalMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MultiAgentPanel：Multi-Agent 协作面板（编排 4 模式 UI 下沉之 MultiAgent 样板）。
 * 四段式：运行区 / 配置区（折叠） / 协作现场（实时事件投影） / 结果区。
 * 复用 useMultiAgentRust 单例：run 触发 orchestrator_run_multi，orch_multi 事件实时回传轮次/消息/黑板/收敛。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiSelect from '@/components/ui/TuiSelect.vue'
import { useMultiAgentRust, type RustAgentSpec, type MultiAgentEvent, type MultiAgentSessionState } from '../composables/useMultiAgentRust'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import { useAgentRust } from '../composables/useAgentRust'

const ma = useMultiAgentRust()
const { sessions } = ma
const { currentSessionId } = useAgentRust()

const configOpen = ref(false)
const inputText = ref('')
const error = ref('')
const busy = ref(false)
const result = ref<{ finalMessage: string | null } | null>(null)

// 协作 Agent 配置（表单态；保存即用）
const agents = reactive<RustAgentSpec[]>([])
const topology = ref<'mesh' | 'ring' | 'star' | 'pipeline'>('mesh')
const maxRounds = ref<number | null>(null)
const requireSynthesis = ref(true)

// 角色 / 拓扑选项（TuiSelect，与配置层统一）
const roleOptions = [
  { value: 'coordinator', label: '协调者' },
  { value: 'worker', label: '执行者' },
  { value: 'critic', label: '评审者' },
  { value: 'researcher', label: '研究者' },
  { value: 'creative', label: '创意者' },
  { value: 'custom', label: '自定义' },
]
const topologyOptions = [
  { value: 'mesh', label: '全连接（mesh）' },
  { value: 'ring', label: '环形（ring）' },
  { value: 'star', label: '星型（star）' },
  { value: 'pipeline', label: '流水线（pipeline）' },
]

function addAgent(): void {
  agents.push({
    id: `agent${agents.length + 1}`,
    name: `Agent ${agents.length + 1}`,
    role: agents.length === 0 ? 'coordinator' : 'worker',
    description: '',
    system_prompt: '',
    initial_message: agents.length === 0 ? '完成用户任务，并与其他 Agent 协作' : null,
  })
}

function toSpecs(): RustAgentSpec[] {
  return agents
    .map((a) => ({
      id: a.id.trim(),
      name: a.name.trim() || a.id.trim(),
      role: a.role,
      description: a.description.trim(),
      system_prompt: a.system_prompt.trim(),
      initial_message: a.initial_message?.trim() || null,
    }))
    .filter((a) => a.id && a.name && a.system_prompt)
}

function toTopology(): { kind: 'mesh' } | { kind: 'ring' } | { kind: 'star'; hubId: string } | { kind: 'pipeline' } {
  const kind = topology.value
  if (kind === 'star') {
    // 星型：中心 Agent = 第一个配置的 Agent（协调者）
    const hubId = agents[0]?.id.trim() || 'coordinator'
    return { kind: 'star', hubId }
  }
  return { kind }
}

/** 当前会话的 Multi-Agent 实时状态；重启后内存无该会话时，从持久化摘要水合徽标（事件流不可恢复） */
const liveState = computed<MultiAgentSessionState | null>(() => {
  const sid = currentSessionId.value
  if (!sid) return null
  const live = sessions.value.get(sid)
  if (live) return live
  const summary = useSessionViewState().activeState.value?.multiSummary
  if (!summary) return null
  return {
    runStatus: summary.converged ? 'done' : 'running',
    blackboardSnapshot: null,
    events: [],
    roundsCompleted: summary.rounds,
    currentRound: 0,
    currentAgentCount: 0,
    messagesSent: summary.messageCount,
    blackboardUpdates: 0,
    currentTask: '',
    finalResult: null,
    convergenceReason: null,
    lastError: null,
    errorAgentId: null,
  }
})
const liveEvents = computed(() => (liveState.value ? [...liveState.value.events].slice(-30).reverse() : []))

const statusText = computed(() => {
  switch (liveState.value?.runStatus) {
    case 'running': return '协作中'
    case 'done': return '已完成'
    case 'aborted': return '已中断'
    case 'error': return '出错'
    default: return '空闲'
  }
})

async function run(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || busy.value) return
  const sid = currentSessionId.value
  if (!sid) {
    error.value = '无活动会话，请先新建或切换会话'
    return
  }
  const specs = toSpecs()
  if (!specs.length) {
    error.value = '请至少配置一个含系统提示词的 Agent'
    return
  }
  busy.value = true
  error.value = ''
  result.value = null
  try {
    // 复用当前会话 id 作为 Multi-Agent 会话（与 StatusBar sessionId 约定一致）
    const res = await ma.run(sid, text, {
      specs,
      maxRounds: maxRounds.value ?? undefined,
      topology: toTopology(),
      requireSynthesis: requireSynthesis.value,
    })
    result.value = { finalMessage: (res as { finalMessage: string | null })?.finalMessage ?? null }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

// ─── 事件格式化（与 MultiAgentStatusBar 同语言） ───
function levelOf(evt: MultiAgentEvent): 'normal' | 'info' | 'success' | 'critical' {
  switch (evt.type) {
    case 'multiAgentConverged': return 'success'
    case 'multiAgentError': return 'critical'
    case 'multiAgentRoundStarted':
    case 'multiAgentRoundCompleted': return 'info'
    default: return 'normal'
  }
}
function iconOf(evt: MultiAgentEvent): string {
  switch (evt.type) {
    case 'multiAgentRoundStarted': return 'play-circle'
    case 'multiAgentRoundCompleted': return 'check-circle'
    case 'multiAgentMessageSent': return 'send'
    case 'multiAgentBlackboardUpdated': return 'database'
    case 'multiAgentConverged': return 'target'
    case 'multiAgentError': return 'alert'
    default: return 'info'
  }
}
function formatEvent(evt: MultiAgentEvent): string {
  switch (evt.type) {
    case 'multiAgentRoundStarted':
      return `[轮次 ${evt.round}] 开始（${evt.agentCount} 个 Agent 参与）`
    case 'multiAgentRoundCompleted':
      return `[轮次 ${evt.round}] 完成（产出 ${evt.outputs?.length ?? 0} 条）`
    case 'multiAgentMessageSent':
      return `[${evt.from} → ${evt.to}] ${evt.messageType}: ${truncate(evt.contentPreview, 40)}`
    case 'multiAgentBlackboardUpdated':
      return `黑板更新: ${evt.key} (by ${evt.by})`
    case 'multiAgentConverged':
      return `协作收敛: ${formatReason(evt.reason)}`
    case 'multiAgentError':
      return `[${evt.agentId}] ${evt.error}`
    default:
      return JSON.stringify(evt)
  }
}
function formatReason(reason: string): string {
  switch (reason) {
    case 'GoalReached': return '目标达成'
    case 'MaxRoundsReached': return '达最大轮次'
    case 'AllAgentsIdle': return '所有 Agent 空闲'
    case 'Aborted': return '手动中断'
    default: return reason
  }
}
function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text ?? ''
  return text.slice(0, maxLen) + '...'
}

// 默认预置 3 个协作 Agent（协调者 + 执行者 + 评审者），便于快速体验
function seedDefaultAgents(): void {
  if (agents.length) return
  agents.push(
    {
      id: 'coordinator', name: '协调者', role: 'coordinator',
      description: '拆解任务、分配子任务、汇总各 Agent 结果',
      system_prompt: '你是协作协调者。拆解用户任务为可执行子任务，分配给合适的 Agent，最后综合各方结果给出完整回答。',
      initial_message: '完成用户任务，并与其他 Agent 协作。',
    },
    {
      id: 'researcher', name: '研究者', role: 'researcher',
      description: '信息检索、分析、资料整理',
      system_prompt: '你是研究者。负责信息检索与分析，产出结构化资料供其他 Agent 使用。',
    },
    {
      id: 'critic', name: '评审者', role: 'critic',
      description: '审查输出质量，指出问题与改进建议',
      system_prompt: '你是评审者。审查其他 Agent 的输出，指出问题并提出改进建议，确保最终结果高质量。',
    },
  )
}

onMounted(seedDefaultAgents)
onBeforeUnmount(() => {})
</script>

<style scoped>
.multi-panel { display: flex; flex-direction: column; gap: 12px; }
.mp-label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.mp-run-head { margin-bottom: 6px; }
.mp-run-row { display: flex; gap: 8px; }
.mp-input { flex: 1; min-width: 0; padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-muted); color: var(--text-primary); font-size: var(--fs-sm); font-family: inherit; }
.mp-input:focus { outline: none; border-color: var(--accent); }
.mp-input:disabled { opacity: 0.6; }
.mp-run-btn { border: none; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: var(--fs-xs); font-weight: 600; padding: 0 14px; cursor: pointer; transition: opacity 0.15s, transform 0.15s; }
.mp-run-btn:hover:not(:disabled) { filter: brightness(1.05); }
.mp-run-btn:active:not(:disabled) { transform: scale(var(--press-scale)); }
.mp-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mp-error { margin-top: 8px; font-size: var(--fs-xs); color: var(--danger, #e5484d); word-break: break-word; }

/* 配置区 */
.mp-config { border-top: 1px solid var(--border); padding-top: 2px; }
.mp-collapse { display: flex; align-items: center; gap: 5px; padding: 4px 0; width: 100%; background: none; border: none; font-size: var(--fs-xs); color: var(--text-secondary); cursor: pointer; user-select: none; }
.mp-collapse:hover { color: var(--text-primary); }
.mp-collapse .spin90 { transition: transform 0.2s; }
.mp-collapse .spin90.spin90 { transform: rotate(90deg); }
.mp-config-hint { margin-left: auto; font-size: var(--fs-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: .4px; }
.mp-config-body { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 2px; }
.mp-agent-list { display: flex; flex-direction: column; gap: 6px; }
.mp-agent-row { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: var(--radius-sm); background: var(--bg-muted); border: 1px solid var(--border); }
.mp-agent-fields { display: flex; gap: 4px; }
.mp-cell { width: 100%; box-sizing: border-box; padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary); font-size: var(--fs-xs); font-family: inherit; }
.mp-cell:focus { outline: none; border-color: var(--accent); }
.mp-cell-id { font-family: var(--font-mono); font-size: var(--fs-2xs); max-width: 120px; }
.mp-role-select { width: 110px; flex-shrink: 0; }
.mp-cell-desc { resize: vertical; }
.mp-cell-prompt { resize: vertical; }
.mp-cell-del { align-self: flex-start; border: none; background: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: var(--radius-sm); }
.mp-cell-del:hover { color: var(--danger, #e5484d); background: var(--bg-surface); }
.mp-add { display: inline-flex; align-items: center; gap: 5px; border: 1px dashed var(--border); background: none; color: var(--text-muted); font-size: var(--fs-xs); padding: 5px 10px; border-radius: var(--radius-sm); cursor: pointer; }
.mp-add:hover { color: var(--accent); border-color: var(--accent); }
.mp-add:disabled { opacity: 0.5; cursor: not-allowed; }
.mp-advanced { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px; }
.mp-field-label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-secondary); }
.mp-field-label .mp-cell { width: auto; max-width: 160px; }
.mp-field-label .mp-topo-select { width: 150px; }
.mp-check input { accent-color: var(--accent); cursor: pointer; }

/* 协作现场 */
.mp-live { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-muted); }
.mp-live-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mp-live-title { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.mp-live-status { font-size: var(--fs-xs); font-weight: 600; }
.mp-live-status.st-running { color: var(--accent); }
.mp-live-status.st-done { color: var(--success, #2ea043); }
.mp-live-status.st-aborted { color: var(--warning, #c49633); }
.mp-live-status.st-error { color: var(--danger, #e5484d); }
.mp-counter-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
.mp-counter { display: flex; flex-direction: column; align-items: center; padding: 6px 4px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.mp-counter-label { font-size: var(--fs-2xs); color: var(--text-muted); }
.mp-counter-value { font-size: var(--fs-base); font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mp-final { margin-top: 4px; }
.mp-final-label { font-size: var(--fs-xs); color: var(--text-secondary); font-weight: 600; margin-bottom: 4px; display: block; }
.mp-final-content { font-size: var(--fs-xs); color: var(--text-primary); line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.mp-events { margin-top: 10px; }
.mp-events-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.mp-event-list { display: flex; flex-direction: column; gap: 3px; max-height: 180px; overflow-y: auto; }
.mp-event-item { display: flex; align-items: baseline; gap: 6px; padding: 4px 6px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.mp-event-item.evt-success { border-color: var(--success-soft, rgba(46,160,67,.12)); }
.mp-event-item.evt-critical { border-color: var(--danger-soft, rgba(229,72,77,.12)); }
.mp-event-icon { color: var(--text-muted); flex-shrink: 0; }
.mp-event-text { flex: 1; min-width: 0; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-result { margin-top: 2px; }
</style>