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
        title="收起侧栏"
        aria-label="收起侧栏"
        @click="$emit('toggleCollapse')"
      >
        <WsIcon name="panel-right-close" size="xs" />
      </button>
      <span v-if="!collapsed" class="ns-title">{{ tab === 'nodes' ? '节点' : '章节' }}</span>
      <button
        v-else
        class="ns-toggle ns-toggle--collapsed"
        type="button"
        title="展开侧栏"
        aria-label="展开侧栏"
        @click="$emit('toggleCollapse')"
      >
        <WsIcon name="panel-right-open" size="sm" />
      </button>
    </div>

    <template v-if="!collapsed">
      <!-- 两个来源并列：节点（入板）/ 章节（新建节点并关联，或关联到已有容器） -->
      <div class="ns-tabs" role="tablist" aria-label="侧栏来源">
        <button
          v-for="t in TABS"
          :key="t.id"
          class="ns-tab"
          type="button"
          role="tab"
          :aria-selected="tab === t.id"
          :class="{ 'ns-tab--active': tab === t.id }"
          @click="switchTab(t.id)"
        >{{ t.label }}</button>
      </div>

      <div class="ns-search">
        <input
          v-model="query"
          class="ns-search-input"
          type="text"
          :placeholder="tab === 'nodes' ? '搜索节点…' : '搜索章节…'"
        />
      </div>

      <div ref="listEl" class="ns-list" role="tree">
        <template v-if="tab === 'nodes'">
          <div
            v-for="row in rows"
            :key="row.id"
            class="ns-item"
            :class="[
              { 'ns-item--placed': row.placed, 'ns-item--flash': flashId === row.id },
              dropClass(row.id),
            ]"
            :data-node-id="row.id"
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
        </template>

        <!-- 章节 tab：拖入画布 = 新建节点并关联；拖到容器上 = 只建立关联 -->
        <template v-else>
          <div
            v-for="c in chapterRows"
            :key="c.id"
            class="ns-item"
            :data-node-id="c.id"
            role="treeitem"
            :aria-level="1"
            :draggable="true"
            :title="c.linkedNodeName
              ? `已关联「${c.linkedNodeName}」（拖拽将改为关联落点节点）`
              : `${c.name}（拖到画布空白新建节点，拖到容器上则只建立关联）`"
            @dragstart="onChapterDragStart(c, $event)"
            @dblclick="emit('addChapter', c.id)"
            @click="emit('addChapter', c.id)"
          >
            <span class="ns-indent" />
            <span class="ns-caret ns-caret--empty" />
            <span class="ns-dot" :class="c.dotClass" />
            <span class="ns-name">{{ c.name }}</span>
            <span v-if="c.wordCount" class="ns-words">{{ c.wordCount }}字</span>
            <span v-if="c.linkedNodeName" class="ns-badge ns-badge--linked">{{ c.linkedNodeName }}</span>
          </div>

          <div v-if="!chapterRows.length" class="ns-empty">
            {{ isSearching ? '没有匹配的章节' : '还没有章节（在正文芽中创建）' }}
          </div>
        </template>
      </div>

      <div class="ns-hint">
        {{ tab === 'nodes' ? '拖到画布放置 · 双击落在视口中心' : '拖到空白新建节点并关联 · 拖到容器上只建立关联' }}
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
/**
 * 节点侧栏：只读展示 + 事件上报；入板逻辑在 BoardView（统一写入 useBoardLayout）。
 * 拖拽用 HTML5 DnD（与 module-builder 的 Toolbox 同路子），画布侧 dragover/drop 接收。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
// 显式导入（非全局组件）
import { WsIcon } from '@worldsea/ui-kit'
import { resolveChildNodes } from '../outlineDerive'
import { NODE_DND_MIME, CHAPTER_DND_MIME, readDndPayload, carriesChapter } from '../dnd'
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
  /**
   * 外部请求「在右栏中定位某节点」（右键菜单「在右栏中定位」）。
   * {id, token}：token 递增保证重复定位同一节点也能再次触发。
   */
  revealSignal?: { id: string; token: number } | null
  /** 章节 tab 的数据源（manuscript 实体；由装配层用只读 API 取，见 chapterLink） */
  chapters?: Entity[]
  /** 章节 id → 已关联的大纲节点名（「已关联」标记用；空表示未关联） */
  chapterNodeNames?: Map<string, string>
}>()

const emit = defineEmits<{
  (e: 'add', nodeId: string): void
  (e: 'locate', nodeId: string): void
  (e: 'toggleCollapse'): void
  /** 拖到另一个节点项上 → 层级重排（成为其子节点 / 插到其前 / 其后） */
  (e: 'reparent', draggedId: string, targetId: string, mode: DropMode): void
  /** 章节双击/单击 → 新建节点并建立关联（落到视口中心） */
  (e: 'addChapter', chapterId: string): void
  /** 拖章节到节点项上 → 把该章节关联到该节点（不新建） */
  (e: 'linkChapter', chapterId: string, nodeId: string): void
}>()

// ── 两个来源的 tab（节点 / 章节）───────────────
const TABS: Array<{ id: 'nodes' | 'chapters'; label: string }> = [
  { id: 'nodes', label: '节点' },
  { id: 'chapters', label: '章节' },
]
const tab = ref<'nodes' | 'chapters'>('nodes')

/** 切换 tab 时清空搜索：两个来源的过滤词不该互相继承（否则切过去看到空列表） */
function switchTab(next: 'nodes' | 'chapters'): void {
  if (tab.value === next) return
  tab.value = next
  query.value = ''
}

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
  // 章节载荷没有「位置」概念（它只能「关联到该节点」）→ 固定用「成为子节点」那种高亮，
  // 不给上/下插入线，避免暗示一个不存在的排序语义
  if (carriesChapter(ev.dataTransfer)) {
    dragOverId.value = row.id
    dragOverMode.value = 'child'
    return
  }
  const rect = el.getBoundingClientRect()
  const ratio = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5
  dragOverId.value = row.id
  dragOverMode.value = dropModeFromRatio(ratio)
}

function onItemDragLeave(row: Row): void {
  if (dragOverId.value === row.id) dragOverId.value = null
}

function onItemDrop(row: Row, ev: DragEvent): void {
  const payload = readDndPayload(ev)
  resetDropHint()
  if (!payload) return
  // 拖章节到节点项上 = 把该章节关联到这个节点（比「先入板再拖到容器上」更直接，
  // 且节点还没入板时也能用）。落点无位置语义，故 mode 不参与。
  if (payload.kind === 'chapter') {
    emit('linkChapter', payload.id, row.id)
    return
  }
  if (payload.id === row.id) return
  emit('reparent', payload.id, row.id, dragOverMode.value)
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

// ── 章节 tab ───────────────────────────────────
interface ChapterRow {
  id: string
  name: string
  wordCount: number
  /** 已关联的节点名（空 = 未关联） */
  linkedNodeName: string
  dotClass: string
}

/**
 * 章节行。搜索命中名或标签；顺序保持传入顺序（装配层已按卷/顺序排好），
 * 不在这里再排序——排序规则属数据侧，视图侧只做过滤。
 */
const chapterRows = computed<ChapterRow[]>(() => {
  const q = query.value.trim().toLowerCase()
  const names = props.chapterNodeNames ?? new Map<string, string>()
  const out: ChapterRow[] = []
  for (const c of props.chapters ?? []) {
    const status = (c.properties?.status as string) || '草稿'
    const name = (c.name ?? '').trim() || '未命名章节'
    const hay = `${name} ${c.description ?? ''} ${status}`.toLowerCase()
    if (q && !hay.includes(q)) continue
    out.push({
      id: c.id,
      name,
      wordCount: Number(c.properties?.wordCount ?? 0) || 0,
      linkedNodeName: names.get(c.id) ?? '',
      dotClass: status === '终稿'
        ? 'ns-dot--done'
        : status === '修订中' ? 'ns-dot--draft' : 'ns-dot--todo',
    })
  }
  return out
})

/** 章节拖拽源：写专用 MIME（与节点载荷区分，落点语义不同） */
function onChapterDragStart(c: ChapterRow, ev: DragEvent): void {
  if (!ev.dataTransfer) return
  ev.dataTransfer.effectAllowed = 'copy'
  ev.dataTransfer.setData(CHAPTER_DND_MIME, c.id)
  ev.dataTransfer.setData('text/plain', c.name)
}

// ── 外部定位（右键菜单「在右栏中定位」）──────────
/** 短暂高亮的目标（1.2s 后清除，用闪烁而非常驻，避免与「当前项」语义混淆） */
const flashId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null
const listEl = ref<HTMLElement | null>(null)

/**
 * 展开目标节点的**祖先链**并滚动到它。
 * 三个细节都不能省：
 * ① 祖先不展开则目标行根本不在 `rows` 里（树是懒展开的）；
 * ② 若正在搜索，目标可能被过滤掉 → 清空搜索（定位意图优先于过滤）；
 * ③ 右栏折叠时列表不存在，直接跳过（调用方会先展开右栏）。
 */
function revealNode(id: string): void {
  if (!id || props.collapsed) return
  if (query.value.trim()) query.value = ''

  const byId = new Map(props.nodes.map(n => [n.id, n]))
  const next = new Set(expanded.value)
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard < 64) {
    guard += 1
    const pid = (cur.properties?.parentId as string) || ''
    if (!pid) break
    next.add(pid)
    cur = byId.get(pid)
  }
  expanded.value = next

  flashId.value = id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashId.value = null }, 1200)

  void nextTick(() => {
    const el = listEl.value?.querySelector<HTMLElement>(`[data-node-id="${cssEscape(id)}"]`)
    el?.scrollIntoView({ block: 'center' })
  })
}

/** 节点 id 在本项目是 uuid/自定义串，进选择器前做最小转义（避免以数字开头时被当选择器语法） */
function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&')
}

watch(() => props.revealSignal, signal => {
  if (signal) revealNode(signal.id)
})

onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer)
})
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
/* 来源切换（节点 / 章节）：分段按钮，与画布悬浮条的吸附三态同一视觉语言 */
.ns-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  flex-shrink: 0;
}
.ns-tab {
  flex: 1;
  padding: 3px 0;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 显式设色：暗色主题下不设会继承成不可见（项目通用坑） */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.ns-tab:hover { background: var(--hover-bg); }
.ns-tab--active {
  border-color: var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-color);
}
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
.ns-item:active { cursor: grabbing; }
/* 已在板上：**仍可拖**（拖/双击 = 定位到已有容器），故光标不能回退成 default
   —— 原为 `cursor: default`，与 title 提示「拖拽或双击将定位到已有容器」自相矛盾，
   也让人误判「这条不可拖」（2026-09-17 真机反馈） */
.ns-item--placed { color: var(--text-tertiary); }
/* 外部定位后的短暂高亮（1.2s 后由组件清除） */
.ns-item--flash {
  background: var(--primary-soft, rgba(79, 70, 229, 0.12));
  box-shadow: inset 2px 0 0 0 var(--primary);
}
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
/* 章节行：字数与「已关联」徽标（徽标显示关联到的节点名，便于判断该不该再拖） */
.ns-words { flex-shrink: 0; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.ns-badge--linked {
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--primary);
  background: var(--primary-soft, rgba(79, 70, 229, 0.1));
}
.ns-hint {
  flex-shrink: 0;
  padding: 6px 8px;
  border-top: 1px solid var(--border-light);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
