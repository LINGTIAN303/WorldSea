<template>
  <!--
    线索式（StorylineForm）—— 派生型表现形式
    迁移自原独立大纲视图的「情节线索」页签（旧视图 09-17 下线）。
    · scope='all' 覆盖全部大纲节点；scope='this' 覆盖本节点及其子树（统计口径含自身）
    · 纯派生只读：数据源是节点的 `properties.storylines` 字段，本组件不写任何数据
  -->
  <div class="slf" :style="{ maxHeight: `${maxHeight}px` }">
    <button
      v-if="!rows.length"
      class="slf-empty slf-empty--action"
      type="button"
      title="打开节点详情，填写「所属线索」"
      @click="openManage"
    >暂无线索 · 点此填写 →</button>
    <button v-if="rows.length" class="slf-manage" type="button" @click="openManage">管理线索</button>

    <div v-for="row in rows" :key="row.line" class="slf-row">
      <div class="slf-head">
        <span class="slf-name" :title="row.line">{{ row.line }}</span>
        <span v-if="showCount" class="slf-meta">{{ row.count }} 节点</span>
        <span v-if="showWordCount" class="slf-meta">{{ formatCount(row.wordCount) }} 字</span>
      </div>
      <div v-if="showNodes" class="slf-nodes">
        <span
          v-for="(name, i) in visibleNames(row)"
          :key="row.nodeIds[i]"
          class="slf-tag"
          :title="`${name}（点击打开详情）`"
          @click.stop="openNode(row.nodeIds[i])"
        >{{ name }}</span>
        <span
          v-if="restTagCount(row) > 0"
          class="slf-tag-more"
          :title="restTagNames(row)"
        >+{{ restTagCount(row) }}</span>
      </div>
    </div>
    <div v-if="hiddenLines > 0" class="slf-more">另有 {{ hiddenLines }} 条线索未显示</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 线索式组件：纯派生只读（与表格式同类，`kind: 'derived'`）。
 * 数据源 = 节点 `properties.storylines`（逗号分隔）→ 按线索聚合成行。
 * 「填线索」的入口在属性面板的节点属性区（容器与节点 1:1，那是天然的归属地）。
 */
import { computed } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { normalizeScope, resolveScopeNodes } from './scopeNodes'
import { buildStorylineRows, normalizeStorylineSort, type StorylineRow, type StorylineSourceNode } from './storylineRows'
import { normalizeLimit } from './limits'
import { formatCount } from './progressStats'
import { focusNodeField } from '../composables/useNodeFieldFocus'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const cfg = computed(() => resolveFormConfig('storyline', props.config))

const scope = computed(() => normalizeScope(cfg.value.scope))
const showCount = computed(() => cfg.value.showCount !== false)
const showWordCount = computed(() => cfg.value.showWordCount !== false)
const showNodes = computed(() => cfg.value.showNodes !== false)
/** 派生型无写入入口：把用户送到节点详情的「所属线索」输入框（2026-10-19 Q2-B / Q3-A） */
function openManage(): void {
  focusNodeField(props.nodeId, 'storylines')
}

/** 钻取（2026-10-19 五视图钻取批 · 3/5）：点节点标签 → 打开该节点详情 */
function openNode(nodeId: string): void {
  if (!nodeId) return
  focusNodeField(nodeId, 'status')
}

const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 200
})

const allNodes = computed<StorylineSourceNode[]>(
  () => (es.entities ?? []).filter(e => e.type === 'outline_node') as unknown as StorylineSourceNode[],
)

// ── 信息密度（2026-10-19）：行数 / 每条线索的标签数 / 排序 ──
const maxLines = computed(() => normalizeLimit(cfg.value.maxLines))
const maxTags = computed(() => normalizeLimit(cfg.value.maxTags))
const sortBy = computed(() => normalizeStorylineSort(cfg.value.sortBy))

const allRows = computed(() =>
  buildStorylineRows(resolveScopeNodes(allNodes.value, scope.value, props.nodeId), {
    sortBy: sortBy.value,
  }),
)
const rows = computed(() => allRows.value.slice(0, maxLines.value))
const hiddenLines = computed(() => Math.max(0, allRows.value.length - rows.value.length))

/** 每条线索最多显示几个节点标签（Infinity = 全部） */
function visibleNames(row: StorylineRow): string[] {
  return Number.isFinite(maxTags.value) ? row.names.slice(0, maxTags.value) : row.names
}
function restTagCount(row: StorylineRow): number {
  return Number.isFinite(maxTags.value) ? Math.max(0, row.names.length - maxTags.value) : 0
}
function restTagNames(row: StorylineRow): string {
  return Number.isFinite(maxTags.value) ? row.names.slice(maxTags.value).join('、') : ''
}
</script>

<style scoped>
.slf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  min-height: 20px;
}
.slf-empty--action {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.slf-empty--action:hover { text-decoration: underline; }
.slf-manage {
  margin-top: 4px;
  padding: 0 6px;
  height: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.slf-manage:hover { border-color: var(--primary); color: var(--primary); }
.slf-empty {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  padding: 4px 2px;
}
.slf-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--border-color);
}
.slf-row:last-child { border-bottom: none; padding-bottom: 0; }
.slf-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.slf-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slf-meta {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.slf-nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.slf-tag {
  cursor: pointer;
  max-width: 100%;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 信息密度（2026-10-19）：被截断的标签数与线索行数提示 */
.slf-tag-more { align-self: center; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.slf-more { padding-top: 2px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
