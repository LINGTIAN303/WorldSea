<template>
  <!--
    表格式（TableForm）—— **派生型（只读）** 表现形式
    规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §三
    · 行 = 该节点的直接子节点（按 order），**不递归**；数据源是实体，不是白板上的容器
    · 强制复用 ui-kit 的 DataTable（表格单一来源），只读用法不接 `edit`
    · 表内不提供编辑：改子节点属跨层级写入，与「容器 : 节点 = 1:1」冲突
  -->
  <div
    class="tb"
    :class="{ 'tb--compact': density === 'compact', 'tb--standard': density === 'standard' }"
    :style="{ maxHeight: `${maxHeight}px` }"
  >
    <div v-if="built.empty" class="tb-empty">暂无子节点</div>
    <DataTable v-else :columns="built.columns" :rows="built.rows" />
  </div>
</template>

<script setup lang="ts">
/**
 * 表格式组件：纯派生渲染，无写入路径、无就地编辑（规格 §3.2-③）。
 * 表格数据由 tableRows.ts 的纯函数构建（仅直接子节点、缺值占位），组件只做配置归一化与渲染。
 */
import { computed } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { DataTable } from '@worldsea/ui-kit'
import { resolveFormConfig } from './registry'
import { buildTableRows, type TableSourceNode } from './tableRows'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()

const cfg = computed(() => resolveFormConfig('table', props.config))
const density = computed(() => (cfg.value.density === 'standard' ? 'standard' : 'compact'))
const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 240
})

const allNodes = computed<TableSourceNode[]>(
  () => (es.entities ?? []).filter(e => e.type === 'outline_node') as unknown as TableSourceNode[],
)

/** 子节点增删会自动反映到行上（派生型：无需任何清理或同步逻辑） */
const built = computed(() =>
  buildTableRows({
    nodes: allNodes.value,
    nodeId: props.nodeId,
    columns: cfg.value.columns,
    includeSelf: cfg.value.includeSelf === true,
  }),
)
</script>

<style scoped>
.tb {
  overflow: auto;
  min-height: 24px;
}
.tb-empty {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  font-style: italic;
  padding: 4px 2px;
}
/* 把 DataTable 的外框与内边距去掉，嵌入容器内更自然（只调样式，不改组件本身） */
.tb :deep(.ws-dt-wrap) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.tb--compact :deep(.ws-dt th) { padding: 3px 6px; }
.tb--compact :deep(.ws-dt td) { padding: 3px 6px; font-size: var(--font-size-xs); }
.tb--compact :deep(.ws-dt) { font-size: var(--font-size-xs); }
.tb--standard :deep(.ws-dt th) { padding: 6px 10px; }
.tb--standard :deep(.ws-dt td) { padding: 5px 10px; }
</style>
