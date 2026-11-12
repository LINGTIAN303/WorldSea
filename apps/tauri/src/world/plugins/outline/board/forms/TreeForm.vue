<template>
  <!--
    树式（TreeForm）—— 就地型表现形式
    承载原「大纲树视图」的浏览形态（负责人 09-16 裁定：旧视图成为白板里的一个容器内容）。
    · scope='all' 显示全部根；scope='this' 显示该容器的节点之下的子树
    · 展开折叠（会话态，不入库）+ 就地改名（只写 node.name）
    · 高度上限内滚动，避免大树撑爆容器
  -->
  <div class="trf" :style="{ maxHeight: `${maxHeight}px` }">
    <div v-if="!rows.length" class="trf-empty">
      {{ scope === 'this' ? '该节点暂无子节点' : '还没有大纲节点' }}
    </div>

    <div
      v-for="row in rows"
      :key="row.id"
      class="trf-row"
      :style="{ paddingLeft: `${row.depth * indent}px` }"
    >
      <button
        v-if="row.hasChildren"
        class="trf-caret"
        type="button"
        :title="row.expanded ? '折叠' : '展开'"
        :aria-expanded="row.expanded"
        @click.stop="toggle(row.id)"
      >{{ row.expanded ? '▾' : '▸' }}</button>
      <span v-else class="trf-caret trf-caret--empty" />

      <template v-if="editingId === row.id">
        <input
          :ref="setEditInput"
          v-model="draft"
          class="trf-input"
          type="text"
          @keydown.enter="guardEnter($event, () => commit(row.id))"
          @keydown.esc="guardEsc($event, cancel)"
          @blur="commit(row.id)"
          @pointerdown.stop
          @dblclick.stop
        />
      </template>
      <template v-else>
        <span v-if="showStatus" class="trf-dot" :class="dotClassOf(row.status)" :title="row.status" />
        <span
          class="trf-name"
          :title="showNumbering ? numberedName(row) : row.name"
          @dblclick.stop="startEdit(row)"
        >{{ showNumbering ? numberedName(row) : row.name }}</span>
      </template>
      <button
        class="trf-goto"
        type="button"
        title="打开该节点详情"
        @click.stop="openDetail(row)"
      >↗</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 树式组件：只读呈现 + 就地改名（写入策略与标题式一致：400ms 防抖 + skipUndo）。
 * 后续若要「拖拽重排层级」，入口在右栏（见 BoardView 的层级重排），不在这里——
 * 保持「呈现组件不承担结构编辑」的边界，避免形式组件变成第二个编辑器。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { resolveNodeNumbering } from '../outlineDerive'
import { resolveFormConfig } from './registry'
import { focusNodeField } from '../composables/useNodeFieldFocus'
import { injectBoardUndo } from '../composables/useBoardUndo'
import { formatNumbering, indentForDepth, type NumberingStyle } from './titleNumbering'
import { guardEnter, guardEsc } from './enterGuard'
import { buildTreeRows, defaultExpandedIds, normalizeExpandDepth, type TreeRow, type TreeScope, type TreeSourceNode } from './treeRows'
import { entitiesSvc } from '../../serviceAccess'

/** 与标题式同策略的内容写入防抖 */
const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()
/** 白板撤销栈（未装配时为 null：组件仍可用，只是内容编辑不进撤销栈） */
const boardUndo = injectBoardUndo()

const cfg = computed(() => resolveFormConfig('tree', props.config))
const scope = computed<TreeScope>(() => (cfg.value.scope === 'this' ? 'this' : 'all'))
const showStatus = computed(() => cfg.value.showStatus !== false)
const showNumbering = computed(() => cfg.value.numbering !== 'none')
const numberingStyle = computed<NumberingStyle>(() => {
  const v = cfg.value.numbering
  return v === 'chinese' || v === 'roman' || v === 'numeric' ? v : 'none'
})
const indent = computed(() => {
  const n = Number(cfg.value.indent)
  return Number.isFinite(n) && n >= 8 ? Math.min(32, n) : indentForDepth(1)
})
const maxHeight = computed(() => {
  const n = Number(cfg.value.maxHeight)
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 240
})
/** 初始展开层数（2026-10-19 信息密度）：'all' → Infinity；非法值回退 2（原硬编码值） */
const expandDepth = computed(() => normalizeExpandDepth(cfg.value.expandDepth))

const allNodes = computed<TreeSourceNode[]>(
  () => (es.list() ?? []).filter(e => e.type === 'outline_node') as unknown as TreeSourceNode[],
)

/** 展开态（会话态，不入库）——初始层数由 config.expandDepth 决定（默认 2，与原行为一致） */
const expanded = ref<Set<string>>(new Set())
let expandedInitialized = false

/** 按当前配置重置展开态（首次加载 / 用户改展开层数或范围时） */
function resetExpanded(): void {
  const nodes = allNodes.value
  if (!nodes.length) return
  expanded.value = defaultExpandedIds(nodes, scope.value, props.nodeId, expandDepth.value)
}

/** 钻取（2026-10-19 五视图钻取批 · 2/5）：行尾按钮 → 打开该节点详情。
 *  用独立按钮而非单击行：树式的单击/双击手势保持不变（双击仍是就地改名）。 */
function openDetail(row: TreeRow): void {
  focusNodeField(row.id, 'status')
}

watch(allNodes, nodes => {
  if (expandedInitialized || !nodes.length) return
  expandedInitialized = true
  resetExpanded()
}, { immediate: true })

// 配置变更：展开层数 / 范围 → 重置（节点内容变化不重置，保留用户手动展开的会话态）
watch([expandDepth, scope], () => {
  if (allNodes.value.length) resetExpanded()
})

const rows = computed<TreeRow[]>(() =>
  buildTreeRows({ nodes: allNodes.value, scope: scope.value, rootId: props.nodeId, expanded: expanded.value }),
)

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function dotClassOf(status: string): string {
  if (status === '完成') return 'trf-dot--done'
  if (status === '草稿') return 'trf-dot--draft'
  return 'trf-dot--todo'
}

function numberedName(row: TreeRow): string {
  if (!showNumbering.value) return row.name
  const chain = resolveNodeNumbering(row.id, allNodes.value)
  const prefix = formatNumbering(chain, numberingStyle.value)
  return prefix ? `${prefix} ${row.name}` : row.name
}

// ── 就地改名 ──────────────────────────────
const editingId = ref<string | null>(null)
const draft = ref('')
const editInput = ref<HTMLInputElement | null>(null)
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** 编辑会话起点值：整段会话（双击进入 → 提交）只登记**一步**撤销（与标题式同策略） */
let sessionPrev: string | null = null

function setEditInput(el: unknown): void {
  editInput.value = (el as HTMLInputElement | null) ?? null
}

function clearWriteTimer(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
}

function writeName(id: string, value: string): void {
  clearWriteTimer()
  const next = value.trim()
  const node = allNodes.value.find(n => n.id === id)
  if (next === (node?.name ?? '')) return
  void es.update(id, { name: next }, 'user', { skipUndo: true })
}

async function startEdit(row: TreeRow): Promise<void> {
  if (editingId.value === row.id) return
  editingId.value = row.id
  sessionPrev = row.name
  draft.value = row.name
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

function commit(id: string): void {
  if (editingId.value !== id) return
  writeName(id, draft.value)
  // 一次编辑会话 = 撤销栈一步（中间防抖写入不单独占步）
  const prev = sessionPrev ?? ''
  const next = (draft.value ?? '').trim()
  if (prev !== next) {
    boardUndo?.recordContentEdit(id, { name: prev }, { name: next }, '树内改名')
  }
  sessionPrev = null
  editingId.value = null
}

function cancel(): void {
  clearWriteTimer()
  // Esc 回滚：防抖可能已把中间值落库，这里显式写回会话起点值
  const id = editingId.value
  const prev = sessionPrev
  if (id && prev !== null) {
    const node = allNodes.value.find(n => n.id === id)
    if ((node?.name ?? '') !== prev) {
      void es.update(id, { name: prev }, 'user', { skipUndo: true })
    }
  }
  sessionPrev = null
  editingId.value = null
}

watch(draft, v => {
  if (editingId.value) {
    clearWriteTimer()
    writeTimer = setTimeout(() => writeName(editingId.value as string, v), WRITE_DEBOUNCE)
  }
})

defineExpose({ toggle, startEdit })
</script>

<style scoped>
.trf {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 22px;
}
.trf-empty {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  padding: 4px 2px;
}
.trf-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  color: var(--text-color);
}
.trf-caret {
  width: 12px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  /* 图标/符号按钮必须显式设色（WsIcon 与符号都走 currentColor） */
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  line-height: 1;
  cursor: pointer;
}
.trf-caret--empty { cursor: default; }
.trf-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.trf-dot--todo { background: var(--text-tertiary); }
.trf-dot--draft { background: var(--warning, #d97706); }
.trf-dot--done { background: var(--success, #059669); }
.trf-goto {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  line-height: 1;
  cursor: pointer;
  opacity: 0.35;
}
.trf-row:hover .trf-goto { opacity: 1; }
.trf-goto:hover { background: var(--bg-tertiary); color: var(--primary); }
.trf-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}
.trf-input {
  flex: 1;
  min-width: 60px;
  padding: 0 4px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
  outline: none;
}
</style>
