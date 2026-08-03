<template>
  <div class="got-graph-view">
    <!-- 空状态 -->
    <div v-if="!sessionId" class="got-graph-empty">未激活 GoT 会话</div>
    <div v-else-if="loading && !graphSnapshot" class="got-graph-empty">加载思维图中...</div>
    <div v-else-if="!graphSnapshot || graphSnapshot.nodes.length === 0" class="got-graph-empty">
      暂无思维节点
    </div>

    <!-- 图视图：按深度分层的列表式可视化 -->
    <div v-else class="got-graph-list">
      <div class="got-graph-summary">
        <span>共 {{ graphSnapshot.totalCount }} 节点</span>
        <span>·</span>
        <span>最大深度 {{ graphSnapshot.maxDepthReached }}</span>
        <span v-if="aggregationCount > 0">·</span>
        <span v-if="aggregationCount > 0" class="got-agg-count">
          聚合 {{ aggregationCount }} 次
        </span>
        <span v-if="graphSnapshot.bestNodeId">·</span>
        <span v-if="graphSnapshot.bestNodeId" class="got-best-id">
          最优: {{ shortId(graphSnapshot.bestNodeId) }}
        </span>
      </div>

      <!-- 按深度分组渲染 -->
      <div
        v-for="layer in layers"
        :key="layer.depth"
        class="got-layer"
      >
        <div class="got-layer-header">
          <span class="got-layer-depth">D{{ layer.depth }}</span>
          <span class="got-layer-count">{{ layer.nodes.length }} 节点</span>
          <span v-if="layer.hasAggregation" class="got-layer-agg-tag">含聚合</span>
        </div>

        <div class="got-layer-nodes">
          <div
            v-for="node in layer.nodes"
            :key="node.id"
            class="got-node"
            :class="[
              getNodeClass(node),
              isOnBestPath(node.id) ? 'got-node-best-path' : '',
              isAggregationNode(node) ? 'got-node-aggregation' : '',
            ]"
            :title="getNodeTooltip(node)"
          >
            <!-- 聚合节点徽章 -->
            <span v-if="isAggregationNode(node)" class="got-agg-badge" title="聚合节点（多父）">
              <WsIcon name="git-merge" size="xs" />
            </span>

            <!-- 状态图标 -->
            <span class="got-node-status" :class="`got-status-${node.status}`">
              <WsIcon :name="getStatusIcon(node.status)" size="xs" />
            </span>

            <!-- 评分 -->
            <span class="got-node-score" :class="getScoreClass(node.score)">
              {{ formatScore(node.score) }}
            </span>

            <!-- 内容 -->
            <span class="got-node-content">{{ truncate(node.content, 60) }}</span>

            <!-- 父节点指示 -->
            <span v-if="node.parents.length > 1" class="got-node-parents">
              ←{{ node.parents.length }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import {
  useGoTRust,
  type RustThoughtNode,
  type RustGoTGraphSnapshot,
} from '../composables/useGoTRust'

const props = defineProps<{
  /** GoT 会话 ID（来自 useGoTRust）。为 null 时不渲染图 */
  sessionId: string | null
}>()

const { getTree, subscribe, getSessionState } = useGoTRust()

/** 图快照（来自 getTree） */
const graphSnapshot = ref<RustGoTGraphSnapshot | null>(null)

/** 加载中标志 */
const loading = ref(false)

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

// ─── 聚合次数（从 sessionState 读取，事件驱动） ────────────────────────────────────────────

/** 已执行聚合次数（GoT 专用指标） */
const aggregationCount = computed(() => {
  void refreshTick.value
  if (!props.sessionId) return 0
  return getSessionState(props.sessionId)?.aggregationsPerformed ?? 0
})

// ─── 图重建：按深度分层 ────────────────────────────────────────────

/** 节点 ID → 节点对象映射 */
const nodeMap = computed<Map<string, RustThoughtNode>>(() => {
  void refreshTick.value
  const map = new Map<string, RustThoughtNode>()
  if (graphSnapshot.value) {
    for (const node of graphSnapshot.value.nodes) {
      map.set(node.id, node)
    }
  }
  return map
})

/** 按深度分层的节点列表 */
interface Layer {
  depth: number
  nodes: RustThoughtNode[]
  hasAggregation: boolean
}

const layers = computed<Layer[]>(() => {
  void refreshTick.value
  if (!graphSnapshot.value) return []
  const layerMap = new Map<number, RustThoughtNode[]>()
  for (const node of graphSnapshot.value.nodes) {
    if (!layerMap.has(node.depth)) {
      layerMap.set(node.depth, [])
    }
    layerMap.get(node.depth)!.push(node)
  }
  const result: Layer[] = []
  for (const [depth, nodes] of layerMap) {
    result.push({
      depth,
      nodes: nodes.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      hasAggregation: nodes.some((n) => isAggregationNode(n)),
    })
  }
  return result.sort((a, b) => a.depth - b.depth)
})

/** 最优路径节点 ID 集合（从 bestNodeId 回溯所有父节点） */
const bestPathSet = computed<Set<string>>(() => {
  void refreshTick.value
  const set = new Set<string>()
  const bestId = graphSnapshot.value?.bestNodeId
  const map = nodeMap.value
  if (!bestId || !map.has(bestId)) return set

  // BFS 遍历所有父节点（GoT 节点可有多父）
  const queue: string[] = [bestId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    set.add(currentId)
    const node = map.get(currentId)
    if (node) {
      // 加入所有父节点
      for (const parentId of node.parents) {
        if (!visited.has(parentId)) {
          queue.push(parentId)
        }
      }
      // 也加入 parent_id（ToT 兼容字段）
      if (node.parent_id && !visited.has(node.parent_id)) {
        queue.push(node.parent_id)
      }
    }
  }
  return set
})

// ─── 事件订阅 + 快照刷新 ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

/** 刷新图快照 */
async function refreshGraph(): Promise<void> {
  if (!props.sessionId) {
    graphSnapshot.value = null
    return
  }
  loading.value = true
  try {
    const snapshot = await getTree(props.sessionId)
    graphSnapshot.value = snapshot
  } catch (err) {
    console.error('[GoTGraphView] getTree 失败:', err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sessionId,
  (newId, _oldId) => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    graphSnapshot.value = null

    if (newId) {
      unsubscribe = subscribe(newId, () => {
        refreshTick.value += 1
        refreshGraph().catch(() => {})
      })
      refreshGraph().catch(() => {})
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})

// ─── 辅助方法 ────────────────────────────────────────────

/** 判断是否为聚合节点（parents 字段长度 > 1） */
function isAggregationNode(node: RustThoughtNode): boolean {
  return node.parents.length > 1
}

function isOnBestPath(nodeId: string): boolean {
  return bestPathSet.value.has(nodeId)
}

function getNodeClass(node: RustThoughtNode): string {
  const classes: string[] = []
  if (node.status === 'pruned') classes.push('got-node-pruned')
  if (node.status === 'goal') classes.push('got-node-goal')
  if (node.id === graphSnapshot.value?.bestNodeId) classes.push('got-node-best')
  return classes.join(' ')
}

function getStatusIcon(status: RustThoughtNode['status']): string {
  switch (status) {
    case 'pending': return 'circle'
    case 'scored': return 'check-circle'
    case 'expanded': return 'git-branch'
    case 'pruned': return 'x-circle'
    case 'goal': return 'target'
    default: return 'circle'
  }
}

function getScoreClass(score?: number | null): string {
  if (score === null || score === undefined) return 'got-score-none'
  if (score >= 80) return 'got-score-high'
  if (score >= 50) return 'got-score-mid'
  return 'got-score-low'
}

function formatScore(score?: number | null): string {
  if (score === null || score === undefined) return '-'
  return String(score)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id
}

function getNodeTooltip(node: RustThoughtNode): string {
  const parts: string[] = [
    `[${node.status}] 深度 ${node.depth}`,
    `ID: ${node.id}`,
    `内容: ${node.content}`,
  ]
  if (node.score !== null && node.score !== undefined) {
    parts.push(`评分: ${node.score}`)
  }
  if (node.score_reasoning) {
    parts.push(`理由: ${node.score_reasoning}`)
  }
  if (node.parents.length > 0) {
    parts.push(`父节点: ${node.parents.length} 个`)
  }
  if (isAggregationNode(node)) {
    parts.push('★ 聚合节点（多父融合）')
  }
  if (isOnBestPath(node.id)) {
    parts.push('★ 最优路径')
  }
  return parts.join('\n')
}
</script>

<style scoped>
.got-graph-view {
  font-size: 11px;
  color: rgba(229, 231, 235, 0.9);
  user-select: none;
}

.got-graph-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 9px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.got-graph-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  margin-bottom: 6px;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.8);
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}

.got-agg-count {
  color: rgb(196, 181, 253);
  font-weight: 600;
}

.got-best-id {
  color: rgb(252, 211, 77);
  font-weight: 600;
}

.got-graph-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}

/* 分层容器 */
.got-layer {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.got-layer-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.7);
  border-left: 2px solid rgba(168, 85, 247, 0.3);
}

.got-layer-depth {
  font-weight: 600;
  color: rgb(196, 181, 253);
}

.got-layer-count {
  color: rgba(156, 163, 175, 0.6);
}

.got-layer-agg-tag {
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(168, 85, 247, 0.2);
  color: rgb(196, 181, 253);
  font-size: 9px;
}

.got-layer-nodes {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 8px;
}

/* 节点行 */
.got-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: default;
  transition: background 0.1s;
  border-left: 2px solid transparent;
}

.got-node:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 最优路径节点：金色左边框 */
.got-node-best-path {
  border-left-color: rgba(252, 211, 77, 0.6);
}

/* 最优节点本身：加粗金色 */
.got-node-best {
  background: rgba(252, 211, 77, 0.08);
  border-left-color: rgb(252, 211, 77);
}

/* 目标达成节点 */
.got-node-goal {
  background: rgba(52, 211, 153, 0.08);
}

/* 聚合节点：紫色高亮 */
.got-node-aggregation {
  background: rgba(168, 85, 247, 0.06);
  border-left-color: rgba(168, 85, 247, 0.5);
}

.got-node-aggregation:hover {
  background: rgba(168, 85, 247, 0.12);
}

/* 剪枝节点：灰色 + 删除线 */
.got-node-pruned {
  opacity: 0.5;
}
.got-node-pruned .got-node-content {
  text-decoration: line-through;
}

/* 聚合徽章 */
.got-agg-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: rgb(196, 181, 253);
}

/* 状态图标 */
.got-node-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.got-status-pending { color: rgba(156, 163, 175, 0.6); }
.got-status-scored { color: rgba(147, 197, 253, 0.8); }
.got-status-expanded { color: rgba(196, 181, 253, 0.8); }
.got-status-pruned { color: rgba(156, 163, 175, 0.4); }
.got-status-goal { color: rgb(110, 231, 183); }

/* 评分 */
.got-node-score {
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 10px;
}

.got-score-none { color: rgba(156, 163, 175, 0.4); }
.got-score-high { color: rgb(110, 231, 183); }
.got-score-mid { color: rgb(252, 211, 77); }
.got-score-low { color: rgb(252, 165, 165); }

/* 内容 */
.got-node-content {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(229, 231, 235, 0.85);
}

.got-node-best .got-node-content {
  color: rgb(252, 211, 77);
  font-weight: 600;
}

/* 父节点数指示 */
.got-node-parents {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(196, 181, 253, 0.7);
  font-variant-numeric: tabular-nums;
}
</style>
