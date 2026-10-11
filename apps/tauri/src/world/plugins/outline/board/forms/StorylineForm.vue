<template>
  <!--
    线索式（StorylineForm）—— 派生型表现形式
    迁移自原独立大纲视图的「情节线索」页签（旧视图 09-17 下线）。
    · scope='all' 覆盖全部大纲节点；scope='this' 覆盖本节点及其子树（统计口径含自身）
    · 纯派生只读：数据源是节点的 `properties.storylines` 字段，本组件不写任何数据
  -->
  <div class="slf" :style="{ maxHeight: `${maxHeight}px` }">
    <div v-if="!rows.length" class="slf-empty">
      暂无线索（在属性面板的「节点属性」里填「所属线索」）
    </div>

    <div v-for="row in rows" :key="row.line" class="slf-row">
      <div class="slf-head">
        <span class="slf-name" :title="row.line">{{ row.line }}</span>
        <span v-if="showCount" class="slf-meta">{{ row.count }} 节点</span>
        <span v-if="showWordCount" class="slf-meta">{{ formatCount(row.wordCount) }} 字</span>
      </div>
      <div v-if="showNodes" class="slf-nodes">
        <span
          v-for="(name, i) in row.names"
          :key="row.nodeIds[i]"
          class="slf-tag"
          :title="name"
        >{{ name }}</span>
      </div>
    </div>
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
import { buildStorylineRows, type StorylineSourceNode } from './storylineRows'
import { formatCount } from './progressStats'

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
const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 200
})

const allNodes = computed<StorylineSourceNode[]>(
  () => (es.entities ?? []).filter(e => e.type === 'outline_node') as unknown as StorylineSourceNode[],
)

const rows = computed(() =>
  buildStorylineRows(resolveScopeNodes(allNodes.value, scope.value, props.nodeId)),
)
</script>

<style scoped>
.slf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  min-height: 20px;
}
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
</style>
