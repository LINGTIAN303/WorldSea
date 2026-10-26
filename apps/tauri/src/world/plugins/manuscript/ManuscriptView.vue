<template>
  <div class="manuscript-view" :class="{ 'ms-focus': msFocusMode }">
    <!-- 工具栏按控件类型分发到 R3 统一工具条各落点（筛选→收束条，动作→动作区，新建→新建区）；
         书籍列表层隐藏筛选/章节统计，新建按钮切换为「新建书籍」 -->
    <Teleport to="#view-toolbar-filter-body">
      <CustomDropdown v-if="inBook" v-model="filterOutline" :options="outlineFilterOptions" />
    </Teleport>
    <Teleport to="#view-toolbar-actions">
      <span v-if="inBook" class="toolbar-info">共 {{ viewChapters.length }} 章</span>
    </Teleport>
    <Teleport to="#view-toolbar-create">
      <CreateButton :label="inBook ? '新建章节' : '新建书籍'" @click="inBook ? newManuscript() : startCreateBook()" />
    </Teleport>

    <!-- 层1：书籍列表（先建书，点击书籍才进入章节编辑器） -->
    <BookGrid
      v-if="!inBook"
      :books="books"
      :chapters="manuscripts"
      :loading="booksLoading"
      :loaded="booksLoaded"
      :error="booksError"
      @open="openBook"
      @edit="openBookInfo"
      @remove="deleteBook"
      @retry="retryBooks"
    />

    <!-- 层2：书籍工作区（侧边栏章节列表 + 编辑器）；专注模式藏侧栏、正文窄栏由排版偏好页宽决定 -->
    <div v-else class="ms-body">
      <div class="ms-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <!-- 展开/折叠：图标水平垂直居中于窄条；折叠态整条即按钮，展开态细条退让（2026-09-15 形态优化） -->
        <div
          class="ms-sidebar-toggle"
          role="button"
          tabindex="0"
          :aria-expanded="!sidebarCollapsed"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
          @keydown.enter.prevent="sidebarCollapsed = !sidebarCollapsed"
          @keydown.space.prevent="sidebarCollapsed = !sidebarCollapsed"
        >
          <span><WsIcon :name="sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'" :size="sidebarCollapsed ? 'sm' : 'xs'" /></span>
        </div>
        <div v-show="!sidebarCollapsed" class="ms-sidebar-content">
          <!-- 返回书籍列表（点击书籍才能进编辑器的上行出口）+ 书籍信息编辑 -->
          <div class="ms-book-bar">
            <button class="ms-back-btn" title="返回书籍列表" @click="backToBooks">
              <WsIcon name="arrow-left" size="xs" />
              <span class="ms-back-name">{{ bookTitle }}</span>
            </button>
            <button v-if="selectedBook" class="ms-bar-act" title="编辑书籍信息" aria-label="编辑书籍信息" @click="openBookInfo(selectedBook)">
              <WsIcon name="edit" size="xs" />
            </button>
          </div>
          <div class="ms-chapter-wrap">
            <ChapterList
              :chapters="filteredManuscripts"
              :current-id="current?.id || ''"
              :title="bookTitle"
              @select="select"
              @reorder="onReorder"
              @delete="deleteChapter"
            />
          </div>
        </div>
      </div>

      <div v-if="current" class="ms-main" :style="editorVars">
        <EditorHeader
          ref="headerRef"
          v-model:title="editTitle"
          :status="editStatus"
          :show-history="showHistory"
          :book-id="selectedBook?.id || ''"
          :editor="editor ?? null"
          @save-title="saveTitle"
          @status-change="onStatusChange"
          @snapshot="saveSnapshot"
          @toggle-history="showHistory = !showHistory"
          @preview="showPreview = true"
          @export="showExport = true"
        />
        <ChapterEditor
          :editor="editor ?? null"
          :save-status="saveStatus"
          :word-count="wordCount"
          :set-mention-popover="setMentionPopover"
          :on-mention-select="onMentionSelect"
          :set-slash-command-popover="setSlashCommandPopover"
          :on-slash-command-select="onSlashCommandSelect"
          :set-find-replace-api="setFindReplaceApi"
        />
        <div v-if="showHistory" class="ms-history">
          <div v-for="(snap, idx) in snapshots" :key="snap.time" class="ms-snap-item">
            <span class="ms-snap-time">{{ formatTime(snap.time) }}</span>
            <span class="ms-snap-words">{{ snap.wordCount }}字</span>
            <span v-if="snap.label" class="ms-snap-label">{{ snap.label }}</span>
            <TuiButton variant="secondary" size="sm" @click="restoreSnap(idx)">恢复</TuiButton>
            <TuiButton variant="secondary" size="sm" class="btn-danger-sm" @click="deleteSnap(idx)" aria-label="删除快照"><WsIcon name="close" size="xs" /></TuiButton>
          </div>
          <WsEmpty v-if="snapshots.length === 0" preset="no-data" title="暂无版本快照" />
        </div>
      </div>

      <WsEmpty v-else preset="no-data" title="选择一个章节开始写作" />

      <!-- 真右栏：dock 模式经 Teleport disabled 原地渲染为 .ms-body 布局流内的整列（编辑区让位）；
           popup 模式 Teleport 到 body 居中浮窗 -->
      <PhonePreview
        v-if="current"
        :visible="showPreview"
        :html="previewHTML"
        :title="current?.name || ''"
        :mode="settingsStore.phonePreviewMode"
        @close="showPreview = false"
      />
    </div>

    <ExportDialog
      v-if="showExport"
      :current-chapter="current"
      :all-chapters="viewChapters"
      :book="selectedBook"
      @close="showExport = false"
    />

    <!-- 书籍信息编辑/创建（书名/简介/封面；创建模式=editingBook 为 null，确认后才落地） -->
    <BookInfoDialog
      v-if="showBookInfo"
      :book="editingBook"
      :next-sort-order="books.length"
      @close="showBookInfo = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useEntityStore, useRelationStore, useSettingsStore } from '@worldsea/entity-core'
import { useDuplicateNameCheck, CustomDropdown, CreateButton } from '@worldsea/plugin-sdk'
import { TuiButton, WsIcon, WsEmpty, useAsyncTask, useConfirm } from '@worldsea/ui-kit'
import BookGrid from './components/BookGrid.vue'
import ChapterEditor from './components/ChapterEditor.vue'
import ChapterList from './components/ChapterList.vue'
import EditorHeader from './components/EditorHeader.vue'
import PhonePreview from './components/PhonePreview.vue'
import ExportDialog from './components/ExportDialog.vue'
import BookInfoDialog from './components/BookInfoDialog.vue'
import { useChapterEditor } from './composables/useChapterEditor'
import { useAutoSnapshot } from './composables/useAutoSnapshot'
import { msFontSize, msLineHeight, msPageWidth, msIndent, msFocusMode } from './composables/useWritingPrefs'
import { plainTextToEditorHtml } from '@/composables/plainTextToEditorHtml'
import { useChapterSnapshots } from './composables/useChapterSnapshots'
import { useManuscriptExternalNav } from './composables/useManuscriptExternalNav'
import type { Entity } from '@worldsea/entity-core'
// 「章节 ↔ 大纲节点」关联的唯一写入入口（新建章节归属节点时用，保证双侧一致）
import { buildChapterLinkIndex, linkChapterToNode } from '@/entity/chapterLink'

const es = useEntityStore()
const rs = useRelationStore()
const settingsStore = useSettingsStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()

const { visible: booksLoading, error: booksError, run: runBooksLoad } = useAsyncTask({ successHold: 0 })
const booksLoaded = ref(false)
const current = ref<Entity | null>(null)
const editTitle = ref('')
const editStatus = ref('草稿')
const filterOutline = ref('')
const showPreview = ref(false)
const showExport = ref(false)
const sidebarCollapsed = ref(false)
const headerRef = ref<InstanceType<typeof EditorHeader> | null>(null)

// ── 书籍导航（2026-09-14 书籍实体）──
// selectedBookId: null = 书籍列表层；'' = 未归书虚拟组；其他 = book 实体 id
const selectedBookId = ref<string | null>(null)
const inBook = computed(() => selectedBookId.value !== null)

const {
  editor, saveStatus, wordCount, loadChapter, flushSave,
  setMentionPopover, onMentionSelect,
  setSlashCommandPopover, onSlashCommandSelect,
  setFindReplaceApi, isFindBarOpen,
} = useChapterEditor(current)

const { snapshots, showHistory, loadSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } = useChapterSnapshots(current)

// 自动快照（批1 防丢稿）：定时 tick，条件与配额见 useAutoSnapshot / useChapterSnapshots
useAutoSnapshot({
  currentChapter: current,
  editor,
  saveStatus,
  createAutoSnapshot: (content, words) => createSnapshot(content, words, undefined, 'auto'),
})

const previewHTML = computed(() => {
  if (!editor.value) return ''
  return editor.value.getHTML()
})

// ── 排版偏好 → 编辑器呈现（CSS 变量；默认值 = 既有呈现，见 useWritingPrefs）──
const PAGE_WIDTH_PX: Record<string, string> = { full: 'none', standard: '760px', wide: '920px' }
const editorVars = computed<Record<string, string>>(() => ({
  '--ms-font-size': `${msFontSize.value}px`,
  '--ms-line-height': String(msLineHeight.value),
  '--ms-page-width': PAGE_WIDTH_PX[msPageWidth.value] ?? 'none',
  '--ms-indent': msIndent.value ? '2em' : '0',
}))

// ── 专注模式（批1）：Esc 退出；查找条开着时 Esc 归查找条（事件已 stop，双保险守卫）──
function onFocusEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (isFindBarOpen()) return
  msFocusMode.value = false
}
watch(msFocusMode, (on) => {
  if (on) window.addEventListener('keydown', onFocusEsc)
  else window.removeEventListener('keydown', onFocusEsc)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onFocusEsc))

const manuscripts = computed(() => {
  return (es.entities ?? [])
    .filter(e => e.type === 'manuscript')
    .sort((a, b) => ((a.properties.sortOrder as number) ?? 0) - ((b.properties.sortOrder as number) ?? 0))
})

const books = computed(() => (es.entities ?? [])
  .filter(e => e.type === 'book')
  // sortOrder 升序；旧书籍无该字段排最后，首次拖拽重排后自然收敛
  .sort((a, b) => ((a.properties.sortOrder as number) ?? Number.MAX_SAFE_INTEGER) - ((b.properties.sortOrder as number) ?? Number.MAX_SAFE_INTEGER)))

const selectedBook = computed(() =>
  selectedBookId.value ? books.value.find(b => b.id === selectedBookId.value) ?? null : null
)

// ── 书籍信息编辑（书名/简介/封面；层1 卡片 hover + 层2 返回条旁双入口）──
// editingBook=null 且 showBookInfo=true = 创建模式（弹窗确认后才落地实体，用户拍板）
const showBookInfo = ref(false)
const editingBook = ref<Entity | null>(null)

function openBookInfo(b: Entity) {
  editingBook.value = b
  showBookInfo.value = true
}

/** 新建书籍：先弹信息窗，填完书名/简介/封面确认后才创建（不再直接落「未命名书籍」） */
function startCreateBook() {
  editingBook.value = null
  showBookInfo.value = true
}

/** 层2 侧栏标题：书名 / 未归书章节 */
const bookTitle = computed(() => selectedBook.value?.name || '未归书章节')

/** 当前书籍（或未归书组）内的章节，bookId 归属过滤（旧数据无 bookId 天然落未归书） */
const viewChapters = computed(() => {
  if (selectedBookId.value === null) return []
  const target = selectedBookId.value
  return manuscripts.value.filter(m => ((m.properties.bookId as string) || '') === target)
})

const filteredManuscripts = computed(() => {
  if (!filterOutline.value) return viewChapters.value
  const nodeByChapter = buildChapterLinkIndex(es.entities ?? [], rs.relations ?? []).nodeByChapter
  return viewChapters.value.filter(m => nodeByChapter.get(m.id) === filterOutline.value)
})

const outlineNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

const outlineFilterOptions = computed(() => [
  { value: '', label: '全部章节' },
  ...outlineNodes.value.map(n => ({ value: n.id, label: n.name })),
])

/** 进入书籍工作区（离开当前章节前先落盘，避免防抖窗口丢改动） */
async function openBook(id: string) {
  await flushSave()
  current.value = null
  selectedBookId.value = id
  filterOutline.value = ''
}

async function backToBooks() {
  await flushSave()
  current.value = null
  selectedBookId.value = null
}

function select(m: Entity, opts: { focusTitle?: boolean } = {}) {
  current.value = m
  editTitle.value = m.name
  editStatus.value = (m.properties.status as string) || '草稿'
  loadChapter(m)
  loadSnapshots(m)
  // 新建章节：光标定位到编辑器头部章名行并全选（直接输入覆盖「未命名章节」）
  if (opts.focusTitle) {
    nextTick(() => headerRef.value?.focusTitle())
  }
}
useManuscriptExternalNav({ openBook, openChapter: select }) // 「打开正文」等外部章节跳转（接线收在 composable 内）

async function saveTitle() {
  if (!current.value) return
  await es.update(current.value.id, { name: editTitle.value })
}

function onStatusChange(value: string) {
  editStatus.value = value
  void saveMeta()
}

async function saveMeta() {
  if (!current.value) return
  await es.update(current.value.id, {
    properties: { ...current.value.properties, status: editStatus.value },
  })
}

async function deleteBook(book: Entity) {
  const count = viewChaptersFor(book.id).length
  const ok = await confirm({
    type: 'warning',
    title: '删除书籍',
    description: count > 0
      ? `「${book.name}」内有 ${count} 个章节，删除后这些章节将回到「未归书」，不会丢失内容。确定删除？`
      : `确定删除书籍「${book.name}」？`,
  })
  if (!ok) return
  // 章节不删，bookId 置空回到未归书（删书不删章）
  for (const ch of viewChaptersFor(book.id)) {
    await es.update(ch.id, { properties: { ...ch.properties, bookId: '' } })
  }
  await es.remove(book.id)
  if (selectedBookId.value === book.id) await backToBooks()
}

function viewChaptersFor(bookId: string) {
  return manuscripts.value.filter(m => ((m.properties.bookId as string) || '') === bookId)
}

async function newManuscript() {
  const defaultName = '未命名章节'
  const checkedName = await checkAndConfirmName(defaultName, undefined, 'manuscript')
  if (!checkedName) return
  const now = new Date().toISOString()
  const id = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  // 排序基线 = 当前书内章节数（书籍化后 sortOrder 是书内序）
  const sortOrder = viewChapters.value.length
  const entity: Entity = {
    id,
    type: 'manuscript',
    name: checkedName,
    description: '',
    properties: {
      content: '',
      wordCount: 0,
      status: '草稿',
      sortOrder,
      volumeName: '',
      bookId: selectedBookId.value || '',
      entityMentions: '',
      snapshots: '[]',
    },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  await es.add(entity)
  // 若当前是按某个大纲节点筛选（「在该节点下新建章节」），把归属写成**双向关联**——
  // 走唯一写入入口，否则只写章节侧、大纲白板的「打开正文」不会亮（09-18 收敛）
  if (filterOutline.value) await linkChapterToNode(es, rs, id, filterOutline.value)
  const created = (es.entities ?? []).find(e => e.id === id)
  if (created) select(created, { focusTitle: true })
}

async function deleteChapter(entity: Entity) {
  if (current.value?.id === entity.id) {
    await flushSave()
    current.value = null
  }
  await es.remove(entity.id)
}

function onReorder() {}

async function saveSnapshot() {
  if (!editor.value) return
  const html = editor.value.getHTML()
  const text = editor.value.getText()
  await createSnapshot(html, text.length)
}

async function restoreSnap(idx: number) {
  const content = await restoreSnapshot(idx)
  if (content && editor.value) {
    // 快照恒为 HTML（getHTML 存档），归一只兜底旧纯文本快照；含 < 时原样通过零变化
    editor.value.commands.setContent(plainTextToEditorHtml(content), { emitUpdate: false })
  }
}

async function deleteSnap(idx: number) {
  await deleteSnapshot(idx)
}

function formatTime(iso: string): string { return new Date(iso).toLocaleString() }

async function loadBooks(): Promise<void> {
  try {
    await runBooksLoad(async () => {
      await es.loadAll()
      await rs.loadAll()
      booksLoaded.value = true
    })
  } catch (err) {
    console.warn('[ManuscriptView]', err)
  }
}

function retryBooks(): void {
  void loadBooks()
}

onMounted(() => { void loadBooks() })

watch(current, (val, old) => {
  if (!val && old) {
    flushSave()
  }
})

</script>

<style scoped>
.manuscript-view {
  display: flex; flex-direction: column; height: 100%;
  padding: 16px 20px;
  background: var(--bg-primary);
}
.toolbar-info { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-left: auto; white-space: nowrap; }

/* 专注模式（批1）：侧栏退场、正文全区独占；窄栏由 --ms-page-width 决定（TypographyPanel） */
.manuscript-view.ms-focus .ms-sidebar { display: none; }

.ms-body { display: flex; flex: 1; gap: 0; overflow: hidden; }

.ms-sidebar {
  display: flex;
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-light);
  background: var(--card-bg);
  transition: width 0.2s ease;
  overflow: hidden;
}
.ms-sidebar.collapsed { width: 32px; }
/* 展开/折叠条（2026-09-15 形态优化）：
   展开态 = 20px 细条退让 + 图标水平垂直居中，默认无底色（hover 才浮现）；
   折叠态 = 整条 32px 即按钮，图标居中、热区给足 */
.ms-sidebar-toggle {
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  color: var(--text-tertiary);
  user-select: none;
  border-radius: var(--radius-xs);
  margin: 4px 0 4px 2px;
  transition: background 0.15s, color 0.15s, width 0.2s ease;
}
.ms-sidebar-toggle > span {
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  transition: background 0.15s, color 0.15s;
}
.ms-sidebar-toggle:hover { color: var(--primary); }
.ms-sidebar-toggle:hover > span { background: var(--hover-bg); }
/* 折叠态：整条即按钮（宽度撑满侧栏、全高、图标垂直居中） */
.ms-sidebar.collapsed .ms-sidebar-toggle {
  width: 32px;
  margin: 0;
  align-self: stretch;
  border-radius: 0;
}
.ms-sidebar.collapsed .ms-sidebar-toggle > span { width: 28px; height: 28px; }
.ms-sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ms-book-bar { display: flex; align-items: center; gap: 2px; padding: 6px 8px 2px; flex-shrink: 0; }
.ms-back-btn {
  display: flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0;
  padding: 6px 8px;
  border: none; border-radius: var(--radius-xs);
  background: transparent; cursor: pointer;
  color: var(--text-secondary); font-size: var(--font-size-sm);
  text-align: left;
  transition: background 0.15s, color 0.15s;
}
.ms-back-btn:hover { background: var(--hover-bg); color: var(--primary); }
.ms-back-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-medium); }
.ms-bar-act {
  width: 26px; height: 26px; padding: 0; flex-shrink: 0;
  border: none; border-radius: var(--radius-xs); background: transparent;
  color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.ms-bar-act:hover { background: var(--hover-bg); color: var(--primary); }
.ms-chapter-wrap { flex: 1; min-height: 0; }

.ms-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

.ms-history {
  border-top: 1px solid var(--border-light);
  padding: 8px 16px;
  max-height: 200px;
  overflow-y: auto;
  background: var(--menubar-bg);
  flex-shrink: 0;
}
.ms-snap-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border-light);
}
.ms-snap-item:last-child { border-bottom: none; }
.ms-snap-time { color: var(--text-secondary); flex: 1; }
.ms-snap-words { color: var(--text-tertiary); }
.ms-snap-label { color: var(--primary); font-style: italic; }
.btn-danger-sm { color: var(--danger); }
</style>
