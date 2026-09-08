<script setup lang="ts">
/**
 * RunTreeSection：会话 run 树可视化（M3-RK1 前端可视化，轨迹 tab 新区块）
 *
 * 数据源 `useRunTree`（list_session_runs）：顶层 run + 子 run（委派 sub:*）树形展示。
 * 刷新时机：切换会话 / 切到轨迹 tab / 手动刷新（不轮询，RunStore 纯内存无增量事件）。
 * 交互：节点行可展开（终局结论截断 + 产出物/决策计数）；空态不渲染整块。
 * 遵循 SubAgentSection 区块风格（状态点 + 标签 + 折叠过渡 + 弱提示）。
 */
import { ref, computed, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useRunTree, type RunTreeNode } from '../composables/useRunTree'
import { useAgentRust } from '../composables/useAgentRust'
import { useSessionViewState } from '../composables/useSessionViewState'
import { useOrchestrationTrace } from '../composables/useOrchestrationTrace'
import RunNodeView from './RunNodeView.vue'

const { currentSessionId } = useAgentRust()
const vs = useSessionViewState()
const { runTree, loading, error, refresh } = useRunTree()
const { finishedRuns } = useOrchestrationTrace()

/** 轨迹 tab 激活（execTab 由 useSessionViewState 会话级持久，切 tab 响应） */
const execTab = computed(() => vs.activeState.value?.execTab ?? 'trace')

/** 会话切换 / 切到轨迹 tab → 刷新 */
watch(
  [currentSessionId, execTab],
  ([sid, tab]) => {
    if (sid && tab === 'trace') refresh()
  },
)

onMounted(() => {
  if (currentSessionId.value && execTab.value === 'trace') refresh()
})

/**
 * 编排 run 收口 → 延迟刷新（v-show 常驻挂载时切会话/切 tab 均不触发，需此信号补位）。
 * pipe_finished 到达时后端 run_* 的 artifacts 写入/finish 收口可能未完，延迟 500ms 再拉。
 */
watch(
  () => finishedRuns.value.length,
  (n, old) => {
    if (n > (old ?? 0) && currentSessionId.value) {
      setTimeout(refresh, 500)
    }
  },
)

// ── 折叠状态：整块收拢（保留区块标题）+ 节点详情展开（按 run_id） ──
const collapsed = ref(false)
const expanded = ref<Record<string, boolean>>({})

function toggleNode(runId: string): void {
  expanded.value = { ...expanded.value, [runId]: !expanded.value[runId] }
}

// ── 统计（顶部状态栏） ──
const totalCount = computed(() => runTree.value.length)
const runningCount = computed(() => {
  let n = 0
  const walk = (nodes: RunTreeNode[]): void => {
    for (const node of nodes) {
      if (node.run.status === 'running') n++
      walk(node.children)
    }
  }
  walk(runTree.value)
  return n
})
</script>

<template>
  <!-- 无 run 记录且非加载中时，不渲染整块（与 SubAgentSection 空态约定一致） -->
  <div v-if="runTree.length > 0 || loading" class="run-tree-section">
    <div class="bar">
      <span class="bar-title">
        <WsIcon name="workflow" :size="13" :stroke-width="1.7" />
        运行树
      </span>
      <span v-if="runningCount" class="chip running">
        <span class="chip-dot" />运行中 {{ runningCount }}
      </span>
      <span class="chip count">{{ totalCount }} 顶层</span>
      <button
        class="refresh"
        :title="loading ? '刷新中…' : '刷新运行树'"
        :aria-label="loading ? '刷新中…' : '刷新运行树'"
        :disabled="loading"
        @click="refresh"
      >
        <WsIcon name="refresh" :size="13" :stroke-width="1.7" :class="{ spinning: loading }" />
      </button>
      <button
        class="collapse"
        :title="collapsed ? '展开运行树' : '收起运行树'"
        :aria-label="collapsed ? '展开运行树' : '收起运行树'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <WsIcon :name="collapsed ? 'chevron-right' : 'chevron-down'" :size="14" :stroke-width="1.7" />
      </button>
    </div>

    <!-- 错误弱提示：仅一行，不打断面板 -->
    <p v-if="error" class="err">{{ error }}</p>

    <Transition name="run-tree">
      <ul v-show="!collapsed" class="tree" role="tree" aria-label="运行树">
        <li v-for="node in runTree" :key="node.run.run_id" role="treeitem">
          <RunNodeView
            :node="node"
            :depth="0"
            :expanded-map="expanded"
            @toggle="toggleNode"
          />
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.run-tree-section {
  max-width: var(--chat-max-w);
  margin: 0 auto;
  border-top: 1px solid var(--border);
  padding: 10px var(--chat-gutter);
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-surface);
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--fs-sm);
}
.bar-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--text-primary);
}
.refresh,
.collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.refresh {
  margin-left: auto;
}
.refresh:hover,
.collapse:hover {
  color: var(--text-primary);
  background: var(--bg-muted);
}
.refresh:active,
.collapse:active {
  transform: scale(var(--press-scale));
}
.refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.refresh .spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
}
.chip-dot {
  width: var(--dot-sm);
  height: var(--dot-sm);
  border-radius: 50%;
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
.chip.running {
  background: var(--accent-soft);
  color: var(--accent);
}
.chip.count {
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.err {
  font-size: var(--fs-xs);
  color: var(--danger);
  margin: 0 0 6px;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.run-tree-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.run-tree-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.run-tree-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.run-tree-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
