<!--
  # ToTTreeView — 思维树可视化组件（缩进列表）

  阶段 2.1 批次4 新增。将 Rust 端 ToT 探索生成的思维树以缩进列表形式展示。

  ## 数据来源
  - 通过 `useToTRust().getTree(sessionId)` 获取 `RustToTTreeSnapshot`（扁平节点列表）
  - 订阅 `useToTRust().subscribe(sessionId)` 事件流，事件到达时刷新快照

  ## 树重建
  - 扁平 nodes 列表 → 按 parent_id 建立父子映射 → DFS 生成有序扁平列表（带 depth）
  - 折叠节点时不渲染其子树

  ## 视觉编码
  - 节点状态图标：pending(灰) / scored(蓝) / expanded(紫) / pruned(灰删除线) / goal(金)
  - 评分颜色：≥80 绿 / 50-79 黄 / <50 红 / 未评分 灰
  - 最优路径：bestNodeId 及其祖先链加金色左边框
  - 剪枝节点：灰色 + 删除线

  ## 交互
  - 点击有子节点的节点：展开/折叠
  - hover：显示完整 content + score_reasoning（title 属性）
-->
<template>
  <div class="tot-tree-view">
    <!-- 空状态 -->
    <div v-if="!sessionId" class="tot-tree-empty">未激活 ToT 会话</div>
    <div v-else-if="loading && !treeSnapshot" class="tot-tree-empty">加载思维树中...</div>
    <div v-else-if="!treeSnapshot || treeSnapshot.nodes.length === 0" class="tot-tree-empty">
      暂无思维节点
    </div>

    <!-- 树列表 -->
    <div v-else class="tot-tree-list">
      <div class="tot-tree-summary">
        <span>共 {{ treeSnapshot.totalCount }} 节点</span>
        <span>·</span>
        <span>最大深度 {{ treeSnapshot.maxDepthReached }}</span>
        <span v-if="treeSnapshot.bestNodeId">·</span>
        <span v-if="treeSnapshot.bestNodeId" class="tot-best-id">
          最优: {{ shortId(treeSnapshot.bestNodeId) }}
        </span>
      </div>

      <div
        v-for="item in visibleFlatNodes"
        :key="item.node.id"
        class="tot-node"
        :class="[
          getNodeClass(item.node),
          isOnBestPath(item.node.id) ? 'tot-node-best-path' : '',
        ]"
        :style="{ paddingLeft: `${item.depth * 18 + 6}px` }"
        :title="getNodeTooltip(item.node)"
        @click="onNodeClick(item.node)"
      >
        <!-- 展开/折叠图标 -->
        <WsIcon
          v-if="item.node.children.length > 0"
          :name="isExpanded(item.node.id) ? 'chevron-down' : 'chevron-right'"
          size="xs"
          class="tot-node-chevron"
        />
        <span v-else class="tot-node-leaf-dot"></span>

        <!-- 状态图标 -->
        <span class="tot-node-status" :class="`tot-status-${item.node.status}`">
          <WsIcon :name="getStatusIcon(item.node.status)" size="xs" />
        </span>

        <!-- 评分 -->
        <span class="tot-node-score" :class="getScoreClass(item.node.score)">
          {{ formatScore(item.node.score) }}
        </span>

        <!-- 内容 -->
        <span class="tot-node-content">{{ truncate(item.node.content, 50) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useToTRust, type RustThoughtNode, type RustToTTreeSnapshot } from '../composables/useToTRust'

const props = defineProps<{
  /** ToT 会话 ID（来自 useToTRust）。为 null 时不渲染树 */
  sessionId: string | null
}>()

const { getTree, subscribe } = useToTRust()

/** 树快照（来自 getTree） */
const treeSnapshot = ref<RustToTTreeSnapshot | null>(null)

/** 加载中标志 */
const loading = ref(false)

/** 展开的节点 ID 集合（默认全部展开） */
const expandedSet = ref<Set<string>>(new Set())

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

// ─── 树重建 ────────────────────────────────────────────

/** 节点 ID → 节点对象映射 */
const nodeMap = computed<Map<string, RustThoughtNode>>(() => {
  void refreshTick.value
  const map = new Map<string, RustThoughtNode>()
  if (treeSnapshot.value) {
    for (const node of treeSnapshot.value.nodes) {
      map.set(node.id, node)
    }
  }
  return map
})

/** 根节点列表（parent_id 为 null/undefined 或不在 nodeMap 中的节点） */
const rootNodes = computed<RustThoughtNode[]>(() => {
  void refreshTick.value
  const map = nodeMap.value
  return treeSnapshot.value?.nodes.filter(
    (n) => !n.parent_id || !map.has(n.parent_id),
  ) ?? []
})

/** DFS 遍历生成扁平列表（带 depth），跳过折叠节点的子树 */
const visibleFlatNodes = computed<{ node: RustThoughtNode; depth: number }[]>(() => {
  void refreshTick.value
  const result: { node: RustThoughtNode; depth: number }[] = []
  const map = nodeMap.value

  function dfs(nodeId: string, depth: number): void {
    const node = map.get(nodeId)
    if (!node) return
    result.push({ node, depth })

    // 折叠的节点不遍历子树
    if (node.children.length > 0 && !isExpanded(node.id)) return

    for (const childId of node.children) {
      dfs(childId, depth + 1)
    }
  }

  for (const root of rootNodes.value) {
    dfs(root.id, 0)
  }
  return result
})

/** 最优路径节点 ID 集合（从 bestNodeId 回溯到根） */
const bestPathSet = computed<Set<string>>(() => {
  void refreshTick.value
  const set = new Set<string>()
  const bestId = treeSnapshot.value?.bestNodeId
  const map = nodeMap.value
  if (!bestId || !map.has(bestId)) return set

  // 从 bestNodeId 向上回溯
  let currentId: string | null | undefined = bestId
  const visited = new Set<string>() // 防止循环引用
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    set.add(currentId)
    const node = map.get(currentId)
    currentId = node?.parent_id ?? null
  }
  return set
})

// ─── 展开状态管理 ────────────────────────────────────────────

function isExpanded(nodeId: string): boolean {
  // 默认展开（未在 expandedSet 中也视为展开）
  // 只有显式折叠（在 collapsedSet 中）才不展开
  // 这里简化：expandedSet 为"已折叠"集合的补集
  // 实际上：如果 expandedSet 为空，默认全部展开
  // 用户点击折叠时，从 expandedSet 移除
  return expandedSet.value.has(nodeId)
}

function toggleExpand(nodeId: string): void {
  const next = new Set(expandedSet.value)
  if (next.has(nodeId)) {
    next.delete(nodeId)
  } else {
    next.add(nodeId)
  }
  expandedSet.value = next
}

/** 初始化时全部展开 */
function initExpanded(): void {
  const map = nodeMap.value
  const allIds = new Set<string>()
  for (const node of map.values()) {
    if (node.children.length > 0) {
      allIds.add(node.id)
    }
  }
  expandedSet.value = allIds
}

// ─── 事件订阅 + 快照刷新 ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

/** 刷新树快照 */
async function refreshTree(): Promise<void> {
  if (!props.sessionId) {
    treeSnapshot.value = null
    return
  }
  loading.value = true
  try {
    const snapshot = await getTree(props.sessionId)
    treeSnapshot.value = snapshot
    // 首次加载时初始化展开状态（全部展开）
    if (expandedSet.value.size === 0 && snapshot.nodes.length > 0) {
      initExpanded()
    }
  } catch (err) {
    console.error('[ToTTreeView] getTree 失败:', err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sessionId,
  (newId, oldId) => {
    // 清理旧订阅
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    // 重置状态
    treeSnapshot.value = null
    expandedSet.value = new Set()

    // 注册新订阅
    if (newId) {
      unsubscribe = subscribe(newId, () => {
        // 事件到达时自增 tick 驱动 computed 重算
        refreshTick.value += 1
        // 异步刷新树快照（不阻塞事件处理）
        refreshTree().catch(() => {})
      })
      // 首次加载
      refreshTree().catch(() => {})
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

// ─── 节点点击处理 ────────────────────────────────────────────

function onNodeClick(node: RustThoughtNode): void {
  // 有子节点的节点：展开/折叠
  if (node.children.length > 0) {
    toggleExpand(node.id)
  }
}

// ─── 样式辅助 ────────────────────────────────────────────

function isOnBestPath(nodeId: string): boolean {
  return bestPathSet.value.has(nodeId)
}

function getNodeClass(node: RustThoughtNode): string {
  const classes: string[] = []
  if (node.status === 'pruned') classes.push('tot-node-pruned')
  if (node.status === 'goal') classes.push('tot-node-goal')
  if (node.id === treeSnapshot.value?.bestNodeId) classes.push('tot-node-best')
  if (node.children.length > 0) classes.push('tot-node-branch')
  return classes.join(' ')
}

function getStatusIcon(status: RustThoughtNode['status']): string {
  switch (status) {
    case 'pending': return 'circle' // 灰色圆圈
    case 'scored': return 'check-circle'
    case 'expanded': return 'git-branch'
    case 'pruned': return 'x-circle'
    case 'goal': return 'target' // 目标
    default: return 'circle'
  }
}

function getScoreClass(score?: number | null): string {
  if (score === null || score === undefined) return 'tot-score-none'
  if (score >= 80) return 'tot-score-high'
  if (score >= 50) return 'tot-score-mid'
  return 'tot-score-low'
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
  if (node.children.length > 0) {
    parts.push(`子节点: ${node.children.length} 个`)
  }
  if (isOnBestPath(node.id)) {
    parts.push('★ 最优路径')
  }
  return parts.join('\n')
}
</script>

<style scoped>
.tot-tree-view {
  font-size: 11px;
  color: rgba(229, 231, 235, 0.9);
  user-select: none;
}

.tot-tree-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.tot-tree-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  margin-bottom: 4px;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.8);
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}

.tot-best-id {
  color: rgb(252, 211, 77);
  font-weight: 600;
}

.tot-tree-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 300px;
  overflow-y: auto;
}

/* 节点行 */
.tot-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s;
  border-left: 2px solid transparent;
}

.tot-node:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 最优路径节点：金色左边框 */
.tot-node-best-path {
  border-left-color: rgba(252, 211, 77, 0.6);
}

/* 最优节点本身：加粗金色 */
.tot-node-best {
  background: rgba(252, 211, 77, 0.08);
  border-left-color: rgb(252, 211, 77);
}

/* 目标达成节点 */
.tot-node-goal {
  background: rgba(52, 211, 153, 0.08);
}

/* 剪枝节点：灰色 + 删除线 */
.tot-node-pruned {
  opacity: 0.5;
}
.tot-node-pruned .tot-node-content {
  text-decoration: line-through;
}

/* 展开/折叠图标 */
.tot-node-chevron {
  flex-shrink: 0;
  color: rgba(147, 197, 253, 0.6);
  cursor: pointer;
}

/* 叶子节点占位 */
.tot-node-leaf-dot {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* 状态图标 */
.tot-node-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.tot-status-pending { color: rgba(156, 163, 175, 0.6); }
.tot-status-scored { color: rgba(147, 197, 253, 0.8); }
.tot-status-expanded { color: rgba(196, 181, 253, 0.8); }
.tot-status-pruned { color: rgba(156, 163, 175, 0.4); }
.tot-status-goal { color: rgb(110, 231, 183); }

/* 评分 */
.tot-node-score {
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 10px;
}

.tot-score-none { color: rgba(156, 163, 175, 0.4); }
.tot-score-high { color: rgb(110, 231, 183); }
.tot-score-mid { color: rgb(252, 211, 77); }
.tot-score-low { color: rgb(252, 165, 165); }

/* 内容 */
.tot-node-content {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(229, 231, 235, 0.85);
}

.tot-node-best .tot-node-content {
  color: rgb(252, 211, 77);
  font-weight: 600;
}
</style>
