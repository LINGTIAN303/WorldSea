<template>
  <div class="manuscript-view">
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

    <!-- 层1：书籍列表（2026-09-14 书籍实体——先建书，点击书籍才进入章节编辑器）；
         书籍排序 = 网格拖拽（vuedraggable，sortOrder 落 book.properties） -->
    <div v-if="!inBook" class="ms-books">
      <draggable
        :list="books"
        item-key="id"
        class="ms-books-grid"
        ghost-class="ms-book-ghost"
        drag-class="ms-book-drag"
        @end="onBooksReorder"
      >
        <template #item="{ element: b }">
          <article
            class="ms-book-card"
            role="button"
            tabindex="0"
            @click="openBook(b.id)"
            @keydown.enter.prevent="openBook(b.id)"
          >
            <div class="ms-book-actions">
              <button class="ms-book-act" title="编辑信息" aria-label="编辑信息" @click.stop="openBookInfo(b)"><WsIcon name="edit" size="xs" /></button>
              <button class="ms-book-act" title="删除书籍" aria-label="删除书籍" @click.stop="deleteBook(b)"><WsIcon name="delete" size="xs" /></button>
            </div>
            <div class="ms-book-cover">
              <img v-if="bookCover(b)" :src="bookCover(b)" alt="" />
              <div v-else class="ms-book-cover-empty"><WsIcon name="book" size="lg" /></div>
            </div>
            <div class="ms-book-name">{{ b.name }}</div>
            <div class="ms-book-desc">{{ b.description || '暂无简介' }}</div>
            <div v-if="(b.tags as string[])?.length" class="ms-book-tags">
              <span v-for="t in (b.tags as string[]).slice(0, 3)" :key="t" class="ms-book-tag">{{ t }}</span>
              <span v-if="(b.tags as string[]).length > 3" class="ms-book-tag ms-book-tag--more">+{{ (b.tags as string[]).length - 3 }}</span>
            </div>
            <div class="ms-book-meta">
              <span>{{ chapterCount(b.id) }} 章</span>
              <span>{{ totalWords(b.id) }} 字</span>
            </div>
          </article>
        </template>
        <!-- 未归书虚拟卡片：不参与拖拽排序（#footer 不入排序列表） -->
        <template #footer>
          <article
            v-if="unfiledChapters.length > 0"
            class="ms-book-card ms-book-card--ghost"
            role="button"
            tabindex="0"
            @click="openBook('')"
            @keydown.enter.prevent="openBook('')"
          >
            <div class="ms-book-cover">
              <div class="ms-book-cover-empty"><WsIcon name="manuscript" size="lg" /></div>
            </div>
            <div class="ms-book-name">未归书章节</div>
            <div class="ms-book-desc">{{ unfiledChapters.length }} 个章节尚未归入任何书籍</div>
            <div class="ms-book-meta">
              <span>{{ unfiledChapters.length }} 章</span>
              <span>{{ unfiledWords }} 字</span>
            </div>
          </article>
        </template>
      </draggable>
      <WsEmpty v-if="books.length === 0 && unfiledChapters.length === 0" preset="no-data" title="还没有书籍——新建一本开始写作" />
    </div>

    <!-- 层2：书籍工作区（侧边栏章节列表 + 编辑器） -->
    <div v-else class="ms-body">
      <div class="ms-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="ms-sidebar-toggle" role="button" tabindex="0" :aria-expanded="!sidebarCollapsed" @click="sidebarCollapsed = !sidebarCollapsed" @keydown.enter.prevent="sidebarCollapsed = !sidebarCollapsed" @keydown.space.prevent="sidebarCollapsed = !sidebarCollapsed">
          <span><WsIcon :name="sidebarCollapsed ? 'chevron-right' : 'arrow-up'" size="xs" /></span>
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

      <div v-if="current" class="ms-main">
        <div class="ms-editor-header">
          <input ref="titleInputRef" v-model="editTitle" class="ms-title-input" placeholder="章节标题" @blur="saveTitle" />
          <div class="ms-header-actions">
            <CustomDropdown v-model="editStatus" :options="statusOptions" @update:modelValue="saveMeta" />
            <button class="ms-action-btn" title="快照" @click="saveSnapshot"><WsIcon name="image" size="sm" /></button>
            <button class="ms-action-btn" :class="{ active: showHistory }" title="历史" @click="showHistory = !showHistory"><WsIcon name="manuscript" size="sm" /></button>
            <button class="ms-action-btn" title="手机预览" @click="showPreview = true"><WsIcon name="keyboard" size="sm" /></button>
            <button class="ms-action-btn" :class="{ active: showAI }" title="AI 辅助" @click="showAI = !showAI"><WsIcon name="profile" size="sm" /></button>
            <button class="ms-action-btn" title="导出" @click="showExport = true"><WsIcon name="item" size="sm" /></button>
          </div>
        </div>
        <ChapterEditor
          :editor="editor ?? null"
          :save-status="saveStatus"
          :word-count="wordCount"
          :set-mention-popover="setMentionPopover"
          :on-mention-select="onMentionSelect"
          :set-slash-command-popover="setSlashCommandPopover"
          :on-slash-command-select="onSlashCommandSelect"
        />
        <div v-if="showHistory" class="ms-history">
          <div v-for="(snap, idx) in snapshots" :key="snap.time" class="ms-snap-item">
            <span class="ms-snap-time">{{ formatTime(snap.time) }}</span>
            <span class="ms-snap-words">{{ snap.wordCount }}字</span>
            <span v-if="snap.label" class="ms-snap-label">{{ snap.label }}</span>
            <button class="btn-sm" @click="restoreSnap(idx)">恢复</button>
            <button class="btn-sm btn-danger-sm" @click="deleteSnap(idx)" aria-label="删除快照"><WsIcon name="close" size="xs" /></button>
          </div>
          <WsEmpty v-if="snapshots.length === 0" preset="no-data" title="暂无版本快照" />
        </div>
      </div>

      <WsEmpty v-else preset="no-data" title="选择一个章节开始写作" />

      <AISidebar
        ref="aiSidebarRef"
        :visible="showAI"
        :chapter-content="previewHTML"
        :chapter-title="current?.name || ''"
        :selected-text="selectedText"
        @close="showAI = false"
        @adopt="adoptAIResult"
      />
    </div>

    <PhonePreview
      :visible="showPreview"
      :html="previewHTML"
      :title="current?.name || ''"
      @close="showPreview = false"
    />

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
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import draggable from 'vuedraggable'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { useDuplicateNameCheck, CustomDropdown, CreateButton } from '@worldsea/plugin-sdk'
import { WsIcon, WsEmpty, useConfirm } from '@worldsea/ui-kit'
import ChapterEditor from './components/ChapterEditor.vue'
import ChapterList from './components/ChapterList.vue'
import PhonePreview from './components/PhonePreview.vue'
import AISidebar from './components/AISidebar.vue'
import ExportDialog from './components/ExportDialog.vue'
import BookInfoDialog from './components/BookInfoDialog.vue'
import { useChapterEditor } from './composables/useChapterEditor'
import { useChapterSnapshots } from './composables/useChapterSnapshots'
import type { Entity } from '@worldsea/entity-core'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

const es = useEntityStore()
const rs = useRelationStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()

const current = ref<Entity | null>(null)
const titleInputRef = ref<HTMLInputElement | null>(null)
const editTitle = ref('')
const editStatus = ref('草稿')
const filterOutline = ref('')
const showPreview = ref(false)
const showAI = ref(false)
const showExport = ref(false)
const selectedText = ref('')
const sidebarCollapsed = ref(false)
const aiSidebarRef = ref<{ runAI: (mode: string) => void } | null>(null)

// ── 书籍导航（2026-09-14 书籍实体）──
// selectedBookId: null = 书籍列表层；'' = 未归书虚拟组；其他 = book 实体 id
const selectedBookId = ref<string | null>(null)
const inBook = computed(() => selectedBookId.value !== null)

const {
  editor, saveStatus, wordCount, loadChapter, flushSave,
  setMentionPopover, onMentionSelect,
  setSlashCommandPopover, setSlashCommandCallback, onSlashCommandSelect,
} = useChapterEditor(current)

setSlashCommandCallback((commandId: string) => {
  showAI.value = true
  nextTick(() => {
    aiSidebarRef.value?.runAI(commandId)
  })
})

const { snapshots, showHistory, loadSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } = useChapterSnapshots(current)

const previewHTML = computed(() => {
  if (!editor.value) return ''
  return editor.value.getHTML()
})

const statusOptions = [
  { value: '草稿', label: '草稿' },
  { value: '修订中', label: '修订中' },
  { value: '终稿', label: '终稿' },
]

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

/** 书籍封面 asset URL（BookInfoDialog 上传后落 properties.cover） */
function bookCover(b: Entity): string {
  return (b.properties.cover as string) || ''
}

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

/** 网格拖拽结束：按新顺序落 sortOrder（与 ChapterList onDragEnd 同款模式——
 *  draggable mutate 的临时数组在 @end 时即最终顺序，computed 重算自动刷新） */
async function onBooksReorder() {
  for (let i = 0; i < books.value.length; i++) {
    const b = books.value[i]
    if ((b.properties.sortOrder as number | undefined) !== i) {
      await es.update(b.id, { properties: { ...b.properties, sortOrder: i } })
    }
  }
}

/** 层2 侧栏标题：书名 / 未归书章节 */
const bookTitle = computed(() => selectedBook.value?.name || '未归书章节')

/** 当前书籍（或未归书组）内的章节，bookId 归属过滤（旧数据无 bookId 天然落未归书） */
const viewChapters = computed(() => {
  if (selectedBookId.value === null) return []
  const target = selectedBookId.value
  return manuscripts.value.filter(m => ((m.properties.bookId as string) || '') === target)
})

/** 未归书章节（书籍列表页虚拟卡片数据源） */
const unfiledChapters = computed(() =>
  manuscripts.value.filter(m => !m.properties.bookId)
)

const unfiledWords = computed(() =>
  unfiledChapters.value.reduce((s, m) => s + ((m.properties.wordCount as number) || 0), 0)
)

const filteredManuscripts = computed(() => {
  if (!filterOutline.value) return viewChapters.value
  return viewChapters.value.filter(m => m.properties.outlineNodeId === filterOutline.value)
})

const outlineNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

const outlineFilterOptions = computed(() => [
  { value: '', label: '全部章节' },
  ...outlineNodes.value.map(n => ({ value: n.id, label: n.name })),
])

function chapterCount(bookId: string): number {
  return manuscripts.value.filter(m => ((m.properties.bookId as string) || '') === bookId).length
}

function totalWords(bookId: string): number {
  return manuscripts.value
    .filter(m => ((m.properties.bookId as string) || '') === bookId)
    .reduce((s, m) => s + ((m.properties.wordCount as number) || 0), 0)
}

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
    nextTick(() => {
      titleInputRef.value?.focus()
      titleInputRef.value?.select()
    })
  }
}

async function saveTitle() {
  if (!current.value) return
  await es.update(current.value.id, { name: editTitle.value })
}

async function saveMeta() {
  if (!current.value) return
  await es.update(current.value.id, {
    properties: { ...current.value.properties, status: editStatus.value },
  })
}

async function deleteBook(book: Entity) {
  const count = chapterCount(book.id)
  const ok = await confirm({
    type: 'warning',
    title: '删除书籍',
    description: count > 0
      ? `「${book.name}」内有 ${count} 个章节，删除后这些章节将回到「未归书」，不会丢失内容。确定删除？`
      : `确定删除书籍「${book.name}」？`,
  })
  if (!ok) return
  // 章节不删，bookId 置空回到未归书（删书不删章）
  for (const ch of manuscripts.value.filter(m => ((m.properties.bookId as string) || '') === book.id)) {
    await es.update(ch.id, { properties: { ...ch.properties, bookId: '' } })
  }
  await es.remove(book.id)
  if (selectedBookId.value === book.id) await backToBooks()
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
      outlineNodeId: filterOutline.value || '',
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
    editor.value.commands.setContent(content, { emitUpdate: false })
  }
}

async function deleteSnap(idx: number) {
  await deleteSnapshot(idx)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function adoptAIResult(text: string) {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  if (from !== to) {
    editor.value.chain().focus().insertContentAt({ from, to }, text).run()
  } else {
    editor.value.chain().focus().insertContent(text).run()
  }
}

onMounted(async () => {
  try {
    await es.loadAll()
    await rs.loadAll()
  } catch (err) {
    console.warn('[ManuscriptView]', err)
  }
})

watch(current, (val, old) => {
  if (!val && old) {
    flushSave()
  }
})

// ── Agent bridge（2026-09-14 空壳清账：此前仅 console.log，工具 8 动作全部假成功。
//    本轮消费核心 6 项；insert_mention（插入位置语义）/ split_chapter（正文拆分逻辑）留挂账；
//    共性前提：bridge 依赖视图挂载，未挂载仍假成功——架构级缺陷另账）──

/** 工具侧英文状态枚举 → 芽内中文状态（plugin-backend-tools.ts:385 draft/writing/review/done） */
const agentStatusMap: Record<string, string> = { draft: '草稿', writing: '草稿', review: '修订中', done: '终稿' }

function stripTags(html: string): string {
  return (html || '').replace(/<[^>]*>/g, '')
}

function agentWordCount(html: string): number {
  return stripTags(html).length
}

useAgentPluginBridge('manuscript', async (event) => {
  const { action, payload } = event
  switch (action) {
    case 'create_chapter': {
      const title = (payload.title as string) || '未命名章节'
      const content = (payload.content as string) || ''
      const now = new Date().toISOString()
      const id = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      await es.add({
        id,
        type: 'manuscript',
        name: title,
        description: '',
        properties: {
          content,
          outlineNodeId: '',
          wordCount: agentWordCount(content),
          status: agentStatusMap[(payload.status as string) || 'draft'] || '草稿',
          sortOrder: viewChapters.value.length,
          volumeName: (payload.volumeName as string) || '',
          bookId: selectedBookId.value || '',
          entityMentions: '',
          snapshots: '[]',
        },
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      break
    }

    case 'update_chapter': {
      const ch = manuscripts.value.find(m => m.id === (payload.chapterId as string))
      if (!ch) break
      const properties = { ...ch.properties }
      if (payload.content !== undefined) {
        properties.content = payload.content as string
        properties.wordCount = agentWordCount(payload.content as string)
      }
      if (payload.status) properties.status = agentStatusMap[payload.status as string] || properties.status
      if (payload.volumeName !== undefined) properties.volumeName = payload.volumeName as string
      await es.update(ch.id, { properties })
      break
    }

    case 'list_chapters': {
      // emitPluginQuery 无返回通路 → window 变通回传（NotebookView list_notes 同款惯例）
      ;(window as unknown as Record<string, unknown>).__worldsea_manuscript_chapters__ =
        manuscripts.value.map(m => ({
          id: m.id,
          name: m.name,
          status: (m.properties.status as string) || '草稿',
          wordCount: m.properties.wordCount || 0,
          bookId: m.properties.bookId || '',
          volumeName: m.properties.volumeName || '',
        }))
      break
    }

    case 'get_chapter_content': {
      const ch = manuscripts.value.find(m => m.id === (payload.chapterId as string))
      ;(window as unknown as Record<string, unknown>).__worldsea_manuscript_chapter_content__ = ch
        ? { chapterId: ch.id, name: ch.name, content: ch.properties.content || '', found: true }
        : { chapterId: payload.chapterId, found: false }
      break
    }

    case 'export_document': {
      // 触发导出对话框（格式与范围由用户确认，Agent 不越权直接下载）
      showExport.value = true
      break
    }

    case 'reorder_chapters': {
      const ids = payload.chapterIds as string[]
      if (!Array.isArray(ids)) break
      for (let i = 0; i < ids.length; i++) {
        const ch = manuscripts.value.find(m => m.id === ids[i])
        if (ch && (ch.properties.sortOrder as number) !== i) {
          await es.update(ch.id, { properties: { ...ch.properties, sortOrder: i } })
        }
      }
      break
    }

    default:
      // insert_mention / split_chapter 挂账（见计划文档 §二）
      console.warn(`[Agent→manuscript] 未实现的动作: ${action}`, payload)
  }
})
</script>

<style scoped>
.manuscript-view {
  display: flex; flex-direction: column; height: 100%;
  padding: 16px 20px;
  background: var(--bg-primary);
}
.toolbar {
  display: flex; align-items: center; gap: 10px;
  margin: 0; flex-shrink: 0;
  padding: 0;
  border-bottom: none;
  min-width: 0;
  flex-wrap: nowrap;
}
.toolbar-info { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-left: auto; white-space: nowrap; }

/* ── 层1：书籍列表（2026-09-14 书籍实体）── */
.ms-books { flex: 1; overflow-y: auto; padding: 8px 4px; }
.ms-books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}
.ms-book-card {
  position: relative;
  padding: 0 16px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.ms-book-card:hover { border-color: var(--primary); box-shadow: 0 4px 14px rgba(0,0,0,0.08); transform: translateY(-2px); }
.ms-book-card--ghost { border-style: dashed; background: transparent; }
/* 拖拽态（vuedraggable ghost/drag class） */
.ms-book-ghost { opacity: 0.5; }
.ms-book-drag { opacity: 0.92; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }

/* hover 操作组（编辑信息 / 删除书籍） */
.ms-book-actions { position: absolute; top: 8px; right: 8px; z-index: 1; display: none; gap: 4px; }
.ms-book-card:hover .ms-book-actions { display: flex; }
.ms-book-act {
  width: 24px; height: 24px; padding: 0;
  border: none; background: var(--card-bg); border-radius: var(--radius-xs);
  color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.ms-book-act:hover { background: var(--hover-bg); color: var(--primary); }
.ms-book-actions .ms-book-act:last-child:hover { color: var(--danger); }

/* 封面区：负 margin 出血到卡片三边（顶部圆角由卡片 overflow:hidden 裁齐） */
.ms-book-cover {
  height: 150px; margin: 0 -16px 12px;
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: var(--bg-tertiary);
}
.ms-book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ms-book-cover-empty { color: var(--text-tertiary); }
.ms-book-name {
  font-size: var(--font-size-base); font-weight: var(--font-weight-semibold);
  color: var(--text-color); margin-bottom: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-book-desc {
  font-size: var(--font-size-xs); color: var(--text-tertiary);
  margin-bottom: 10px; min-height: 2.4em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ms-book-meta { display: flex; gap: 10px; font-size: var(--font-size-xs); color: var(--text-secondary); }
/* 书籍标签 chips（BookInfoDialog 编辑 entity.tags；最多显 3 个 + 溢出计数） */
.ms-book-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.ms-book-tag {
  font-size: var(--font-size-2xs); color: var(--text-secondary);
  background: var(--bg-tertiary); padding: 1px 6px; border-radius: var(--radius-2xs);
}
.ms-book-tag--more { color: var(--text-tertiary); }

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
.ms-sidebar.collapsed { width: 28px; }
.ms-sidebar-toggle {
  width: 28px;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12px;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  flex-shrink: 0;
  user-select: none;
  transition: color 0.15s;
}
.ms-sidebar-toggle:hover { color: var(--primary); }
.ms-sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 返回书籍列表（书籍工作区上行出口）+ 书籍信息编辑按钮 */
.ms-book-bar { display: flex; align-items: center; gap: 2px; margin: 6px 8px 0; flex-shrink: 0; }
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

.ms-editor-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  background: var(--card-bg);
  flex-shrink: 0;
}
.ms-title-input {
  flex: 1;
  padding: 6px 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-color);
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.ms-title-input:focus { border-bottom-color: var(--primary); }
.ms-header-actions {
  display: flex; align-items: center; gap: 4px; flex-shrink: 0;
}
.ms-action-btn {
  width: 32px; height: 32px; border: none; background: transparent;
  cursor: pointer; border-radius: var(--radius-sm); font-size: var(--font-size-lg);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.1s, transform 0.1s;
}
.ms-action-btn:hover { background: var(--hover-bg); transform: scale(1.1); }
.ms-action-btn.active { background: var(--primary-light); }

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
