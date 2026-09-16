<template>
  <!--
    右栏 · 节点侧栏（NodeSidebar）
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §0.1
    · 是「把已有节点放进画布」的**唯一入口**（拖拽 / 双击 / 搜索三种用法）
    · 已在板上的节点置灰并打标，拖拽与双击都转为「定位已有容器」（不重复建容器）
  -->
  <aside class="ns" :class="{ 'ns--collapsed': collapsed }">
    <div class="ns-head">
      <button
        v-if="!collapsed"
        class="ns-toggle"
        type="button"
        title="收起节点栏"
        aria-label="收起节点栏"
        @click="$emit('toggleCollapse')"
      >
        <WsIcon name="panel-right-close" size="xs" />
      </button>
      <span v-if="!collapsed" class="ns-title">节点</span>
      <button
        v-else
        class="ns-toggle ns-toggle--collapsed"
        type="button"
        title="展开节点栏"
        aria-label="展开节点栏"
        @click="$emit('toggleCollapse')"
      >
        <WsIcon name="panel-right-open" size="sm" />
      </button>
    </div>

    <template v-if="!collapsed">
      <div class="ns-search">
        <input v-model="query" class="ns-search-input" type="text" placeholder="搜索节点…" />
      </div>

      <div class="ns-list" role="tree">
        <div
          v-for="row in rows"
          :key="row.id"
          class="ns-item"
          :class="[{ 'ns-item--placed': row.placed }, dropClass(row.id)]"
          role="treeitem"
          :aria-level="row.depth + 1"
          :draggable="true"
          :title="row.placed ? '已在板上（拖拽或双击将定位到已有容器）；也可拖到其它节点上调整层级' : row.name"
          @dragstart="onDragStart(row, $event)"
          @dragover.prevent="onItemDragOver(row, $event)"
          @dragleave="onItemDragLeave(row)"
          @drop.prevent.stop="onItemDrop(row, $event)"
          @dragend="resetDropHint"
          @dblclick="onActivate(row)"
          @click="onActivate(row)"
        >
          <span class="ns-indent" :style="{ width: `${row.depth * 12}px` }" />
          <button
            v-if="row.hasChildren && !isSearching"
            class="ns-caret"
            type="button"
            :title="isExpanded(row.id) ? '折叠' : '展开'"
            @click.stop="toggleExpand(row.id)"
          >{{ isExpanded(row.id) ? '▾' : '▸' }}</button>
          <span v-else class="ns-caret ns-caret--empty" />
          <span class="ns-dot" :class="dotClassOf(row.status)" />
          <span class="ns-name">{{ row.name }}</span>
          <span v-if="row.placed" class="ns-badge">已在板上</span>
        </div>

        <div v-if="!rows.length" class="ns-empty">
          {{ isSearching ? '没有匹配的节点' : '还没有大纲节点' }}
        </div>
      </div>

      <div class="ns-hint">拖到画布放置 · 双击落在视口中心</div>
    </template>
  </aside>
</template>

<script setup lang="ts">
/**
 * 节点侧栏：只读展示 + 事件上报；入板逻辑在 BoardView（统一写入 useBoardLayout）。
 * 拖拽用 HTML5 DnD（与 module-builder 的 Toolbox 同路子），画布侧 dragover/drop 接收。
 */
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
// 显式导入（非全局组件）
import { WsIcon } from '@worldsea/ui-kit'
import { resolveChildNodes } from '../outlineDerive'
import { NODE_DND_MIME, readNodeIdFromDnD } from '../dnd'
import { dropModeFromRatio, type DropMode } from '../outlineHierarchy'

interface Row {
  id: string
  name: string
  depth: number
  hasChildren: boolean
  placed: boolean
  status: string
}

const props = defineProps<{
  nodes: Entity[]
  placedIds: Set<string>
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'add', nodeId: string): void
  (e: 'locate', nodeId: string): void
  (e: 'toggleCollapse'): void
  /** 拖到另一个节点项上 → 层级重排（成为其子节点 / 插到其前 / 其后） */
  (e: 'reparent', draggedId: string, targetId: string, mode: DropMode): void
}>()

const query = ref('')
const expanded = ref<Set<string>>(new Set())

const isSearching = computed(() => query.value.trim().length > 0)

/** 根节点默认展开一层（让用户一眼看到主干结构） */
const roots = computed(() => resolveChildNodes('', props.nodes))
watch(roots, list => {
  if (!expanded.value.size) {
    expanded.value = new Set(list.map(n => n.id))
  }
}, { immediate: true })

const nameOf = (n: Entity): string => (n.name ?? '').trim() || '未命名节点'

function isExpanded(id: string): boolean {
  return expanded.value.has(id)
}

function toggleExpand(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

/** 树行（深度优先，尊重展开态与搜索过滤） */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const q = query.value.trim().toLowerCase()

  const push = (list: Entity[], depth: number): void => {
    for (const n of list) {
      out.push({
        id: n.id,
        name: nameOf(n),
        depth,
        hasChildren: resolveChildNodes(n.id, props.nodes).length > 0,
        placed: props.placedIds.has(n.id),
        status: (n.properties?.status as string) || '未写',
      })
      if (isExpanded(n.id)) push(resolveChildNodes(n.id, props.nodes), depth + 1)
    }
  }
  push(roots.value, 0)

  if (!q) return out
  // 搜索：扁平展示命中项（忽略折叠），父链上的节点一并保留以免上下文丢失
  const matched = new Set<string>()
  for (const n of props.nodes) {
    const hay = `${nameOf(n)} ${(n.description ?? '')}`.toLowerCase()
    if (hay.includes(q)) matched.add(n.id)
  }
  const visible = new Set<string>(matched)
  // 补上命中项的祖先（保证层级可读）
  const byId = new Map(props.nodes.map(n => [n.id, n]))
  for (const id of matched) {
    let cur = byId.get(id)
    let guard = 0
    while (cur && guard < 64) {
      guard += 1
      const pid = (cur.properties?.parentId as string) || ''
      if (!pid) break
      visible.add(pid)
      cur = byId.get(pid)
    }
  }
  return out.filter(r => visible.has(r.id))
})

function dotClassOf(status: string): string {
  if (status === '完成') return 'ns-dot--done'
  if (status === '草稿') return 'ns-dot--draft'
  return 'ns-dot--todo'
}

function onDragStart(row: Row, ev: DragEvent): void {
  if (!ev.dataTransfer) return
  ev.dataTransfer.effectAllowed = 'copy'
  ev.dataTransfer.setData(NODE_DND_MIME, row.id)
  ev.dataTransfer.setData('text/plain', row.name)
}

// ── 层级重排（拖到节点项上）─────────────────
// 同一个拖拽按**落点**分流：落在画布上 = 入板（BoardCanvas 的 drop），
// 落在节点项上 = 层级重排（本组处理）。故画布侧不会误吞树内重排。
const dragOverId = ref<string | null>(null)
const dragOverMode = ref<DropMode>('child')

function dropClass(id: string): string | undefined {
  if (dragOverId.value !== id) return undefined
  if (dragOverMode.value === 'before') return 'ns-item--drop-before'
  if (dragOverMode.value === 'after') return 'ns-item--drop-after'
  return 'ns-item--drop-child'
}

function onItemDragOver(row: Row, ev: DragEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5
  dragOverId.value = row.id
  dragOverMode.value = dropModeFromRatio(ratio)
}

function onItemDragLeave(row: Row): void {
  if (dragOverId.value === row.id) dragOverId.value = null
}

function onItemDrop(row: Row, ev: DragEvent): void {
  const draggedId = readNodeIdFromDnD(ev)
  const mode = dragOverMode.value
  resetDropHint()
  if (!draggedId || draggedId === row.id) return
  emit('reparent', draggedId, row.id, mode)
}

function resetDropHint(): void {
  dragOverId.value = null
  dragOverMode.value = 'child'
}

/** 双击/单击 → 未入板则落到视口中心；已入板则定位已有容器 */
function onActivate(row: Row): void {
  if (row.placed) emit('locate', row.id)
  else emit('add', row.id)
}
</script>

<style scoped>
.ns {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-light);
  background: var(--menubar-bg, var(--bg-secondary));
}
.ns--collapsed { width: 32px; }
.ns-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.ns-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.ns-toggle:hover { background: var(--hover-bg); color: var(--primary); }
.ns-toggle--collapsed { width: 100%; height: 28px; }
.ns-title { font-size: var(--font-size-xs); color: var(--text-secondary); font-weight: var(--font-weight-medium); }
.ns-search { padding: 6px 8px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.ns-search-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-xs);
  outline: none;
}
.ns-search-input:focus { border-color: var(--primary); }
.ns-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
.ns-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--text-color);
  cursor: grab;
  user-select: none;
}
.ns-item:hover { background: var(--hover-bg); }
.ns-item--placed { color: var(--text-tertiary); cursor: default; }
/* 拖拽落点指示：上/下 = 插到前/后（指示线），中 = 成为子节点（高亮） */
.ns-item--drop-before { box-shadow: inset 0 2px 0 0 var(--primary); }
.ns-item--drop-after { box-shadow: inset 0 -2px 0 0 var(--primary); }
.ns-item--drop-child { background: var(--primary-light); }
.ns-indent { flex-shrink: 0; }
.ns-caret {
  width: 14px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.ns-caret--empty { cursor: default; }
.ns-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.ns-dot--todo { background: var(--text-tertiary); }
.ns-dot--draft { background: var(--warning, #d97706); }
.ns-dot--done { background: var(--success, #059669); }
.ns-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ns-badge {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-xs);
  padding: 0 4px;
}
.ns-empty { padding: 12px 10px; font-size: var(--font-size-2xs); color: var(--text-tertiary); text-align: center; }
.ns-hint {
  flex-shrink: 0;
  padding: 6px 8px;
  border-top: 1px solid var(--border-light);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
