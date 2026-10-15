<template>
  <div class="notebook-view">
    <!-- 工具栏按控件类型分发到 R3 统一工具条各落点（动作→动作区，新建→新建区） -->
    <Teleport to="#view-toolbar-actions">
      <button class="nb-sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? '收起侧边栏' : '展开侧边栏'">
        <span class="nb-toggle-icon"><WsIcon :name="sidebarOpen ? 'arrow-up' : 'chevron-right'" size="xs" /></span>
      </button>
      <button
        v-for="mode in VIEW_MODES"
        :key="mode"
        :class="['nb-mode-btn', { active: currentMode === mode }]"
        @click="currentMode = mode"
      >
        <WsIcon :name="modeIcons[mode]" size="xs" /> {{ modeLabels[mode] }}
      </button>
    </Teleport>
    <Teleport to="#view-toolbar-create">
      <button class="nb-action-btn" @click="createNote()">+ 笔记</button>
      <button class="nb-action-btn nb-folder-btn" @click="createFolder">+ 文件夹</button>
    </Teleport>

    <div class="nb-content">
      <div :class="['nb-sidebar', { collapsed: !sidebarOpen }]">
        <div class="nb-sidebar-inner">
          <!-- 三期：笔记 / 文件双 tab（拍板=并列双 tab，零数据迁移；文件侧复用 FileTreeBrowser） -->
          <div class="nb-side-tabs">
            <button class="nb-side-tab" :class="{ on: sidebarTab === 'notes' }" @click="sidebarTab = 'notes'">笔记</button>
            <button class="nb-side-tab" :class="{ on: sidebarTab === 'files' }" @click="sidebarTab = 'files'">文件</button>
          </div>
          <template v-if="sidebarTab === 'notes'">
            <div class="nb-search">
              <input v-model="searchQuery" class="nb-search-input" placeholder="搜索笔记..." />
            </div>
            <div class="nb-note-list">
              <FolderTree
              :folders="folders"
              :selectedNoteId="selectedNoteId"
              :collapsedFolders="collapsedFolders"
              :unfiledNotes="unfiledNotes"
              :allNotes="notebookNotes"
              :searchResults="filteredNotes"
              :searchMode="!!searchQuery"
              :pendingDeleteId="pendingDeleteFolderId"
              :folderToRename="folderToRename"
              :pinnedNotes="pinnedNotes"
              :recentNotes="recentNotes"
              :searchQuery="searchQuery"
              @renameMode="clearFolderToRename"
              @selectNote="selectedNoteId = $event"
              @toggleFolder="toggleFolder"
              @deleteFolder="deleteFolder"
              @moveNote="moveNoteToFolder"
              @renameFolder="renameFolder"
              @reorderFolders="reorderFolders"
              @createNote="createNote"
              @createFolder="createFolder"
              @duplicateNote="duplicateNote"
              @deleteNote="deleteNote"
              @reorderNotes="reorderNotes"
              @togglePin="togglePin"
            />
            </div>
          </template>
          <template v-else>
            <!-- 孤儿清理操作条（assets/ 兼作素材库，不做自动清理 → 显式按钮 + confirm） -->
            <div class="nb-assets-actions">
              <button
                class="nb-clean-btn"
                :disabled="cleaningAssets || !filesRoot"
                title="删除 assets/ 下未被任何实体引用、且写入超过 24 小时的图片"
                @click="onCleanOrphanAssets"
              >清理未引用图片</button>
            </div>
            <div class="nb-note-list">
              <FileTreeBrowser
                ref="assetTreeRef"
                v-if="filesRoot"
                :root-path="filesRoot"
                compact
                title="素材（支持格式）"
                :file-filter="isSupportedAsset"
                @select="onAssetSelect"
              />
              <div v-else class="nb-files-empty">项目目录未就绪</div>
            </div>
          </template>
        </div>

      </div>

      <div class="nb-main">
        <NotebookEditor
          v-if="currentMode === 'editor' && currentNote"
          :note="currentNote"
          :folders="folders"
          @update="onNoteUpdate"
          @navigate="selectedNoteId = $event"
          @export="showExport = true"
        />
        <NotebookBoard
          v-else-if="currentMode === 'board'"
          :notes="filteredNotes"
          :searching="!!searchQuery"
          @select="selectedNoteId = $event"
        />
        <NotebookGraph
          v-else-if="currentMode === 'graph'"
          :notes="filteredNotes"
          @select="selectedNoteId = $event"
        />
        <!-- 主区空态（批 4 V7，走查修正=去按钮、引导语承载动作）：区分「一篇都没有」与「未选中」 -->
        <WsEmpty
          v-else
          :title="notebookNotes.length ? '选择一篇笔记开始' : '创建你的第一篇笔记'"
          :description="notebookNotes.length ? '从左侧列表选择，或点击工具栏「+ 笔记」新建' : '点击工具栏「+ 笔记」开始记录想法、素材与知识'"
        >
          <template #icon><WsIcon name="notebook" size="xl" /></template>
        </WsEmpty>
      </div>
    </div>

    <!-- 导出（2026-09-14 补缺口：笔记本此前无导出入口；复用文稿 ExportDialog，noun=笔记） -->
    <ExportDialog
      v-if="showExport"
      :current-chapter="currentNote"
      :all-chapters="notebookNotes"
      noun="笔记"
      @close="showExport = false"
    />

    <!-- 素材预览浮层：FilePreview 自带 IO（按 path 读 base64 分发四渲染器），笔记本内直接复用 -->
    <Teleport to="body">
      <div v-if="previewFile" class="nb-file-preview-overlay" @click.self="previewFile = null">
        <div class="nb-file-preview-panel">
          <button class="nb-file-preview-close" title="关闭预览" @click="previewFile = null"><WsIcon name="close" size="sm" /></button>
          <FilePreview
            :path="previewFile.path"
            :name="previewFile.name"
            :size="previewFile.size"
            @close="previewFile = null"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore, useBidirectional, useUndoRedo } from '@worldsea/entity-core'
import type { Relation } from '@worldsea/entity-core'
import { WsEmpty, WsIcon, useConfirm } from '@worldsea/ui-kit'
import NotebookEditor from './components/NotebookEditor.vue'
import NotebookBoard from './components/NotebookBoard.vue'
import NotebookGraph from './components/NotebookGraph.vue'
import FolderTree from './components/FolderTree.vue'
import FileTreeBrowser from '@/components/files/FileTreeBrowser.vue'
import FilePreview from '@/components/files/FilePreview.vue'
import ExportDialog from '@/world/plugins/manuscript/components/ExportDialog.vue'
import { resolveEntityDataDir } from '@/composables/workspace'
import { toastInfo, toastSuccess, toastWarn } from '@/composables/useToast'
import { collectAssetDiskPaths, deleteOrphanAssets, findOrphanAssets, listAssetFiles } from '@/composables/imageAssets'
import { isSupportedAsset } from './assetFilter'
import { markdownToPlainText } from '@/composables/markdownText'
import { VIEW_MODES } from './notebookConfig'
import type { ViewMode } from './notebookConfig'
import type { NotebookEntity } from './types'

interface NotebookFolder {
  id: string
  name: string
}

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { createBidirectional } = useBidirectional()
const { beginTransaction, commitTransaction, rollbackTransaction } = useUndoRedo()
const currentMode = ref<ViewMode>('editor')
const searchQuery = ref('')
const selectedNoteId = ref<string | null>(null)
const collapsedFolders = reactive(new Set<string>())
const sidebarOpen = ref(true)

// ── 三期：侧栏「笔记 / 文件」双 tab（拍板=并列双 tab）──
// tab 记忆按项目目录隔离没必要（同一用户习惯跨项目一致），直接全局 localStorage；
// 文件根 = resolveEntityDataDir()（普通项目=dirPath，默认项目=worlddata，与工作台实体同源）。
const SIDEBAR_TAB_KEY = 'worldsea-notebook-sidebar-tab'
const sidebarTab = ref<'notes' | 'files'>(
  localStorage.getItem(SIDEBAR_TAB_KEY) === 'files' ? 'files' : 'notes',
)
watch(sidebarTab, (v) => {
  try { localStorage.setItem(SIDEBAR_TAB_KEY, v) } catch { /* 忽略 */ }
})
const filesRoot = ref<string | null>(null)
onMounted(async () => {
  filesRoot.value = await resolveEntityDataDir()
})

// ── 导出入口（挂文稿 ExportDialog，noun=笔记；currentNote 为 null 时对话框由 v-if 挡住）──
const showExport = ref(false)

// ── 素材面板（2026-09-14 拍板 C：文件 tab 重定位）──
// 筛选 = isSupportedAsset（图片 + 四渲染器文档），不支持格式不显示；
// 点击支持格式的文件 → 浮层内联预览（FilePreview 自带 IO，按 path 读 base64 分发四渲染器）。
interface PreviewFile { name: string; path: string; size: number }
const previewFile = ref<PreviewFile | null>(null)
function onAssetSelect(node: { name: string; path: string; size: number }): void {
  if (!isSupportedAsset(node.name)) return
  previewFile.value = { name: node.name, path: node.path, size: node.size }
}

// ── 孤儿资产清理（2026-09-14 挂账：删笔记后 assets/ 图片残留无人回收）──
// assets/ 兼作素材库（用户手动放的未引用图不能被自动删）→ 不做自动惰性清理，
// 改显式按钮 + confirm 列表。引用集 = 全部实体 properties（不限于笔记，文稿
// 正文同样引用资产）；宽限期 24h 在 imageAssets.findOrphanAssets 内判定。
const { confirm } = useConfirm()
const assetTreeRef = ref<{ refresh: () => Promise<void> } | null>(null)
const cleaningAssets = ref(false)

async function onCleanOrphanAssets(): Promise<void> {
  if (!filesRoot.value || cleaningAssets.value) return
  cleaningAssets.value = true
  try {
    const texts = entityStore.entities.map((e) => JSON.stringify(e.properties ?? {}))
    const refs = collectAssetDiskPaths(texts)
    const files = await listAssetFiles(filesRoot.value)
    const orphans = findOrphanAssets(files, refs, Date.now())
    if (orphans.length === 0) {
      toastInfo('没有发现未引用的图片')
      return
    }
    const totalBytes = orphans.reduce((s, f) => s + (f.size || 0), 0)
    const ok = await confirm({
      type: 'warning',
      title: '清理未引用图片',
      description: `将删除 ${orphans.length} 个未被任何实体引用的图片（共 ${(totalBytes / 1024 / 1024).toFixed(2)}MB，24 小时内新写入的文件不会清理）。确定继续？`,
    })
    if (!ok) return
    const failed = await deleteOrphanAssets(orphans.map((f) => f.path))
    if (failed.length === 0) toastSuccess(`已清理 ${orphans.length} 个未引用图片`)
    else toastWarn(`已清理 ${orphans.length - failed.length} 个，${failed.length} 个删除失败`)
    await assetTreeRef.value?.refresh()
  } finally {
    cleaningAssets.value = false
  }
}
const folderToRename = ref<string | null>(null)
const pendingDeleteFolderId = ref<string | null>(null)

const STORAGE_KEY_FOLDERS = 'worldsea-notebook-folders'
const STORAGE_KEY_COLLAPSED = 'worldsea-notebook-collapsed'
const STORAGE_KEY_SIDEBAR = 'worldsea-notebook-sidebar'

const folders = ref<NotebookFolder[]>(loadFolders())
collapsedFolders.clear()
for (const id of loadCollapsed()) collapsedFolders.add(id)
sidebarOpen.value = loadSidebar()

function loadFolders(): NotebookFolder[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FOLDERS) || '[]') } catch { return [] }
}
function saveFolders(): void { localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders.value)) }
function loadCollapsed(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_COLLAPSED) || '[]') } catch { return [] }
}
function saveCollapsed(): void { localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify([...collapsedFolders])) }
function loadSidebar(): boolean {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SIDEBAR) || 'true') } catch { return true }
}
function saveSidebar(): void { localStorage.setItem(STORAGE_KEY_SIDEBAR, JSON.stringify(sidebarOpen.value)) }

const modeIcons: Record<ViewMode, string> = {
  editor: 'edit',
  board: 'dashboard',
  graph: 'link',
}

const modeLabels: Record<ViewMode, string> = {
  editor: '编辑',
  board: '看板',
  graph: '图谱',
}

const notebookNotes = computed(() =>
  entityStore.entities.filter((e): e is NotebookEntity => e.type === 'notebook')
)

// ── 置顶 + 最近打开（批 3 I9）──
// 置顶 = properties.pinned（实体属性，随笔记走）；最近 = localStorage 记最近 5 个 id（跨会话）。
const pinnedNotes = computed(() =>
  notebookNotes.value.filter(n => n.properties?.pinned === true)
)

const RECENT_KEY = 'worldsea-notebook-recent'
const RECENT_MAX = 5
const recentIds = ref<string[]>(loadRecent())
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
watch(selectedNoteId, (id) => {
  if (!id) return
  recentIds.value = [id, ...recentIds.value.filter(x => x !== id)].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds.value)) } catch { /* 忽略 */ }
})
const recentNotes = computed(() =>
  recentIds.value
    .map(id => notebookNotes.value.find(n => n.id === id))
    .filter((n): n is NotebookEntity => !!n)
)

function togglePin(noteId: string): void {
  const note = notebookNotes.value.find(n => n.id === noteId)
  if (!note) return
  entityStore.update(noteId, {
    properties: { ...note.properties, pinned: !note.properties?.pinned },
  })
}

/** 正文检索文本：剥 md 标记（单源 `@/composables/markdownText`，块 1 阶段 3）；压平保证摘要单行 */
function plainText(md?: string): string {
  return markdownToPlainText(md).replace(/\s+/g, ' ')
}

/**
 * 搜索过滤（批 3 I8/F1）：`#标签` 语法按实体 tags 过滤（取首个 # 词），普通词走
 * 标题/描述/正文（plainText 剥标签防标签噪声命中）。# 词可混排：先按 # 过滤再按普通词。
 */
const filteredNotes = computed(() => {
  let pool = notebookNotes.value
  let textQuery = searchQuery.value
  const tagMatch = textQuery.match(/#(\S+)/)
  if (tagMatch) {
    const tag = tagMatch[1].toLowerCase()
    pool = pool.filter(n => (n.tags || []).some(t => t.toLowerCase().includes(tag)))
    textQuery = textQuery.replace(/#\S+/g, '').trim()
  }
  if (!textQuery) return pool
  const q = textQuery.toLowerCase()
  return pool.filter((n) =>
    n.name.toLowerCase().includes(q) ||
    (n.description || '').toLowerCase().includes(q) ||
    plainText(n.properties?.content).toLowerCase().includes(q)
  )
})

const unfiledNotes = computed(() =>
  notebookNotes.value.filter((n) => {
    const fid = n.properties?.folderId
    return !fid || !folders.value.some(f => f.id === fid)
  })
)

function getFolderNotes(folderId: string): NotebookEntity[] {
  return notebookNotes.value
    .filter((n) => n.properties?.folderId === folderId)
    .sort((a, b) => ((a.properties?.sortOrder || '0').localeCompare(b.properties?.sortOrder || '0', undefined, { numeric: true })))
}

const currentNote = computed(() =>
  selectedNoteId.value
    ? notebookNotes.value.find((n) => n.id === selectedNoteId.value) ?? null
    : null
)

function toggleFolder(id: string): void {
  if (collapsedFolders.has(id)) collapsedFolders.delete(id)
  else collapsedFolders.add(id)
  saveCollapsed()
}

async function createNote(targetFolderId?: string): Promise<void> {
  const targetFolder = targetFolderId ?? ''
  const id = await entityStore.add({
    id: crypto.randomUUID(),
    type: 'notebook',
    name: '未命名笔记',
    description: '',
    properties: {
      content: '',
      noteType: 'markdown',
      linkedEntities: [],
      codeLanguage: '',
      codeOutput: '',
      sortOrder: Date.now().toString(),
      folderId: targetFolder,
    },
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, 'user')
  selectedNoteId.value = id
  if (collapsedFolders.has(targetFolder)) {
    collapsedFolders.delete(targetFolder)
    saveCollapsed()
  }
}

function createFolder(): void {
  const id = crypto.randomUUID()
  folders.value.push({ id, name: '新建文件夹' })
  saveFolders()
  folderToRename.value = id
}

function clearFolderToRename(): void {
  folderToRename.value = null
}

/**
 * 把一组实体更新归并为**一条**撤销记录。
 *
 * `entityStore.update` 每条都会 record() 进全局撤销栈，而栈上限只有 20（见 MEMORY 工程教训 29）
 * —— 一次拖拽重排、一次删文件夹都会连带更新 N 条笔记；若不归并，单次操作就把用户的历史冲光。
 * `record()` 在 update() 内部是**同步**执行的，所以这里同步 begin/commit 即可正确归组。
 */
function asSingleUndoStep(description: string, write: () => void): void {
  beginTransaction()
  try {
    write()
    commitTransaction(description)
  } catch (err) {
    rollbackTransaction()
    console.warn('[NotebookView] 批量更新失败', err)
  }
}

function deleteFolder(folderId: string): void {
  if (pendingDeleteFolderId.value === folderId) {
    const folder = folders.value.find(f => f.id === folderId)
    if (folder) {
      // 文件夹内的笔记要一并移出，属同一次用户动作 → 归并为一条撤销记录
      asSingleUndoStep('删除文件夹', () => {
        for (const note of getFolderNotes(folderId)) {
          entityStore.update(note.id, { properties: { ...note.properties, folderId: '' } })
        }
      })
      folders.value = folders.value.filter(f => f.id !== folderId)
      collapsedFolders.delete(folderId)
      saveFolders()
      saveCollapsed()
    }
    pendingDeleteFolderId.value = null
  } else {
    pendingDeleteFolderId.value = folderId
    setTimeout(() => { if (pendingDeleteFolderId.value === folderId) pendingDeleteFolderId.value = null }, 3000)
  }
}

function moveNoteToFolder(noteId: string, folderId: string): void {
  const note = notebookNotes.value.find((n) => n.id === noteId)
  if (!note) return
  entityStore.update(noteId, {
    properties: { ...note.properties, folderId },
  })
}

async function duplicateNote(noteId: string): Promise<void> {
  const note = notebookNotes.value.find((n) => n.id === noteId)
  if (!note) return
  const id = await entityStore.add({
    ...note,
    id: crypto.randomUUID(),
    name: note.name + '（副本）',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, 'user')
  selectedNoteId.value = id
}

async function deleteNote(noteId: string): Promise<void> {
  // 丢弃待写入，避免笔记删除后闸门再把它写回来
  pendingWrites.delete(noteId)
  await entityStore.remove(noteId)
  if (selectedNoteId.value === noteId) selectedNoteId.value = null
}

function reorderNotes(_folderId: string, noteIds: string[]): void {
  // 一次拖拽 = 一次操作：逐条 update 会产生 N 条撤销记录，归并后只留一条
  asSingleUndoStep('调整笔记顺序', () => {
    for (let i = 0; i < noteIds.length; i++) {
      const note = notebookNotes.value.find((n) => n.id === noteIds[i])
      if (!note) continue
      const sortOrder = String(i).padStart(10, '0')
      if (note.properties?.sortOrder !== sortOrder) {
        entityStore.update(note.id, {
          properties: { ...note.properties, sortOrder },
        })
      }
    }
  })
}

function renameFolder(folderId: string, newName: string): void {
  folders.value = folders.value.map((f) => f.id === folderId ? { ...f, name: newName } : f)
  saveFolders()
}

function reorderFolders(newFolders: NotebookFolder[]): void {
  folders.value = newFolders
  saveFolders()
}

/**
 * 编辑器写入的落库闸门：按笔记 id 合并 + 防抖。
 *
 * 背景：编辑器此前每次按键都直接 `entityStore.update`，导致逐键写库；配合撤销栈上限 20，
 * 打字会把全局撤销历史冲掉。改为同一笔记在窗口内的多次变更只落最后一次。
 * 内容型写入带 skipUndo（见 NotebookEditor.emitUpdate 与 useNoteEditor），
 * 离散的元数据变更（改名/换文件夹）仍记撤销 —— 只要有一项需要记，整批就记。
 */
const COMMIT_DELAY = 400
const pendingWrites = new Map<string, { changes: Record<string, unknown>; skipUndo: boolean }>()
let commitTimer: ReturnType<typeof setTimeout> | null = null

function onNoteUpdate(data: { id: string; changes: Record<string, unknown>; skipUndo?: boolean }): void {
  const prev = pendingWrites.get(data.id)
  pendingWrites.set(data.id, {
    changes: data.changes,
    skipUndo: prev ? prev.skipUndo && !!data.skipUndo : !!data.skipUndo,
  })
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(flushPendingWrites, COMMIT_DELAY)
}

/** 立即落库所有待写入（切笔记、离开视图、删除笔记前调用，确保不丢改动） */
async function flushPendingWrites(): Promise<void> {
  if (commitTimer) {
    clearTimeout(commitTimer)
    commitTimer = null
  }
  if (pendingWrites.size === 0) return
  const batch = Array.from(pendingWrites.entries())
  pendingWrites.clear()
  for (const [id, item] of batch) {
    // 落库前与实体的最新状态合并：待写入只带「本组件负责的字段」，
    // 若直接全量写回会在防抖窗口内覆盖掉 useNoteEditor 刚写入的正文。
    const live = notebookNotes.value.find((n) => n.id === id)
    if (!live) continue  // 已被删除，丢弃
    const partial = (item.changes.properties ?? {}) as Record<string, unknown>
    try {
      await entityStore.update(id, {
        ...item.changes,
        properties: { ...live.properties, ...partial },
      }, 'user', { skipUndo: item.skipUndo })
    } catch (err) {
      console.warn('[NotebookView] 笔记落库失败', err)
    }
  }
}

watch(sidebarOpen, () => { saveSidebar() })

// 切笔记即落库，避免防抖窗口内的改动滞留到用户看不见的地方
watch(selectedNoteId, () => { flushPendingWrites() })

onMounted(async () => {
  await migrateBacklinks()
})

onBeforeUnmount(() => { flushPendingWrites() })

async function migrateBacklinks(): Promise<void> {
  const notesWithBacklinks = notebookNotes.value.filter((n) => {
    const bl = n.properties?.backlinks
    return Array.isArray(bl) && bl.length > 0
  })
  if (notesWithBacklinks.length === 0) return

  for (const note of notesWithBacklinks) {
    const targetIds: string[] = note.properties.backlinks || []
    const sourceIds: string[] = note.properties.forwardLinks || []
    for (const targetId of targetIds) {
      const exists = relationStore.relations.some(
        (r: Relation) => r.type === 'note_link' && r.sourceId === targetId && r.targetId === note.id
      )
      if (!exists) {
        await createBidirectional({ type: 'note_link', sourceId: targetId, targetId: note.id })
      }
    }
    for (const targetId of sourceIds) {
      const exists = relationStore.relations.some(
        (r: Relation) => r.type === 'note_link' && r.sourceId === note.id && r.targetId === targetId
      )
      if (!exists) {
        await createBidirectional({ type: 'note_link', sourceId: note.id, targetId })
      }
    }
    await entityStore.update(note.id, {
      properties: { ...note.properties, backlinks: [], forwardLinks: [] },
    }, 'user', { skipUndo: true })  // 一次性数据迁移，非用户操作，不进撤销栈
  }
}
// Agent→notebook 的 8 个数据动作原经 app 级全局桥（@/agent/agentDataBridges.ts，2026-09-14 架构拍板：
// 与视图挂载解耦、未挂载也必达）——该桥已于 2026-09-27 随旧 Agent 面退场删除；视图内无 UI 动作残留。
</script>

<style scoped>
.notebook-view { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-base); }
/* 工具栏 Teleport 到 R3 后：行内横排撑满控件区，去除自身背景/边框/内边距 */
.nb-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 0; border-bottom: none; background: transparent; min-width: 0; flex: 1 1 auto; }
.nb-toolbar-left { display: flex; gap: 4px; align-items: center; }
.nb-sidebar-toggle { padding: 4px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: transparent; color: var(--color-text-tertiary); font-size: var(--font-size-xs); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; display: flex; align-items: center; justify-content: center; }
.nb-sidebar-toggle:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); border-color: var(--color-text-secondary); }
.nb-toggle-icon { transition: transform 0.2s; display: inline-block; }
.nb-mode-btn { padding: 4px 12px; border-radius: var(--radius-xs); border: 1px solid transparent; background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.nb-mode-btn:hover { background: var(--color-bg-hover); }
.nb-mode-btn.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); border-color: var(--color-primary); }
.nb-toolbar-right { display: flex; gap: 6px; }
.nb-action-btn { padding: 4px 12px; border-radius: var(--radius-xs); border: 1px solid var(--color-primary); background: transparent; color: var(--color-primary); font-size: var(--font-size-sm); cursor: pointer; }
.nb-action-btn:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.nb-folder-btn { border-color: var(--color-text-tertiary); color: var(--color-text-tertiary); }
.nb-folder-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); }

.nb-content { display: flex; flex: 1; overflow: hidden; background: var(--color-bg-base); }

.nb-sidebar { width: 240px; min-width: 0; border-right: 1px solid var(--color-border-subtle); display: flex; flex-direction: column; transition: width 0.25s ease, min-width 0.25s ease, opacity 0.2s ease; overflow: hidden; background: var(--color-bg-surface); }
.nb-sidebar.collapsed { width: 0; min-width: 0; border-right: none; }
.nb-sidebar-inner { width: 240px; min-width: 240px; display: flex; flex-direction: column; height: 100%; }
/* 三期：笔记 / 文件双 tab 切换 */
.nb-side-tabs { display: flex; gap: 2px; padding: 8px 8px 0; flex-shrink: 0; }
.nb-side-tab {
  flex: 1; padding: 5px 0; border: 1px solid var(--color-border); background: transparent;
  color: var(--color-text-tertiary); font-size: var(--font-size-xs); cursor: pointer;
  border-radius: var(--radius-xs); font-weight: var(--font-weight-medium);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.nb-side-tab:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.nb-side-tab.on { background: var(--color-primary-muted); color: var(--color-primary); border-color: var(--color-primary); }
.nb-files-empty { padding: 24px 12px; text-align: center; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
/* 素材 tab 顶部操作条（孤儿清理按钮；不动 FileTreeBrowser 共享组件） */
.nb-assets-actions { display: flex; justify-content: flex-end; padding: 4px 8px 0; flex-shrink: 0; }
.nb-clean-btn { padding: 3px 10px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: transparent; color: var(--color-text-tertiary); font-size: var(--font-size-xs); cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.nb-clean-btn:hover:not(:disabled) { color: var(--color-danger); border-color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
.nb-clean-btn:disabled { opacity: 0.5; cursor: default; }
.nb-search { padding: 8px; }
.nb-search-input { width: 100%; padding: 6px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); outline: none; }
.nb-search-input:focus { border-color: var(--color-primary); }
.nb-note-list { flex: 1; overflow-y: auto; padding: 4px; }

.nb-folder-input-wrap { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--color-border-subtle); align-items: center; }
.nb-folder-input { flex: 1; padding: 4px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-primary); background: var(--color-bg-base); color: var(--color-text-primary); font-size: var(--font-size-sm); outline: none; }
.nb-fi-ok, .nb-fi-cancel { padding: 2px 8px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.nb-fi-ok:hover { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); border-color: var(--color-success); }
.nb-fi-cancel:hover { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger); border-color: var(--color-danger); }

.nb-main { flex: 1; overflow: auto; background: var(--color-bg-base); }
/* 空态（批 4 V7 走查修正）：只留 WsEmpty 引导语，不留操作按钮 */

/* 素材预览浮层（Teleport body，z 走全局令牌） */
.nb-file-preview-overlay {
  position: fixed; inset: 0; background: var(--color-overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: var(--z-modal);
}
.nb-file-preview-panel {
  position: relative;
  width: min(860px, 92vw); height: min(640px, 88vh);
  background: var(--color-bg-surface);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.nb-file-preview-panel :deep(.fpv) { height: 100%; }
.nb-file-preview-close {
  position: absolute; top: 10px; right: 10px; z-index: 1;
  width: 26px; height: 26px; padding: 0; border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs); background: var(--color-bg-surface); color: var(--color-text-tertiary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.nb-file-preview-close:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); }
</style>
