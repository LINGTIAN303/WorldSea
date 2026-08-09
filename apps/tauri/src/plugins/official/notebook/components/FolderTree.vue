<template>
  <div class="folder-tree" @contextmenu.prevent="openContextMenu($event, 'empty')">
    <template v-if="searchMode">
      <div
        v-for="note in searchResults"
        :key="note.id"
        class="ft-note-item"
        :class="{ active: selectedNoteId === note.id }"
        role="button"
        tabindex="0"
        :aria-current="selectedNoteId === note.id ? 'true' : undefined"
        :aria-label="`打开笔记 ${note.name}`"
        @click="$emit('selectNote', note.id)"
        @keydown.enter.prevent="$emit('selectNote', note.id)"
        @keydown.space.prevent="$emit('selectNote', note.id)"
        @contextmenu.stop="openContextMenu($event, 'note', note)"
      >
        <span class="ft-note-icon"><WsIcon :name="getNoteIcon(note)" size="xs" /></span>
        <span class="ft-note-name">{{ note.name }}</span>
      </div>
      <div v-if="searchResults.length === 0" class="ft-empty">无匹配笔记</div>
    </template>
    <template v-else>
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
        <div class="ft-folder-items">
          <draggable :list="unfiledList" item-key="id" group="notebook-notes" ghost-class="ft-note-ghost" @change="onNoteChange($event, '__unfiled__')">
            <template #item="{ element }">
              <div
                class="ft-note-item"
                :class="{ active: selectedNoteId === element.id }"
                role="button"
                tabindex="0"
                :aria-current="selectedNoteId === element.id ? 'true' : undefined"
                :aria-label="`打开笔记 ${element.name}`"
                @click="$emit('selectNote', element.id)"
                @keydown.enter.prevent="$emit('selectNote', element.id)"
                @keydown.space.prevent="$emit('selectNote', element.id)"
                @contextmenu.stop="openContextMenu($event, 'note', element)"
              >
                <span class="ft-note-icon"><WsIcon :name="getNoteIcon(element)" size="xs" /></span>
                <span class="ft-note-name">{{ element.name }}</span>
              </div>
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
            <div class="ft-folder-items">
              <draggable :list="getNoteList(folder.id)" item-key="id" group="notebook-notes" ghost-class="ft-note-ghost" @change="onNoteChange($event, folder.id)">
                <template #item="{ element }">
                  <div
                    class="ft-note-item"
                    :class="{ active: selectedNoteId === element.id }"
                    role="button"
                    tabindex="0"
                    :aria-current="selectedNoteId === element.id ? 'true' : undefined"
                    :aria-label="`打开笔记 ${element.name}`"
                    @click="$emit('selectNote', element.id)"
                    @keydown.enter.prevent="$emit('selectNote', element.id)"
                    @keydown.space.prevent="$emit('selectNote', element.id)"
                    @contextmenu.stop="openContextMenu($event, 'note', element)"
                  >
                    <span class="ft-note-icon"><WsIcon :name="getNoteIcon(element)" size="xs" /></span>
                    <span class="ft-note-name">{{ element.name }}</span>
                  </div>
                </template>
              </draggable>
            </div>
          </div>
        </template>
      </draggable>
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
          <div class="ft-cm-item" @click="ctxAction('create-note')">新建笔记</div>
          <div class="ft-cm-item" @click="ctxAction('rename')">重命名</div>
          <div class="ft-cm-sep"></div>
          <div class="ft-cm-item ft-cm-danger" @click="ctxAction('delete-folder')">删除</div>
        </template>
        <template v-else-if="ctxMenu.type === 'note'">
          <div class="ft-cm-item" @click="ctxAction('duplicate-note')">复制笔记</div>
          <div class="ft-cm-sep"></div>
          <div class="ft-cm-item ft-cm-danger" @click="ctxAction('delete-note')">删除笔记</div>
        </template>
        <template v-else-if="ctxMenu.type === 'unfiled'">
          <div class="ft-cm-item" @click="ctxAction('create-note')">新建笔记</div>
        </template>
        <template v-else-if="ctxMenu.type === 'empty'">
          <div class="ft-cm-item" @click="ctxAction('create-note')">新建笔记</div>
          <div class="ft-cm-item" @click="ctxAction('create-folder')">新建文件夹</div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, reactive, nextTick, onMounted, onUnmounted } from 'vue'
import draggable from 'vuedraggable'
import { useEntityStore } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'
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
}>()

function getNoteIcon(note: NotebookEntity): string {
  const noteType = note.properties?.noteType || 'markdown'
  const iconMap: Record<string, string> = {
    markdown: 'edit',
    code: 'keyboard',
    canvas: 'palette',
    reference: 'manuscript',
  }
  return iconMap[noteType] || 'edit'
}

function sortByOrder(a: NotebookEntity, b: NotebookEntity): number {
  return (a.properties?.sortOrder || '0').localeCompare(b.properties?.sortOrder || '0', undefined, { numeric: true })
}

function filterByFolder(notes: NotebookEntity[], folderId: string): NotebookEntity[] {
  return notes.filter(n => (n.properties?.folderId || '') === folderId).sort(sortByOrder)
}

const folderList = ref<NotebookFolder[]>([...props.folders])
watch(() => props.folders, (f) => { folderList.value = [...f] }, { deep: true })

const entityStore = useEntityStore()
const unfiledList = ref<NotebookEntity[]>([...props.unfiledNotes])
watch(() => props.unfiledNotes, (notes) => { unfiledList.value = [...notes] }, { deep: true })
watch(() => entityStore.entities, () => {
  const allNotes = entityStore.entities.filter((e): e is NotebookEntity => e.type === 'notebook')
  unfiledList.value = [...allNotes.filter(n => {
    const fid = n.properties?.folderId
    return !fid || !props.folders.some(f => f.id === fid)
  }).sort(sortByOrder)]
  for (const f of props.folders) {
    const filtered = allNotes.filter(n => (n.properties?.folderId || '') === f.id).sort(sortByOrder)
    if (!noteLists[f.id]) {
      noteLists[f.id] = reactive([...filtered])
    } else {
      noteLists[f.id].splice(0, noteLists[f.id].length, ...filtered)
    }
  }
  for (const id of Object.keys(noteLists)) {
    if (!props.folders.some(f => f.id === id)) delete noteLists[id]
  }
}, { deep: true })

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
    case 'create-folder':
      emit('createFolder')
      break
  }
}

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
.ft-folder-header:hover { background: var(--color-bg-hover); }
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
  font-weight: var(--font-weight-semibold); animation: ws-pulse 1s infinite;
}
.ft-folder-items { overflow: hidden; transition: max-height 0.2s ease; }
.ft-folder-group.collapsed .ft-folder-items { max-height: 0; }
.ft-folder-group:not(.collapsed) .ft-folder-items { max-height: 2000px; }

.ft-note-item {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 28px;
  border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-sm);
  color: var(--color-text-secondary); transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s;
}
.ft-note-item:hover { background: var(--color-bg-hover); }
.ft-note-item.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.ft-note-icon { font-size: var(--font-size-base); }
.ft-note-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ft-rename-input {
  flex: 1; min-width: 0; padding: 1px 4px; font-size: var(--font-size-sm);
  border: 1px solid var(--color-primary); border-radius: var(--radius-2xs);
  background: var(--color-bg-base); color: var(--color-text-primary); outline: none;
}
.ft-note-ghost { opacity: 0.3; }
.ft-folder-ghost { opacity: 0.3; border: 1px dashed var(--color-primary); border-radius: var(--radius-sm); }
.ft-empty { padding: 12px; text-align: center; font-size: var(--font-size-sm); color: var(--color-text-tertiary); }

.ft-cm-backdrop {
  position: fixed; inset: 0; z-index: 999; background: transparent;
}
.ft-context-menu {
  position: fixed; z-index: 1000; min-width: 150px;
  background: var(--color-bg-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); padding: 4px; box-shadow: var(--shadow-md);
}
.ft-cm-item {
  padding: 6px 12px; font-size: var(--font-size-sm); border-radius: var(--radius-xs);
  cursor: pointer; color: var(--color-text-primary); user-select: none;
}
.ft-cm-item:hover { background: var(--color-bg-hover); }
.ft-cm-item.ft-cm-danger { color: var(--color-danger); }
.ft-cm-item.ft-cm-danger:hover { background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.ft-cm-sep { height: 1px; background: var(--color-border-subtle); margin: 3px 6px; }
</style>
