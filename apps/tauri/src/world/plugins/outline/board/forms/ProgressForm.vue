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
      <button
        v-for="s in statusItems"
        :key="s.status"
        class="pgf-status-item pgf-status-item--clickable"
        type="button"
        :title="`查看「${s.status}」的节点`"
        @click.stop="openStatus(s.status, $event)"
      >
        <span class="pgf-dot" :class="dotClassOf(s.status)" />{{ s.status }}
        <span class="pgf-status-num">{{ s.count }}</span>
      </button>
    </div>

    <div v-if="showStoryline && rows.length" class="pgf-lines">
      <button
        v-for="row in visibleStorylineRows"
        :key="row.line"
        class="pgf-line pgf-line--clickable"
        type="button"
        :title="`查看线索「${row.line}」的节点`"
        @click.stop="openLine(row.line, $event)"
      >
        <span class="pgf-line-name">{{ row.line }}</span>
        <span class="pgf-line-meta">{{ row.count }} 节点 / {{ formatCount(row.wordCount) }} 字</span>
      </button>
      <div v-if="hiddenStorylines > 0" class="pgf-more">另有 {{ hiddenStorylines }} 条线索未显示</div>
    </div>

    <FloatingPanel
      v-model:visible="drillOpen"
      v-model:pinned="drillPinned"
      :title="drillTitle"
      :width="260"
      :height="300"
      :trigger-rect="drillRect"
    >
      <div class="pgf-drill">
        <button
          v-for="n in drillNodes"
          :key="n.id"
          class="pgf-drill-item"
          type="button"
          @click.stop="openNode(n.id)"
        >{{ n.name || '未命名' }}</button>
        <div v-if="!drillNodes.length" class="pgf-drill-empty">该分组暂无节点</div>
      </div>
    </FloatingPanel>
  </div>
</template>

<script setup lang="ts">
/**
 * 进度式组件：统计卡 + 进度条 + 状态分布 + 线索分布。
 * 口径与原「进度总览」一致（完成度 = 完成节点数 / 总节点数）；线索分布**复用** `buildStorylineRows`，
 * 不重复实现一份聚合逻辑。
 */
import { computed, ref } from 'vue'
import { resolveFormConfig } from './registry'
import { normalizeScope, resolveScopeNodes } from './scopeNodes'
import { computeProgressStats, formatCount, NODE_STATUSES, type NodeStatus } from './progressStats'
import { buildStorylineRows, type StorylineSourceNode } from './storylineRows'
import { normalizeLimit } from './limits'
import { FloatingPanel } from '@worldsea/ui-kit'
import { focusNodeField } from '../composables/useNodeFieldFocus'
import { statusOf } from './progressStats'
import { entitiesSvc } from '../../serviceAccess'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()
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
  () => (es.list() ?? []).filter(e => e.type === 'outline_node') as unknown as StorylineSourceNode[],
)

const scoped = computed(() => resolveScopeNodes(allNodes.value, scope.value, props.nodeId))
const stats = computed(() => computeProgressStats(scoped.value))
const rows = computed(() => buildStorylineRows(scoped.value))

// 信息密度（2026-10-19）：线索分布最多显示几行
const maxStorylines = computed(() => normalizeLimit(cfg.value.maxStorylines))
const visibleStorylineRows = computed(() => rows.value.slice(0, maxStorylines.value))
const hiddenStorylines = computed(() =>
  Math.max(0, rows.value.length - visibleStorylineRows.value.length),
)

const statusItems = computed(() =>
  NODE_STATUSES.map(status => ({ status, count: stats.value.statusCounts[status] })),
)

// ── 钻取（2026-10-19 五视图钻取批 · 4/5）：点状态 / 线索 → 列出该分组节点 → 点节点开详情 ──
interface DrillNode { id: string; name: string }
const drillOpen = ref(false)
const drillPinned = ref(false)
const drillRect = ref<DOMRect | null>(null)
const drillTitle = ref('')
const drillNodes = ref<DrillNode[]>([])

function toDrillNodes(list: Array<{ id: string; name?: string }>): DrillNode[] {
  return list.map(n => ({ id: n.id, name: String(n.name ?? '').trim() }))
}

function anchorOf(ev: MouseEvent): DOMRect | null {
  const el = ev.currentTarget as HTMLElement | null
  return el ? el.getBoundingClientRect() : null
}

function openStatus(status: NodeStatus, ev: MouseEvent): void {
  drillTitle.value = `状态：${status}`
  drillNodes.value = toDrillNodes(scoped.value.filter(n => statusOf(n) === status))
  drillRect.value = anchorOf(ev)
  drillOpen.value = true
}

function openLine(line: string, ev: MouseEvent): void {
  drillTitle.value = `线索：${line}`
  drillNodes.value = toDrillNodes(
    scoped.value.filter(n => {
      const raw = (n as unknown as { properties?: { storylines?: unknown } }).properties?.storylines
      return String(raw ?? '')
        .split(/[,，、]/)
        .map(x => x.trim())
        .includes(line)
    }),
  )
  drillRect.value = anchorOf(ev)
  drillOpen.value = true
}

function openNode(nodeId: string): void {
  drillOpen.value = false
  focusNodeField(nodeId, 'status')
}

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
.pgf-status-item--clickable {
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}
.pgf-status-item--clickable:hover .pgf-status-num { color: var(--primary); }
.pgf-line--clickable {
  border: none;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.pgf-line--clickable:hover .pgf-line-name { color: var(--primary); }
.pgf-drill { display: flex; flex-direction: column; gap: 1px; height: 100%; min-height: 0; overflow-y: auto; }
.pgf-drill-item {
  padding: 2px 4px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--font-size-xs);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.pgf-drill-item:hover { background: var(--bg-tertiary); color: var(--primary); }
.pgf-drill-empty { padding: 10px 0; text-align: center; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
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
/* 信息密度（2026-10-19）：被截断的线索行数提示 */
.pgf-more { padding-top: 2px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
