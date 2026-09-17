<template>
  <!--
    进度式（ProgressForm）—— 派生型表现形式
    迁移自原独立大纲视图的「进度总览」页签（旧视图 09-17 下线）。
    · scope='all' 整份大纲；scope='this' 本节点及其子树（统计口径含自身）
      → 挂在「卷」容器上就是**每卷一张进度卡**（比旧视图的单一全局总览更有用）
    · 纯派生只读：数据源是节点 `properties.status` / `wordCount` / `storylines`
  -->
  <div class="pgf" :style="{ maxHeight: `${maxHeight}px` }">
    <div class="pgf-cards">
      <div class="pgf-card">
        <span class="pgf-num">{{ formatCount(stats.total) }}</span>
        <span class="pgf-label">节点</span>
      </div>
      <div class="pgf-card">
        <span class="pgf-num">{{ formatCount(stats.wordCount) }}</span>
        <span class="pgf-label">字数</span>
      </div>
      <div class="pgf-card">
        <span class="pgf-num">{{ stats.completionPct }}%</span>
        <span class="pgf-label">完成度</span>
      </div>
    </div>

    <div v-if="showBar" class="pgf-bar-wrap">
      <div class="pgf-bar" :style="{ width: `${stats.completionPct}%` }" />
    </div>

    <div v-if="showStatus" class="pgf-status">
      <span v-for="s in statusItems" :key="s.status" class="pgf-status-item">
        <span class="pgf-dot" :class="dotClassOf(s.status)" />{{ s.status }}
        <span class="pgf-status-num">{{ s.count }}</span>
      </span>
    </div>

    <div v-if="showStoryline && rows.length" class="pgf-lines">
      <div v-for="row in rows" :key="row.line" class="pgf-line">
        <span class="pgf-line-name" :title="row.line">{{ row.line }}</span>
        <span class="pgf-line-meta">{{ row.count }} 节点 / {{ formatCount(row.wordCount) }} 字</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 进度式组件：统计卡 + 进度条 + 状态分布 + 线索分布。
 * 口径与原「进度总览」一致（完成度 = 完成节点数 / 总节点数）；线索分布**复用** `buildStorylineRows`，
 * 不重复实现一份聚合逻辑。
 */
import { computed } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { normalizeScope, resolveScopeNodes } from './scopeNodes'
import { computeProgressStats, formatCount, NODE_STATUSES, type NodeStatus } from './progressStats'
import { buildStorylineRows, type StorylineSourceNode } from './storylineRows'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const cfg = computed(() => resolveFormConfig('progress', props.config))

const scope = computed(() => normalizeScope(cfg.value.scope))
const showBar = computed(() => cfg.value.showBar !== false)
const showStatus = computed(() => cfg.value.showStatus !== false)
const showStoryline = computed(() => cfg.value.showStoryline !== false)
const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 220
})

const allNodes = computed<StorylineSourceNode[]>(
  () => (es.entities ?? []).filter(e => e.type === 'outline_node') as unknown as StorylineSourceNode[],
)

const scoped = computed(() => resolveScopeNodes(allNodes.value, scope.value, props.nodeId))
const stats = computed(() => computeProgressStats(scoped.value))
const rows = computed(() => buildStorylineRows(scoped.value))

const statusItems = computed(() =>
  NODE_STATUSES.map(status => ({ status, count: stats.value.statusCounts[status] })),
)

function dotClassOf(status: NodeStatus): string {
  if (status === '完成') return 'pgf-dot--done'
  if (status === '草稿') return 'pgf-dot--draft'
  return 'pgf-dot--todo'
}
</script>

<style scoped>
.pgf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 20px;
}
.pgf-cards {
  display: flex;
  gap: 4px;
}
.pgf-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 2px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
}
.pgf-num {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-color);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.pgf-label {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.pgf-bar-wrap {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-tertiary);
  overflow: hidden;
}
.pgf-bar {
  height: 100%;
  border-radius: 2px;
  background: var(--success, #059669);
  transition: width 0.2s ease;
}
.pgf-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pgf-status-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
}
.pgf-status-num {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.pgf-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pgf-dot--todo { background: var(--text-tertiary); }
.pgf-dot--draft { background: var(--warning, #d97706); }
.pgf-dot--done { background: var(--success, #059669); }
.pgf-lines {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 2px;
  border-top: 1px dashed var(--border-color);
}
.pgf-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.pgf-line-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pgf-line-meta {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
