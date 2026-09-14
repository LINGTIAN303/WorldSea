<template>
  <div class="chapter-list">
    <div class="cl-header">
      <span class="cl-title">{{ title }}</span>
      <span class="cl-count">{{ chapters.length }}</span>
    </div>

    <!-- 书内进度统计（2026-09-14 侧栏优化：总字数 + 各状态章节数一眼可见） -->
    <div class="cl-stats">
      <span class="cl-stats-words">{{ chapters.length }} 章 · {{ statsWords }} 字</span>
      <span class="cl-stats-status">
        <span class="st-draft">草 {{ statsByStatus('草稿') }}</span>
        <span class="st-revising">修 {{ statsByStatus('修订中') }}</span>
        <span class="st-final">终 {{ statsByStatus('终稿') }}</span>
      </span>
    </div>

    <div class="cl-search">
      <input v-model="searchQuery" class="cl-search-input" placeholder="搜索章节..." aria-label="搜索章节" />
    </div>

    <div v-for="group in groupedChapters" :key="group.name" class="cl-group">
      <div class="cl-group-header" role="button" tabindex="0" :aria-expanded="!isGroupCollapsed(group.name)" @click="toggleGroup(group.name)" @keydown.enter.prevent="toggleGroup(group.name)" @keydown.space.prevent="toggleGroup(group.name)">
        <span class="cl-collapse"><WsIcon :name="isGroupCollapsed(group.name) ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
        <span class="cl-group-name">{{ group.name }}</span>
        <span class="cl-group-count">{{ group.items.length }}</span>
      </div>
      <draggable
        v-show="!isGroupCollapsed(group.name)"
        :list="group.items"
        item-key="id"
        group="chapters"
        ghost-class="cl-ghost"
        drag-class="cl-drag"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div
            class="cl-item"
            :class="{ active: currentId === element.id }"
            role="button"
            tabindex="0"
            :aria-pressed="currentId === element.id"
            @click="$emit('select', element)"
            @keydown.enter.prevent="$emit('select', element)"
            @keydown.space.prevent="$emit('select', element)"
            @contextmenu.prevent="onContext($event, element)"
          >
            <span class="cl-item-name">{{ element.name }}</span>
            <div class="cl-item-meta">
              <span class="cl-status" :class="statusClass(element)">{{ (element.properties.status as string) || '草稿' }}</span>
              <span v-for="t in itemTags(element).slice(0, 2)" :key="t" class="cl-item-tag">{{ t }}</span>
              <span class="cl-words">{{ element.properties.wordCount || 0 }}字</span>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <WsEmpty v-if="chapters.length === 0" preset="no-data" title="暂无章节" />
    <WsEmpty v-else-if="groupedChapters.length === 0" preset="no-data" title="没有匹配的章节" />

    <div v-if="ctxMenu.show" ref="ctxMenuRef" class="cl-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" role="menu" tabindex="-1" @keydown="onCtxMenuKeydown">
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxRename" @keydown.enter.prevent="ctxRename"><WsIcon name="edit" size="xs" /> 重命名</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxCycleStatus" @keydown.enter.prevent="ctxCycleStatus"><WsIcon name="delete" size="xs" /> 切换状态</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxSetVolume" @keydown.enter.prevent="ctxSetVolume"><WsIcon name="folder" size="xs" /> 修改所属卷</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxLinkOutline" @keydown.enter.prevent="ctxLinkOutline"><WsIcon name="link" size="xs" /> 关联大纲节点</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxMoveToBook" @keydown.enter.prevent="ctxMoveToBook"><WsIcon name="book" size="xs" /> 移动到书籍</div>
      <div class="cl-ctx-divider"></div>
      <div class="cl-ctx-item cl-ctx-danger" role="menuitem" tabindex="0" @click="ctxDelete" @keydown.enter.prevent="ctxDelete"><WsIcon name="delete" size="xs" /> 删除</div>
    </div>

    <div v-if="showRenameInput" class="cl-modal-overlay" @click.self="showRenameInput = false">
      <div class="cl-modal-sm">
        <h4>重命名章节</h4>
        <input
          ref="renameInputRef"
          v-model="renameInputVal"
          class="cl-input"
          placeholder="章节标题"
          @keyup.enter="confirmRename"
        />
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showRenameInput = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmRename">确定</button>
        </div>
      </div>
    </div>

    <!-- 移动到书籍（2026-09-14 书籍迭代：存量章节改归属的唯一入口）；当前所属书禁选 -->
    <div v-if="showBookPicker" class="cl-modal-overlay" @click.self="showBookPicker = false">
      <div class="cl-modal-sm">
        <h4>移动到书籍</h4>
        <div class="cl-outline-list">
          <div
            v-for="b in bookOptions"
            :key="b.id"
            class="cl-outline-item"
            :class="{ active: bookPickId === b.id, disabled: ((ctxMenu.entity?.properties.bookId as string) || '') === b.id }"
            @click="pickBook(b.id)"
          >
            {{ b.name }}
          </div>
          <div class="cl-outline-item" :class="{ active: bookPickId === '', disabled: ((ctxMenu.entity?.properties.bookId as string) || '') === '' }" @click="pickBook('')">
            未归书
          </div>
        </div>
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showBookPicker = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmBookMove">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showVolumeInput" class="cl-modal-overlay" @click.self="showVolumeInput = false">
      <div class="cl-modal-sm">
        <h4>修改所属卷</h4>
        <input v-model="volumeInputVal" class="cl-input" placeholder="卷名（留空=未分组）" @keyup.enter="confirmVolume" />
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showVolumeInput = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmVolume">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showOutlinePicker" class="cl-modal-overlay" @click.self="showOutlinePicker = false">
      <div class="cl-modal-sm">
        <h4>关联大纲节点</h4>
        <div class="cl-outline-list">
          <div
            v-for="node in outlineNodes"
            :key="node.id"
            class="cl-outline-item"
            :class="{ active: outlinePickId === node.id }"
            @click="outlinePickId = node.id"
          >
            {{ node.name }}
          </div>
          <div class="cl-outline-item" :class="{ active: outlinePickId === '' }" @click="outlinePickId = ''">
            （无关联）
          </div>
        </div>
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showOutlinePicker = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmOutline">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, nextTick, onBeforeUnmount } from 'vue'
import draggable from 'vuedraggable'
import { WsIcon } from '@worldsea/ui-kit'
import { WsEmpty } from '@worldsea/ui-kit'
import { useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{
  chapters: Entity[]
  currentId: string
  /** 侧边栏标题（书籍工作区显示当前书名；书籍内联预览等场景可自定义） */
  title?: string
}>()

const emit = defineEmits<{
  select: [entity: Entity]
  reorder: []
  delete: [entity: Entity]
}>()

const es = useEntityStore()

// ── 分卷折叠持久化（2026-09-14 侧栏优化：此前刷新即丢；键按项目无关的全局——
//    卷名是自由文本、跨项目同名的记忆冲突可忽略，与 notebook 侧栏 tab 记忆同口径）──
const COLLAPSED_KEY = 'worldsea-manuscript-collapsed-vols'
const collapsedGroups = reactive(new Set<string>(loadCollapsedGroups()))

function loadCollapsedGroups(): string[] {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') } catch { return [] }
}
function saveCollapsedGroups(): void {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups])) } catch { /* 忽略 */ }
}

function toggleGroup(name: string) {
  if (collapsedGroups.has(name)) {
    collapsedGroups.delete(name)
  } else {
    collapsedGroups.add(name)
  }
  saveCollapsedGroups()
}

/** 书内进度统计（标题行下方小字条） */
const statsWords = computed(() =>
  props.chapters.reduce((s, c) => s + Number(c.properties.wordCount || 0), 0)
)

function statsByStatus(status: string): number {
  return props.chapters.filter(c => ((c.properties.status as string) || '草稿') === status).length
}

/** 章节行标签 chips（实体顶层 tags；最多显 2 个，溢出不计数保持 meta 行紧凑） */
function itemTags(e: Entity): string[] {
  return Array.isArray(e.tags) ? e.tags : []
}

/** 搜索时忽略折叠状态（命中组强制展开，避免「搜到了但看不见」） */
function isGroupCollapsed(name: string): boolean {
  return !searchQuery.value.trim() && collapsedGroups.has(name)
}

// ── 章节搜索（2026-09-14 侧栏优化：章节多时定位困难；按标题过滤，组内命中）──
const searchQuery = ref('')

interface ChapterGroup {
  name: string
  items: Entity[]
}

const groupedChapters = computed<ChapterGroup[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const map = new Map<string, Entity[]>()
  for (const ch of props.chapters) {
    if (q && !ch.name.toLowerCase().includes(q)) continue
    const vol = (ch.properties.volumeName as string) || ''
    const key = vol || '未分组'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(ch)
  }
  const result: ChapterGroup[] = []
  for (const [name, items] of map) {
    result.push({ name, items })
  }
  return result
})

const outlineNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

function statusClass(m: Entity): string {
  const s = (m.properties.status as string) || '草稿'
  if (s === '草稿') return 'st-draft'
  if (s === '修订中') return 'st-revising'
  if (s === '终稿') return 'st-final'
  return 'st-draft'
}

async function onDragEnd() {
  let order = 0
  for (const group of groupedChapters.value) {
    for (const item of group.items) {
      const currentSort = item.properties.sortOrder as number
      if (currentSort !== order) {
        await es.update(item.id, {
          properties: { ...item.properties, sortOrder: order },
        })
      }
      order++
    }
  }
  emit('reorder')
}

const ctxMenu = reactive({ show: false, x: 0, y: 0, entity: null as Entity | null })
const showRenameInput = ref(false)
const renameInputVal = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
const showVolumeInput = ref(false)
const volumeInputVal = ref('')
const showOutlinePicker = ref(false)
const outlinePickId = ref('')
const showBookPicker = ref(false)
const bookPickId = ref('')

/** 书籍选项（移动到书籍弹层；书籍列表从 store 自取，与 outlineNodes 同款） */
const bookOptions = computed(() => (es.entities ?? []).filter(e => e.type === 'book'))

const ctxMenuRef = ref<HTMLDivElement | null>(null)
let ctxMenuReturnFocusEl: HTMLElement | null = null

/** 菜单键盘导航：Esc 关闭 + 焦点归还（WAI-ARIA Menu 模式） */
function onCtxMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCtx()
  }
}

// 打开：记录触发元素并移焦首项；关闭：仅当焦点仍在菜单内时归还焦点
watch(() => ctxMenu.show, (show) => {
  if (show) {
    ctxMenuReturnFocusEl = document.activeElement as HTMLElement | null
    nextTick(() => {
      ctxMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
  } else if (ctxMenuReturnFocusEl) {
    const inside = ctxMenuRef.value?.contains(document.activeElement as Node)
    if (inside && ctxMenuReturnFocusEl.isConnected) ctxMenuReturnFocusEl.focus()
    ctxMenuReturnFocusEl = null
  }
})

function onContext(e: MouseEvent, entity: Entity) {
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.entity = entity
  ctxMenu.show = true
  document.addEventListener('click', closeCtx, { once: true })
}

function closeCtx() {
  ctxMenu.show = false
}

function ctxRename() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  // 自定义弹层替代原生 prompt（2026-09-14 侧栏优化：与修改所属卷弹层同款交互）
  renameInputVal.value = ctxMenu.entity.name
  showRenameInput.value = true
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

async function confirmRename() {
  showRenameInput.value = false
  if (!ctxMenu.entity) return
  const newName = renameInputVal.value.trim()
  if (newName && newName !== ctxMenu.entity.name) {
    await es.update(ctxMenu.entity.id, { name: newName })
  }
}

async function ctxCycleStatus() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  const statuses = ['草稿', '修订中', '终稿']
  const current = (ctxMenu.entity.properties.status as string) || '草稿'
  const idx = statuses.indexOf(current)
  const next = statuses[(idx + 1) % statuses.length]
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, status: next },
  })
}

function ctxSetVolume() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  volumeInputVal.value = (ctxMenu.entity.properties.volumeName as string) || ''
  showVolumeInput.value = true
}

async function confirmVolume() {
  showVolumeInput.value = false
  if (!ctxMenu.entity) return
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, volumeName: volumeInputVal.value },
  })
}

function ctxLinkOutline() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  outlinePickId.value = (ctxMenu.entity.properties.outlineNodeId as string) || ''
  showOutlinePicker.value = true
}

async function confirmOutline() {
  showOutlinePicker.value = false
  if (!ctxMenu.entity) return
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, outlineNodeId: outlinePickId.value },
  })
}

/** 章节跨书移动：目标 = 书籍 id 或 ''（未归书）；当前所属书禁选（点了无变化） */
function ctxMoveToBook() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  bookPickId.value = ((ctxMenu.entity.properties.bookId as string) || '')
  showBookPicker.value = true
}

function pickBook(id: string) {
  if (((ctxMenu.entity?.properties.bookId as string) || '') === id) return
  bookPickId.value = id
}

async function confirmBookMove() {
  showBookPicker.value = false
  if (!ctxMenu.entity) return
  const currentBookId = ((ctxMenu.entity.properties.bookId as string) || '')
  if (bookPickId.value === currentBookId) return // 无变化
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, bookId: bookPickId.value },
  })
}

function ctxDelete() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  emit('delete', ctxMenu.entity)
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtx)
})
</script>

<style scoped>
.chapter-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-family: var(--font-family-editor-ui);
}
.cl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.cl-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); }
.cl-count { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg-tertiary); padding: 1px 6px; border-radius: var(--radius-mid); }

/* 书内进度统计条（标题行下、搜索框上） */
.cl-stats {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 5px 12px; border-bottom: 1px solid var(--border-light); flex-shrink: 0;
  font-size: var(--font-size-2xs); color: var(--text-tertiary);
}
.cl-stats-status { display: flex; gap: 6px; }
.cl-stats-status .st-draft, .cl-stats-status .st-revising, .cl-stats-status .st-final {
  padding: 0 4px; border-radius: var(--radius-2xs);
}

/* 章节搜索（2026-09-14 侧栏优化） */
.cl-search { padding: 8px 10px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.cl-search-input {
  width: 100%; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  font-size: var(--font-size-xs); background: var(--input-bg); color: var(--text-color);
  outline: none; box-sizing: border-box; transition: border-color 0.15s;
}
.cl-search-input:focus { border-color: var(--primary); }
.cl-search-input::placeholder { color: var(--text-tertiary); }

.cl-group { display: flex; flex-direction: column; }
.cl-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--menubar-bg);
  border-bottom: 1px solid var(--border-light);
  user-select: none;
}
.cl-group-header:hover { background: var(--hover-bg); }
.cl-collapse { font-size: var(--font-size-xs); width: 14px; text-align: center; }
.cl-group-name { flex: 1; font-weight: var(--font-weight-medium); }
.cl-group-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cl-item {
  padding: 8px 12px 8px 20px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.1s;
}
.cl-item:hover { background: var(--hover-bg); }
.cl-item.active { background: var(--primary-light); }
.cl-item-name { display: block; font-weight: var(--font-weight-medium); font-size: var(--font-size-sm); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-item-meta { display: flex; align-items: center; gap: 6px; }
.cl-status { font-size: var(--font-size-xs); padding: 1px 5px; border-radius: var(--radius-2xs); }
.st-draft { background: var(--warning-soft, #fef3c7); color: var(--warning, #92400e); }
.st-revising { background: var(--info-soft, #dbeafe); color: var(--info, #1e40af); }
.st-final { background: var(--success-soft, #d1fae5); color: var(--success, #065f46); }
.cl-words { font-size: var(--font-size-xs); color: var(--text-tertiary); }
/* 章节行标签 chips（实体顶层 tags，最多显 2 个） */
.cl-item-tag {
  font-size: var(--font-size-2xs); color: var(--text-secondary);
  background: var(--bg-tertiary); padding: 0 4px; border-radius: var(--radius-2xs);
}

.cl-ghost { opacity: 0.4; background: var(--primary-light); }
.cl-drag { opacity: 0.9; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }

.cl-ctx-menu {
  position: fixed; z-index: var(--z-sticky); background: var(--modal-bg);
  border: 1px solid var(--border-color); border-radius: var(--radius-mid);
  padding: 4px 0; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.cl-ctx-item { padding: 7px 14px; font-size: var(--font-size-sm); cursor: pointer; color: var(--text-color); display: flex; align-items: center; gap: 6px; }
.cl-ctx-item:hover { background: var(--hover-bg); }
.cl-ctx-divider { height: 1px; background: var(--border-light); margin: 4px 0; }
.cl-ctx-danger { color: var(--danger); }
.cl-ctx-danger:hover { background: var(--danger-soft, rgba(220, 53, 69, 0.08)); }

.cl-modal-overlay { position: fixed; inset: 0; background: var(--color-overlay); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.cl-modal-sm { background: var(--modal-bg); border-radius: var(--radius-2xl); padding: 16px; max-width: 300px; width: 90%; }
.cl-modal-sm h4 { margin: 0 0 10px; font-size: var(--font-size-base); }
.cl-input { width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color); box-sizing: border-box; }
.cl-modal-actions { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }
.cl-outline-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.cl-outline-item { padding: 6px 10px; font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-xs); }
.cl-outline-item:hover { background: var(--hover-bg); }
.cl-outline-item.active { background: var(--active-bg); color: var(--primary); }
.cl-outline-item.disabled { opacity: 0.45; cursor: default; }
.cl-outline-item.disabled:hover { background: transparent; }
</style>
