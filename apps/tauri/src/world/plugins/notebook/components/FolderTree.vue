<template>
  <div class="folder-tree" @contextmenu.prevent="openContextMenu($event, 'empty')">
    <template v-if="searchMode">
      <NoteTreeItem
        v-for="note in searchResults"
        :key="note.id"
        :note="note"
        :active="selectedNoteId === note.id"
        :search-query="searchQuery"
        @select="$emit('selectNote', $event)"
        @menu="openContextMenu($event, 'note', note)"
      />
      <div v-if="searchResults.length === 0" class="ft-empty">无匹配笔记</div>
    </template>
    <template v-else>
      <!-- 置顶组（批 3 I9）：仅当有置顶笔记时渲染；只读列表（点击打开，右键可取消置顶） -->
      <div v-if="props.pinnedNotes.length > 0" class="ft-folder-group">
        <div class="ft-folder-header" role="button" tabindex="0" @click.stop>
          <span class="ft-folder-icon"><WsIcon name="star" size="xs" /></span>
          <span class="ft-folder-name">置顶</span>
          <span class="ft-folder-count">{{ props.pinnedNotes.length }}</span>
        </div>
        <div class="ft-folder-items ft-folder-items--flat">
          <NoteTreeItem
            v-for="note in props.pinnedNotes"
            :key="`pin_${note.id}`"
            :note="note"
            :active="selectedNoteId === note.id"
            @select="$emit('selectNote', $event)"
            @menu="openContextMenu($event, 'note', note)"
          />
        </div>
      </div>

      <div :class="['ft-folder-group', { collapsed: collapsedFolders.has('') }]">
        <div
          class="ft-folder-header" role="button" tabindex="0"
          @click="$emit('toggleFolder', '')" @keydown.enter="$emit('toggleFolder', '')"
          @contextmenu.stop="openContextMenu($event, 'unfiled')"
        >
          <span class="ft-folder-arrow"><WsIcon :name="collapsedFolders.has('') ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
          <span class="ft-folder-icon"><WsIcon name="outline" size="xs" /></span>
          <span class="ft-folder-name">未分类</span>
          <span class="ft-folder-count">{{ unfiledList.length }}</span>
        </div>
        <div class="ft-folder-items ft-folder-items--guide">
          <draggable :list="unfiledList" item-key="id" group="notebook-notes" ghost-class="ft-note-ghost" @change="onNoteChange($event, '__unfiled__')">
            <template #item="{ element }">
              <NoteTreeItem
                :note="element"
                :active="selectedNoteId === element.id"
                @select="$emit('selectNote', $event)"
                @menu="openContextMenu($event, 'note', element)"
              />
            </template>
          </draggable>
        </div>
      </div>

      <draggable :list="folderList" item-key="id" handle=".ft-folder-drag" ghost-class="ft-folder-ghost" @change="onFolderReorder">
        <template #item="{ element: folder }">
          <div :class="['ft-folder-group', { collapsed: collapsedFolders.has(folder.id) }]">
            <div
              class="ft-folder-header"
              role="button"
              tabindex="0"
              :aria-expanded="!collapsedFolders.has(folder.id)"
              @click="onFolderHeaderClick($event, folder.id)"
              @keydown.enter.prevent="onFolderHeaderKeydown(folder.id)"
              @keydown.space.prevent="onFolderHeaderKeydown(folder.id)"
              @contextmenu.stop="openContextMenu($event, 'folder', folder)"
            >
              <span class="ft-folder-drag" title="拖拽排序"><WsIcon name="grip" size="xs" /></span>
              <span class="ft-folder-arrow"><WsIcon :name="collapsedFolders.has(folder.id) ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
              <span class="ft-folder-icon"><WsIcon name="folder" size="xs" /></span>
              <span v-if="renamingFolderId !== folder.id" class="ft-folder-name" @dblclick.prevent="startRename(folder)">{{ folder.name }}</span>
              <input
                v-else
                ref="renameInputRef"
                v-model="renameValue"
                class="ft-rename-input"
                @blur="confirmRename(folder.id)"
                @keydown.enter="confirmRename(folder.id)"
                @keydown.escape="cancelRename"
                @click.stop
              />
              <span class="ft-folder-count">{{ getNoteList(folder.id).length }}</span>
              <button
                :class="['ft-folder-del', { confirming: pendingDeleteId === folder.id }]"
                @click.stop="$emit('deleteFolder', folder.id)"
                :title="pendingDeleteId === folder.id ? '再次点击确认删除' : '删除文件夹'"
              >{{ pendingDeleteId === folder.id ? '确认?' : '×' }}</button>
            </div>
            <div class="ft-folder-items ft-folder-items--guide">
              <draggable :list="getNoteList(folder.id)" item-key="id" group="notebook-notes" ghost-class="ft-note-ghost" @change="onNoteChange($event, folder.id)">
                <template #item="{ element }">
                  <NoteTreeItem
                    :note="element"
                    :active="selectedNoteId === element.id"
                    @select="$emit('selectNote', $event)"
                    @menu="openContextMenu($event, 'note', element)"
                  />
                </template>
              </draggable>
            </div>
          </div>
        </template>
      </draggable>

      <!-- 最近打开（批 3 I9）：非搜索且存在记录时渲染；只读列表 -->
      <div v-if="props.recentNotes.length > 0" class="ft-folder-group">
        <div class="ft-folder-header" role="button" tabindex="0" @click.stop>
          <span class="ft-folder-icon"><WsIcon name="clock" size="xs" /></span>
          <span class="ft-folder-name">最近</span>
          <span class="ft-folder-count">{{ props.recentNotes.length }}</span>
        </div>
        <div class="ft-folder-items ft-folder-items--flat">
          <NoteTreeItem
            v-for="note in props.recentNotes"
            :key="`recent_${note.id}`"
            :note="note"
            :active="selectedNoteId === note.id"
            @select="$emit('selectNote', $event)"
            @menu="openContextMenu($event, 'note', note)"
          />
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="ctxMenu.show" class="ft-cm-backdrop" @click="closeContextMenu"></div>
      <div
        v-if="ctxMenu.show"
        class="ft-context-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <template v-if="ctxMenu.type === 'folder'">
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="新建笔记" @click="ctxAction('create-note')" @keydown.enter.prevent="ctxAction('create-note')" @keydown.space.prevent="ctxAction('create-note')">新建笔记</div>
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="重命名" @click="ctxAction('rename')" @keydown.enter.prevent="ctxAction('rename')" @keydown.space.prevent="ctxAction('rename')">重命名</div>
          <div class="ft-cm-sep"></div>
          <div class="ft-cm-item ft-cm-danger" role="button" tabindex="0" aria-label="删除" @click="ctxAction('delete-folder')" @keydown.enter.prevent="ctxAction('delete-folder')" @keydown.space.prevent="ctxAction('delete-folder')">删除</div>
        </template>
        <template v-else-if="ctxMenu.type === 'note'">
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="置顶" @click="ctxAction('toggle-pin')" @keydown.enter.prevent="ctxAction('toggle-pin')" @keydown.space.prevent="ctxAction('toggle-pin')">{{ ctxMenu.note?.properties?.pinned ? '取消置顶' : '置顶' }}</div>
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="复制笔记" @click="ctxAction('duplicate-note')" @keydown.enter.prevent="ctxAction('duplicate-note')" @keydown.space.prevent="ctxAction('duplicate-note')">复制笔记</div>
          <div class="ft-cm-sep"></div>
          <div class="ft-cm-item ft-cm-danger" role="button" tabindex="0" aria-label="删除笔记" @click="ctxAction('delete-note')" @keydown.enter.prevent="ctxAction('delete-note')" @keydown.space.prevent="ctxAction('delete-note')">删除笔记</div>
        </template>
        <template v-else-if="ctxMenu.type === 'unfiled'">
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="新建笔记" @click="ctxAction('create-note')" @keydown.enter.prevent="ctxAction('create-note')" @keydown.space.prevent="ctxAction('create-note')">新建笔记</div>
        </template>
        <template v-else-if="ctxMenu.type === 'empty'">
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="新建笔记" @click="ctxAction('create-note')" @keydown.enter.prevent="ctxAction('create-note')" @keydown.space.prevent="ctxAction('create-note')">新建笔记</div>
          <div class="ft-cm-item" role="button" tabindex="0" aria-label="新建文件夹" @click="ctxAction('create-folder')" @keydown.enter.prevent="ctxAction('create-folder')" @keydown.space.prevent="ctxAction('create-folder')">新建文件夹</div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, reactive, nextTick, onMounted, onUnmounted } from 'vue'
import draggable from 'vuedraggable'
import { WsIcon } from '@worldsea/ui-kit'
import NoteTreeItem from './NoteTreeItem.vue'
import type { NotebookEntity } from '../types'

interface NotebookFolder {
  id: string
  name: string
}

interface CtxMenuState {
  show: boolean
  x: number
  y: number
  type: 'folder' | 'note' | 'unfiled' | 'empty'
  folder?: NotebookFolder
  note?: NotebookEntity
}

const props = defineProps<{
  folders: NotebookFolder[]
  selectedNoteId: string | null
  collapsedFolders: Set<string>
  unfiledNotes: NotebookEntity[]
  allNotes: NotebookEntity[]
  searchResults: NotebookEntity[]
  searchMode: boolean
  pendingDeleteId: string | null
  folderToRename: string | null
  /** 批 3 I9：置顶笔记（非搜索模式时置顶组渲染于未分类之前） */
  pinnedNotes: NotebookEntity[]
  /** 批 3 I9：最近打开（置顶组之后） */
  recentNotes: NotebookEntity[]
  /** 批 3 F1：搜索词（条目摘要高亮用） */
  searchQuery: string
}>()

const emit = defineEmits<{
  selectNote: [id: string]
  toggleFolder: [id: string]
  deleteFolder: [id: string]
  moveNote: [noteId: string, toFolderId: string]
  renameFolder: [folderId: string, newName: string]
  reorderFolders: [folders: NotebookFolder[]]
  createNote: [folderId: string]
  createFolder: []
  duplicateNote: [noteId: string]
  deleteNote: [noteId: string]
  reorderNotes: [folderId: string, noteIds: string[]]
  renameMode: []
  togglePin: [noteId: string]
}>()

function sortByOrder(a: NotebookEntity, b: NotebookEntity): number {
  return (a.properties?.sortOrder || '0').localeCompare(b.properties?.sortOrder || '0', undefined, { numeric: true })
}

function filterByFolder(notes: NotebookEntity[], folderId: string): NotebookEntity[] {
  return notes.filter(n => (n.properties?.folderId || '') === folderId).sort(sortByOrder)
}

const folderList = ref<NotebookFolder[]>([...props.folders])
watch(() => props.folders, (f) => { folderList.value = [...f] }, { deep: true })

const unfiledList = ref<NotebookEntity[]>([...props.unfiledNotes])
watch(() => props.unfiledNotes, (notes) => { unfiledList.value = [...notes] }, { deep: true })

// 注：此前这里另有一个 watch(entityStore.entities) 直接读 store 重建 unfiledList / noteLists，
// 与下方 syncNoteLists（由 props.allNotes 驱动）职责完全重复 —— 已移除。
// 本组件只从 props 单向接收数据，不再直连 store（顺带消除「props 全集 vs 直读 store」两套来源）。
const noteLists = reactive<Record<string, NotebookEntity[]>>({})

function syncNoteLists() {
  for (const f of props.folders) {
    const filtered = filterByFolder(props.allNotes, f.id)
    if (!noteLists[f.id]) {
      noteLists[f.id] = reactive([...filtered])
    } else {
      noteLists[f.id].splice(0, noteLists[f.id].length, ...filtered)
    }
  }
  for (const id of Object.keys(noteLists)) {
    if (!props.folders.some(f => f.id === id)) {
      delete noteLists[id]
    }
  }
}

watch(() => [props.folders, props.allNotes] as const, () => {
  syncNoteLists()
}, { immediate: true, deep: false })

function getNoteList(folderId: string): NotebookEntity[] {
  return noteLists[folderId] || []
}

function onNoteChange(ev: any, folderId: string) {
  if (ev.added) {
    const note = ev.added.element as NotebookEntity
    if (note) emit('moveNote', note.id, folderId)
  }
  if (ev.moved) {
    const list = folderId === '__unfiled__' ? unfiledList.value : noteLists[folderId]
    if (list) {
      const ids = list.map(n => n.id)
      emit('reorderNotes', folderId, ids)
    }
  }
}

function onFolderReorder(ev: any) {
  if (ev.moved) {
    emit('reorderFolders', folderList.value)
  }
}

watch(() => props.folderToRename, (newVal) => {
  if (newVal) {
    const folder = props.folders.find(f => f.id === newVal)
    if (folder) {
      startRename(folder)
      emit('renameMode')
    }
  }
})

const renamingFolderId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename(folder: NotebookFolder) {
  renamingFolderId.value = folder.id
  renameValue.value = folder.name
  nextTick(() => renameInputRef.value?.focus())
}

function confirmRename(folderId: string) {
  const name = renameValue.value.trim()
  if (name && renamingFolderId.value === folderId) {
    emit('renameFolder', folderId, name)
  }
  renamingFolderId.value = null
  renameValue.value = ''
}

function cancelRename() {
  renamingFolderId.value = null
  renameValue.value = ''
}

function onFolderHeaderClick(ev: MouseEvent, folderId: string) {
  if (renamingFolderId.value === folderId) return
  const target = ev.target as HTMLElement
  if (target.closest('.ft-folder-drag') || target.closest('.ft-folder-del')) return
  emit('toggleFolder', folderId)
}

function onFolderHeaderKeydown(folderId: string) {
  if (renamingFolderId.value === folderId) return
  emit('toggleFolder', folderId)
}

const ctxMenu = reactive<CtxMenuState>({
  show: false, x: 0, y: 0, type: 'empty'
})

function openContextMenu(ev: MouseEvent, type: CtxMenuState['type'], data?: NotebookFolder | NotebookEntity) {
  ev.preventDefault()
  ctxMenu.show = true
  ctxMenu.x = ev.clientX
  ctxMenu.y = ev.clientY
  ctxMenu.type = type
  ctxMenu.folder = undefined
  ctxMenu.note = undefined
  if (type === 'folder') ctxMenu.folder = data as NotebookFolder
  if (type === 'note') ctxMenu.note = data as NotebookEntity
}

function closeContextMenu() {
  ctxMenu.show = false
}

function ctxAction(action: string) {
  closeContextMenu()
  switch (action) {
    case 'create-note':
      emit('createNote', ctxMenu.folder?.id ?? '')
      break
    case 'rename':
      if (ctxMenu.folder) startRename(ctxMenu.folder)
      break
    case 'delete-folder':
      if (ctxMenu.folder) emit('deleteFolder', ctxMenu.folder.id)
      break
    case 'duplicate-note':
      if (ctxMenu.note) emit('duplicateNote', ctxMenu.note.id)
      break
    case 'delete-note':
      if (ctxMenu.note) emit('deleteNote', ctxMenu.note.id)
      break
    case 'toggle-pin':
      if (ctxMenu.note) emit('togglePin', ctxMenu.note.id)
      break
    case 'create-folder':
      emit('createFolder')
      break
  }
}

// 搜索命中摘要 snippetOf/escapeRegExp 已迁至 NoteTreeItem.vue（批 4 V5 条目组件化）

function onKeyDown(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && ctxMenu.show) closeContextMenu()
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.folder-tree { padding: 4px 0; }
.ft-folder-group { margin-bottom: 2px; }
.ft-folder-header {
  display: flex; align-items: center; gap: 4px; padding: 5px 6px; border-radius: var(--radius-xs);
  cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-secondary);
  transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; user-select: none;
}
.ft-folder-header:hover { background: var(--sf-panel-bg-muted); }
.ft-folder-drag {
  cursor: grab; color: var(--color-text-tertiary); font-size: var(--font-size-xs);
  opacity: 0; transition: opacity 0.1s; display: flex; align-items: center; line-height: 1;
}
.ft-folder-header:hover .ft-folder-drag { opacity: 0.6; }
.ft-folder-drag:hover { opacity: 1 !important; }
.ft-folder-arrow { font-size: var(--text-micro-font-size); width: 12px; text-align: center; color: var(--color-text-tertiary); }
.ft-folder-icon { font-size: var(--font-size-sm); }
.ft-folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-medium); }
.ft-folder-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); min-width: 16px; text-align: right; }
.ft-folder-del {
  display: none; font-size: var(--font-size-sm); padding: 0 4px; border: none;
  background: transparent; color: var(--color-text-tertiary); cursor: pointer; line-height: 1;
}
.ft-folder-header:hover .ft-folder-del { display: inline-block; }
.ft-folder-del:hover { color: var(--color-danger); }
.ft-folder-del.confirming {
  display: inline-block; color: var(--color-danger); font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold); animation: pulse var(--dur-pulse) infinite;
}
.ft-folder-items { overflow: hidden; transition: max-height 0.2s ease; }
/* 层级导引线（批 4 V5）：文件夹/未分类组的子项列表左侧竖线；置顶/最近组仅缩进对齐无线 */
.ft-folder-items--guide { margin-left: 15px; border-left: 1px solid var(--color-border-subtle); }
.ft-folder-items--flat { margin-left: 15px; }
.ft-folder-group.collapsed .ft-folder-items { max-height: 0; }
.ft-folder-group:not(.collapsed) .ft-folder-items { max-height: 2000px; }

/* 条目本体样式已迁至 NoteTreeItem.vue（批 4 V5 条目组件化） */

.ft-rename-input {
  flex: 1; min-width: 0; padding: 1px 4px; font-size: var(--font-size-sm);
  border: 1px solid var(--color-primary); border-radius: var(--radius-2xs);
  background: var(--color-bg-base); color: var(--color-text-primary); outline: none;
}
/* ghost 类作用于 NoteTreeItem 根元素（子组件 scope），须 :deep 穿透才命中 */
:deep(.ft-note-ghost) { opacity: 0.3; }
.ft-folder-ghost { opacity: 0.3; border: 1px dashed var(--color-primary); border-radius: var(--radius-sm); }
.ft-empty { padding: 12px; text-align: center; font-size: var(--font-size-sm); color: var(--color-text-tertiary); }

.ft-cm-backdrop {
  position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; /* 透明捕获层让位窗口栏（拍板 2026-10-24） */ z-index: calc(var(--z-modal) - 1); background: transparent;
}
.ft-context-menu {
  position: fixed; z-index: var(--z-modal); min-width: 150px;
  background: var(--sf-overlay-bg); border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale)); padding: 4px; box-shadow: var(--sf-overlay-shadow);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  backdrop-filter: var(--sf-overlay-filter, none);
}
.ft-cm-item {
  padding: 6px 12px; font-size: var(--font-size-sm); border-radius: var(--radius-xs);
  cursor: pointer; color: var(--color-text-primary); user-select: none;
}
.ft-cm-item:hover { background: var(--sf-panel-bg-muted); }
.ft-cm-item.ft-cm-danger { color: var(--color-danger); }
.ft-cm-item.ft-cm-danger:hover { background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.ft-cm-sep { height: 1px; background: var(--color-border-subtle); margin: 3px 6px; }
</style>
