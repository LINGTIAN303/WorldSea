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
    <DataTable
      v-else
      :columns="tableColumns"
      :rows="built.rows"
      row-key="__id"
      :virtual="virtual"
      :max-height="virtualMaxHeight"
      :row-height="density === 'compact' ? 28 : 32"
      @row-click="onRowClick"
    />

    <button class="tb-manage" type="button" @click="openManage">管理行（{{ children.length }}）</button>

    <FloatingPanel
      v-model:visible="manageOpen"
      v-model:pinned="managePinned"
      title="管理行"
      :width="300"
      :height="340"
      :trigger-rect="triggerRect"
    >
      <div class="tb-rows">
        <div v-for="row in children" :key="row.id" class="tb-row">
          <span class="tb-row-name" :title="row.name || '未命名'">{{ row.name || '未命名' }}</span>
          <button class="tb-row-btn" type="button" @click="openRow(row.id)">改</button>
          <button class="tb-row-btn tb-row-btn--danger" type="button" @click="requestDelete(row.id)">删</button>
        </div>
        <div v-if="!children.length" class="tb-rows-empty">暂无子节点</div>
        <button class="tb-add" type="button" @click="addRow">＋ 添加行</button>
      </div>
    </FloatingPanel>
  </div>
</template>

<script setup lang="ts">
/**
 * 表格式组件：纯派生渲染，无写入路径、无就地编辑（规格 §3.2-③）。
 * 表格数据由 tableRows.ts 的纯函数构建（仅直接子节点、缺值占位），组件只做配置归一化与渲染。
 */
import { computed, ref } from 'vue'
import { DataTable, FloatingPanel } from '@worldsea/ui-kit'
import { resolveFormConfig } from './registry'
import { buildTableRows, normalizeSort, type TableSourceNode } from './tableRows'
import { resolveChildNodes } from '../outlineDerive'
import { focusNodeField } from '../composables/useNodeFieldFocus'
import { createChildNode } from './childNodeCreate'
import { entitiesSvc } from '../../serviceAccess'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()

const cfg = computed(() => resolveFormConfig('table', props.config))
const density = computed(() => (cfg.value.density === 'standard' ? 'standard' : 'compact'))
const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 240
})

const allNodes = computed<TableSourceNode[]>(
  () => (es.list() ?? []).filter(e => e.type === 'outline_node') as unknown as TableSourceNode[],
)

/** 子节点增删会自动反映到行上（派生型：无需任何清理或同步逻辑） */
const built = computed(() =>
  buildTableRows({
    nodes: allNodes.value,
    nodeId: props.nodeId,
    columns: cfg.value.columns,
    includeSelf: cfg.value.includeSelf === true,
    sortBy: normalizeSort(cfg.value.sortBy),
  }),
)

// ── 虚拟滚动（2026-10-25）：仅行数超阈值时开启，小表保持原全量渲染 ──
const VIRTUAL_THRESHOLD = 80
/** 虚拟模式的固定列宽（仅虚拟模式生效；标题列吃掉剩余宽度） */
const COLUMN_WIDTHS: Record<string, string> = {
  title: 'auto',
  order: '44px',
  status: '68px',
  wordCount: '62px',
  nodeType: '68px',
  storylines: '26%',
}
const virtual = computed(() => built.value.rows.length > VIRTUAL_THRESHOLD)
/** 预留「管理行」按钮的高度，避免外层再出现一条滚动条 */
const virtualMaxHeight = computed(() => Math.max(120, maxHeight.value - 26))
const tableColumns = computed(() => built.value.columns.map(c => ({ ...c, width: COLUMN_WIDTHS[c.key] })))

/** 行 = 直接子节点（与表格同一数据源，但这里要 id 才能操作） */
const children = computed<TableSourceNode[]>(() => {
  const exists = allNodes.value.some(n => n.id === props.nodeId)
  return exists ? (resolveChildNodes(props.nodeId, allNodes.value) as unknown as TableSourceNode[]) : []
})

// ── 行管理（2026-10-19 Q1-B）：表格内不改数据，操作收在「管理行」浮层 ──
const manageOpen = ref(false)
const managePinned = ref(false)
const triggerRect = ref<DOMRect | null>(null)

/** 钻取（2026-10-19）：点行 → 打开该节点详情（与「管理行 → 改」同一落点，不依赖容器是否在板上） */
function onRowClick(payload: { rowKey: string | null }): void {
  if (!payload.rowKey) return
  focusNodeField(payload.rowKey, 'status')
}

function openManage(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  triggerRect.value = el ? el.getBoundingClientRect() : null
  manageOpen.value = true
}

/** 改：打开该行节点的详情面板（状态 / 字数 / 线索在面板里写） */
function openRow(nodeId: string): void {
  manageOpen.value = false
  focusNodeField(nodeId, 'status')
}

/** 删：不在此直接删——经事件桥接走唯一删除入口（四策略对话框 + 撤销记录） */
function requestDelete(nodeId: string): void {
  window.dispatchEvent(new CustomEvent('ws-outline-delete-node', { detail: { nodeId } }))
}

/** 增：新建子节点（未入板）——与标题式/句子式共用同一入口 */
async function addRow(): Promise<void> {
  await createChildNode(es, props.nodeId, '新节点')
}
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
.tb-manage {
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
.tb-manage:hover { border-color: var(--primary); color: var(--primary); }
.tb-rows { display: flex; flex-direction: column; gap: 2px; height: 100%; min-height: 0; }
.tb-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.tb-row-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--font-size-xs); color: var(--text-color);
}
.tb-row-btn {
  flex-shrink: 0; padding: 0 5px; height: 18px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-2xs); font-family: inherit; cursor: pointer;
}
.tb-row-btn:hover { border-color: var(--primary); color: var(--primary); }
.tb-row-btn--danger:hover { border-color: var(--danger); color: var(--danger); }
.tb-rows-empty { padding: 10px 0; text-align: center; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.tb-add {
  margin-top: auto; padding: 0 6px; height: 22px;
  border: 1px dashed var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-2xs); font-family: inherit; cursor: pointer;
}
.tb-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
