<template>
  <div class="orchestrator-panel">
    <!-- 运行区 -->
    <div class="op-run">
      <div class="op-run-head">
        <span class="op-label">{{ title }}</span>
      </div>

      <!-- Supervisor 模式：委派目标（规格）选择器 -->
      <div v-if="mode === 'supervisor'" class="op-specs">
        <div class="op-specs-head">
          <span class="op-specs-label">委派给（{{ selectedIds.length }}/{{ specs.length }}）</span>
          <button v-if="specs.length" class="op-specs-toggle" @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</button>
        </div>
        <p v-if="!specs.length" class="op-specs-hint">
          暂无已配置的子 Agent 规格。请先到「子Agent」页新增规格（含 id / 能力描述 / 系统提示词）。
        </p>
        <ul v-else class="op-specs-list" role="group" aria-label="委派目标规格">
          <li
            v-for="s in specs"
            :key="s.id"
            class="op-specs-item"
            role="checkbox"
            :aria-checked="selectedIds.includes(s.id)"
            tabindex="0"
            @click="toggleOne(s.id)"
            @keydown.enter.prevent="toggleOne(s.id)"
            @keydown.space.prevent="toggleOne(s.id)"
          >
            <span class="op-specs-check" :class="{ on: selectedIds.includes(s.id) }" aria-hidden="true" />
            <span class="op-specs-main">
              <span class="op-specs-name">{{ s.name }}</span>
              <code class="op-specs-id">{{ s.id }}</code>
              <span class="op-specs-desc">{{ s.description }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div class="op-run-row">
        <input
          v-model="inputText"
          class="op-input"
          :placeholder="placeholder"
          :disabled="busy"
          @keydown.enter.prevent="runPerformed"
        />
        <button
          class="op-run-btn"
          :disabled="busy || !inputText.trim() || (mode === 'supervisor' && selectedIds.length === 0)"
          @click="runPerformed"
        >
          <template v-if="busy">运行中…</template>
          <template v-else>{{ runLabel }}</template>
        </button>
      </div>
      <div v-if="error" class="op-error">{{ error }}</div>
    </div>

    <!-- 实时区：运行中/刚结束的编排现场（ToT/GoT 思维树、Supervisor 委派日志） -->
    <div v-if="liveActive" class="op-live">
      <div class="op-live-label">
        实时
        <span v-if="mode !== 'supervisor'" class="op-live-status" :class="orchStatus === 'running' ? 'running' : ''">{{ orchStatusText }}</span>
      </div>

      <!-- ToT/GoT：思维树实时节点（树状可视化：父子连线/分支折叠/评分着色） -->
      <template v-if="mode !== 'supervisor' && treeRoots.length">
        <ThoughtTree :roots="treeRoots" />
        <div v-if="orchStatus === 'goal' || orchStatus === 'terminated'" class="op-live-done">
          <template v-if="orchStatus === 'goal'">目标达成</template>
          <template v-else>已终止</template>
          <template v-if="orchReason">：{{ orchReason }}</template>
          <span v-if="orchBest" class="op-live-best">（最优 {{ orchBest.thoughtId }} / {{ orchBest.score }} 分）</span>
        </div>
      </template>
      <p v-else-if="mode !== 'supervisor' && orchStatus === 'running'" class="op-live-empty">正在生成思维节点…</p>

      <!-- Supervisor：委派任务日志 -->
      <template v-if="mode === 'supervisor' && supervisorTasks.length">
        <ul class="op-live-tasks">
          <li
            v-for="(t, i) in supervisorTasks"
            :key="t.subAgentId + i"
            class="op-live-task"
            :class="`is-${t.status}`"
          >
            <span class="op-live-task-status" :title="t.status">{{ taskStatusText(t.status) }}</span>
            <span class="op-live-task-main">
              <span class="op-live-task-name">{{ t.subAgentName }}</span>
              <code class="op-live-task-id">{{ t.subAgentId }}</code>
            </span>
            <span class="op-live-task-desc">{{ t.taskDescription }}</span>
            <span v-if="t.status === 'completed'" class="op-live-task-out">
              {{ t.outputChars ?? 0 }} 字 · {{ t.durationMs ?? 0 }}ms
            </span>
          </li>
        </ul>
      </template>
    </div>

    <!-- 结果区  -->
    <div v-if="result" class="op-result">
      <div v-if="result.status" class="op-status">
        <span class="op-status-tag" :class="result.status">{{ statusText }}</span>
        <span v-if="result.iterations > 0" class="op-iterations">迭代 {{ result.iterations }}</span>
      </div>
      <div v-if="result.finalMessage" class="op-final">{{ result.finalMessage }}</div>
      <!-- 兜底：无实时节点时从终态 finalState 还原思维树 -->
      <div v-if="fallbackTreeEntries.length" class="op-tree">
        <div class="op-tree-label">思维节点 ({{ fallbackTreeEntries.length }})</div>
        <div class="op-tree-grid">
          <div v-for="(node, i) in fallbackTreeEntries" :key="i" class="op-tree-node">
            <span class="op-tree-idx">{{ node.idx }}</span>
            <span class="op-tree-text">{{ node.text }}</span>
            <span v-if="node.score !== undefined" class="op-tree-score">{{ node.score }}/100</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="!liveActive" class="op-empty">
      <TuiEmpty :icon="icon" :fill="false" :title="emptyTitle" :hint="emptyHint" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 编排模式单个面板（ToT / GoT / Supervisor 共用结构）。
 * 四段式：运行区（输入+运行）/ 实时区（现场事件：ToT/GoT 思维树、Supervisor 委派日志）/
 * 结果区（终态消息 + finalState 兜底思维节点）。遵循 agent-ux-guidelines。
 * 实时现场来自 useOrchEvents 单例（由 useAgentRust 会话生命周期注册 `agent:event:orch*` 监听）。
 * Supervisor 模式的委派目标复用 useSubagentRust 全局子 Agent 规格（勾选子集）。
 */
import { ref, computed, onMounted } from 'vue'
import TuiEmpty from '@/components/ui/TuiEmpty.vue'
import ThoughtTree from '../components/ThoughtTree.vue'
import { useToTRust } from '../composables/useToTRust'
import { useGoTRust } from '../composables/useGoTRust'
import { useSupervisorRust } from '../composables/useSupervisorRust'
import { useOrchEvents, type OrchTask } from '../composables/useOrchEvents'
import { useSubagentRust, type SubAgentSpec } from '@/subagent/composables/useSubagentRust'

const props = defineProps<{
  /** 模式：tot | got | supervisor */
  mode: string
  title: string
  icon: string
  placeholder: string
  runLabel: string
  emptyTitle: string
  emptyHint: string
}>()

// ToT/GoT/Supervisor 各自运行器（单例）＋编排实时现场（全局单例）＋子 Agent 规格（Supervisor 用）
const { busy, error, result, run, reset } = props.mode === 'tot'
  ? useToTRust()
  : props.mode === 'got'
    ? useGoTRust()
    : useSupervisorRust()
const orch = useOrchEvents()
const sub = useSubagentRust()
const { orchNodes, orchStatus, orchReason, orchBest, supervisorTasks } = orch
const { specs } = sub

const inputText = ref('')

// ─── Supervisor 委派目标（勾选规格）───
const selectedIds = ref<string[]>([])

const allSelected = computed(() => specs.value.length > 0 && selectedIds.value.length === specs.value.length)

function toggleOne(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id]
}
function toggleAll(): void {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = specs.value.map((s) => s.id)
  }
}

/** 从全局规格解析出勾选子集的完整规格（含 system_prompt，Supervisor 运行必需） */
function selectedSpecs(): SubAgentSpec[] {
  return specs.value.filter((s) => selectedIds.value.includes(s.id))
}

// ─── 实时现场可见性 ───
const liveActive = computed<boolean>(() => {
  if (props.mode === 'supervisor') return supervisorTasks.value.length > 0
  return orchStatus.value !== 'idle' || orchNodes.value.length > 0
})

/** 思维树节点（含 children，供递归树渲染） */
export interface ThoughtTreeNode {
  id: string
  parentId: string | null
  depth: number
  text: string
  score?: number
  children: ThoughtTreeNode[]
}

/**
 * 构建思维树（按 parentId 组织；父节点未知时归入根层）。
 * 流式下子节点可能先于父节点到达：先建立 id→node 索引，
 * 父节点未到时先把子节点挂到根，父节点到达后再挂回其下（通过 rebuild 扫描）。
 */
const treeRoots = computed<ThoughtTreeNode[]>(() => {
  const nodes = orchNodes.value
  if (!nodes.length) return []
  const byId = new Map<string, ThoughtTreeNode>()
  for (const n of nodes) {
    byId.set(n.id, { ...n, children: [] })
  }
  const roots: ThoughtTreeNode[] = []
  // 第一遍：挂到父（父存在时）
  const orphans: ThoughtTreeNode[] = []
  for (const n of nodes) {
    const node = byId.get(n.id)!
    const pid = node.parentId
    const parent = pid ? byId.get(pid) : undefined
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      orphans.push(node)
    }
  }
  // 第二遍：孤儿（父节点未到）先展示在根层；父节点到达后自然不再孤儿
  // （流式场景的降级：父节点补到时本轮已渲染为根，下一帧 reconcile）
  roots.push(...orphans)
  return roots
})

const orchStatusText = computed(() => {
  switch (orchStatus.value) {
    case 'running':
      return '思考中'
    case 'goal':
      return '目标达成'
    case 'terminated':
      return '已终止'
    default:
      return ''
  }
})

const statusText = computed(() => {
  const st = result.value?.status
  return st === 'completed' ? '完成' : st === 'aborted' ? '中止' : st === 'error' ? '错误' : st === 'timeout' ? '超时' : ''
})

function taskStatusText(s: OrchTask['status']): string {
  return s === 'assigned' ? '已分配' : s === 'running' ? '执行中' : '已完成'
}

// 兜底：无实时节点时从终态 finalState 提取思维树（兼容数组/近似结构）
const fallbackTreeEntries = computed<Array<{ idx: string; text: string; score?: unknown }>>(() => {
  if (!result.value || orchNodes.value.length) return []
  const fs = result.value.finalState as Record<string, unknown> | undefined
  if (!fs) return []
  const tree = (fs.tree ?? fs.nodes ?? fs.final_thought ?? fs.thoughts) as unknown[] | undefined
  if (!Array.isArray(tree)) return []
  return tree.slice(0, 30).map((n, i) => {
    const node = (n ?? {}) as Record<string, unknown>
    return {
      idx: String(node.id ?? node.node_id ?? i + 1),
      text: String(node.content ?? node.text ?? node.thought ?? ''),
      score: node.score ?? node.score_value,
    }
  })
})

async function runPerformed() {
  const text = inputText.value.trim()
  if (!text || busy.value) return
  reset()
  orch.resetOrchAll()
  if (props.mode === 'supervisor') {
    await run(text, { specs: selectedSpecs(), maxRounds: undefined })
  } else {
    await run(text)
  }
  inputText.value = ''
}

onMounted(async () => {
  await sub.refreshSpecs()
  // 首次进入默认全选（可运行即勾选全部已配置规格），用户可随时取消
  if (selectedIds.value.length === 0) {
    selectedIds.value = specs.value.map((s) => s.id)
  }
})
</script>

<style scoped>
.orchestrator-panel { display: flex; flex-direction: column; gap: 12px; }
.op-label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.op-run-head { margin-bottom: 6px; }
.op-run-row { display: flex; gap: 8px; }
.op-input { flex: 1; min-width: 0; padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-muted); color: var(--text-primary); font-size: var(--fs-sm); font-family: inherit; }
.op-input:focus { outline: none; border-color: var(--accent); }
.op-input:disabled { opacity: 0.6; }
.op-run-btn { border: none; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: var(--fs-xs); font-weight: 600; padding: 0 14px; cursor: pointer; transition: opacity 0.15s, transform 0.15s; }
.op-run-btn:hover:not(:disabled) { filter: brightness(1.05); }
.op-run-btn:active:not(:disabled) { transform: scale(var(--press-scale)); }
.op-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.op-error { margin-top: 8px; font-size: var(--fs-xs); color: var(--danger, #e5484d); word-break: break-word; }

/* Supervisor 规格选择器 */
.op-specs { margin-bottom: 2px; }
.op-specs-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.op-specs-label { font-size: var(--fs-xs); color: var(--text-secondary); }
.op-specs-toggle { border: none; background: transparent; color: var(--accent); font-size: var(--fs-xs); cursor: pointer; padding: 0; }
.op-specs-toggle:focus { outline: none; text-decoration: underline; }
.op-specs-hint { font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.5; margin: 0; }
.op-specs-list { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.op-specs-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.op-specs-item:hover { border-color: var(--accent); }
.op-specs-check { flex-shrink: 0; width: 16px; height: 16px; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; border: 1px solid var(--border-strong); background: var(--bg-surface); }
.op-specs-check.on { background: var(--accent); border-color: var(--accent); }
/* 勾选的 tick 用 CSS 绘制（SVG 允许；不用 emoji/图标字体） */
.op-specs-check.on::after { content: ''; width: 8px; height: 4px; border-left: 2px solid var(--on-accent); border-bottom: 2px solid var(--on-accent); transform: rotate(-45deg) translate(-1px, -1px); }
.op-specs-main { display: flex; flex-direction: column; min-width: 0; }
.op-specs-name { font-size: var(--fs-sm); color: var(--text-primary); font-weight: 600; }
.op-specs-id { font-size: var(--fs-2xs); color: var(--accent); background: var(--accent-soft); padding: 0 5px; border-radius: var(--radius-sm); align-self: flex-start; }
.op-specs-desc { font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.4; }

/* 实时区 */
.op-live { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-muted); }
.op-live-label { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.op-live-status { font-size: var(--fs-xs); font-weight: 600; text-transform: none; letter-spacing: 0; }
.op-live-status.running { color: var(--accent); }
.op-live-empty { font-size: var(--fs-xs); color: var(--text-muted); margin: 0; }
.op-live-tree { display: flex; flex-direction: column; gap: 3px; }
.op-live-tree-node { display: flex; align-items: baseline; gap: 6px; padding: 4px 6px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.op-live-depth { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-muted); }
.op-live-node-text { flex: 1; min-width: 0; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.op-live-score { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 600; color: var(--accent); }
.op-live-done { margin-top: 8px; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.5; }
.op-live-best { color: var(--accent); }
.op-live-tasks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.op-live-task { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.op-live-task.is-running { border-color: var(--accent); }
.op-live-task.is-completed { opacity: 0.85; }
.op-live-task-status { flex-shrink: 0; font-size: var(--fs-2xs); font-weight: 600; padding: 1px 6px; border-radius: 4px; }
.op-live-task-status.is-assigned { background: var(--bg-muted); color: var(--text-muted); }
.op-live-task.is-running .op-live-task-status { background: var(--accent-soft); color: var(--accent); }
.op-live-task.is-completed .op-live-task-status { background: var(--success-soft, rgba(46,160,67,.12)); color: var(--success, #2ea043); }
.op-live-task-main { display: inline-flex; align-items: baseline; gap: 6px; flex-shrink: 0; }
.op-live-task-name { font-size: var(--fs-xs); font-weight: 600; color: var(--text-primary); }
.op-live-task-id { font-size: var(--fs-2xs); color: var(--accent); background: var(--accent-soft); padding: 0 5px; border-radius: var(--radius-sm); }
.op-live-task-desc { flex: 1; min-width: 0; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-live-task-out { flex-shrink: 0; font-size: var(--fs-2xs); color: var(--text-muted); }

.op-result-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.op-status { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.op-status-tag { font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.op-status-tag.completed { background: var(--success-soft, rgba(46,160,67,.12)); color: var(--success, #2ea043); }
.op-status-tag.error { background: var(--danger-soft, rgba(229,72,77,.12)); color: var(--danger, #e5484d); }
.op-status-tag.aborted, .op-status-tag.timeout { background: var(--warning-soft, rgba(196,150,51,.12)); color: var(--warning, #c49633); }
.op-iterations { font-size: var(--fs-2xs); color: var(--text-muted); }
.op-final { font-size: var(--fs-sm); color: var(--text-primary); line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-muted); border: 1px solid var(--border); }

.op-tree { margin-top: 10px; }
.op-tree-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.op-tree-grid { display: flex; flex-direction: column; gap: 4px; }
.op-tree-node { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg-muted); border: 1px solid var(--border); }
.op-tree-idx { font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-muted); }
.op-tree-text { flex: 1; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.op-tree-score { font-size: var(--fs-xs); font-weight: 600; color: var(--accent); flex-shrink: 0; }
</style>