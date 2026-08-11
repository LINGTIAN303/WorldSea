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
          <div class="nb-search">
            <input v-model="searchQuery" class="nb-search-input" placeholder="搜索笔记..." />
          </div>
          <div class="nb-note-list">
            <FolderTree
              :folders="folders"
              :selectedNoteId="selectedNoteId"
              :collapsedFolders="collapsedFolders"
              :unfiledNotes="unfiledNotes"
              :allNotes="filteredNotes"
              :searchResults="filteredNotes"
              :searchMode="!!searchQuery"
              :pendingDeleteId="pendingDeleteFolderId"
              :folderToRename="folderToRename"
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
            />
          </div>
        </div>
        
      </div>

      <div class="nb-main">
        <NotebookEditor
          v-if="currentMode === 'editor' && currentNote"
          :note="currentNote"
          :folders="folders"
          @update="onNoteUpdate"
          @navigate="selectedNoteId = $event"
        />
        <NotebookBoard
          v-else-if="currentMode === 'board'"
          :notes="filteredNotes"
          @select="selectedNoteId = $event"
        />
        <NotebookGraph
          v-else-if="currentMode === 'graph'"
          :notes="filteredNotes"
          @select="selectedNoteId = $event"
        />
        <div v-else class="nb-empty">选择或创建一个笔记开始</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted } from 'vue'
import { useEntityStore, useRelationStore, useBidirectional } from '@worldsmith/entity-core'
import type { Relation } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'
import NotebookEditor from './components/NotebookEditor.vue'
import NotebookBoard from './components/NotebookBoard.vue'
import NotebookGraph from './components/NotebookGraph.vue'
import FolderTree from './components/FolderTree.vue'
import { VIEW_MODES } from './notebookConfig'
import type { ViewMode } from './notebookConfig'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'
import type { NotebookEntity } from './types'

interface NotebookFolder {
  id: string
  name: string
}

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { createBidirectional } = useBidirectional()
const currentMode = ref<ViewMode>('editor')
const searchQuery = ref('')
const selectedNoteId = ref<string | null>(null)
const collapsedFolders = reactive(new Set<string>())
const sidebarOpen = ref(true)
const folderToRename = ref<string | null>(null)
const pendingDeleteFolderId = ref<string | null>(null)

const STORAGE_KEY_FOLDERS = 'worldsmith-notebook-folders'
const STORAGE_KEY_COLLAPSED = 'worldsmith-notebook-collapsed'
const STORAGE_KEY_SIDEBAR = 'worldsmith-notebook-sidebar'

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

const filteredNotes = computed(() => {
  if (!searchQuery.value) return notebookNotes.value
  const q = searchQuery.value.toLowerCase()
  return notebookNotes.value.filter((n) =>
    n.name.toLowerCase().includes(q) ||
    (n.description || '').toLowerCase().includes(q)
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

function deleteFolder(folderId: string): void {
  if (pendingDeleteFolderId.value === folderId) {
    const folder = folders.value.find(f => f.id === folderId)
    if (folder) {
      for (const note of getFolderNotes(folderId)) {
        entityStore.update(note.id, { properties: { ...note.properties, folderId: '' } })
      }
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
  await entityStore.remove(noteId)
  if (selectedNoteId.value === noteId) selectedNoteId.value = null
}

function reorderNotes(_folderId: string, noteIds: string[]): void {
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
}

function renameFolder(folderId: string, newName: string): void {
  folders.value = folders.value.map((f) => f.id === folderId ? { ...f, name: newName } : f)
  saveFolders()
}

function reorderFolders(newFolders: NotebookFolder[]): void {
  folders.value = newFolders
  saveFolders()
}

async function onNoteUpdate(data: { id: string; changes: Record<string, unknown> }): Promise<void> {
  await entityStore.update(data.id, data.changes)
}

watch(sidebarOpen, () => { saveSidebar() })

onMounted(async () => {
  await migrateBacklinks()
})

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
    })
  }
}

useAgentPluginBridge('notebook', async (event) => {
  const { action, payload } = event
  console.log(`[Agent→notebook] ${action}`, payload)

  switch (action) {
    case 'create_note': {
      const targetFolder = (payload.folderId as string) || (folders.value.length > 0 ? folders.value[0].id : '')
      const id = await entityStore.add({
        id: crypto.randomUUID(),
        type: 'notebook',
        name: (payload.name as string) || (payload.content as string)?.slice(0, 30) || 'AI 创建的笔记',
        description: '',
        properties: {
          content: (payload.content as string) || '',
          noteType: (payload.noteType as string) || 'markdown',
          tags: (payload.tags as string[]) || [],
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
      break
    }

    case 'update_note': {
      const noteId = payload.noteId as string
      if (!noteId) break
      const note = notebookNotes.value.find((n) => n.id === noteId)
      if (!note) break
      const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() }
      if (payload.content !== undefined) {
        changes.properties = { ...note.properties, content: payload.content }
      }
      if (payload.tags !== undefined) {
        const props = (changes.properties as Record<string, unknown>) || { ...note.properties }
        props.tags = payload.tags
        changes.properties = props
      }
      await entityStore.update(noteId, changes)
      break
    }

    case 'delete_note': {
      const noteId = payload.noteId as string
      if (!noteId) break
      await entityStore.remove(noteId)
      if (selectedNoteId.value === noteId) selectedNoteId.value = null
      break
    }

    case 'list_notes': {
      let results = notebookNotes.value
      const folderId = payload.folderId as string | undefined
      const keyword = payload.keyword as string | undefined
      if (folderId) {
        results = results.filter((n) => n.properties?.folderId === folderId)
      }
      if (keyword) {
        const q = keyword.toLowerCase()
        results = results.filter((n) =>
          n.name.toLowerCase().includes(q) ||
          (n.properties?.content || '').toLowerCase().includes(q)
        )
      }
      const summary = results.map((n) => ({ id: n.id, name: n.name, type: n.properties?.noteType }))
      ;window.__worldsmith_notebook_list__ = summary
      break
    }

    case 'search_notes': {
      const keyword = (payload.keyword as string) || ''
      const q = keyword.toLowerCase()
      const results = notebookNotes.value.filter((n) =>
        n.name.toLowerCase().includes(q) ||
        (n.description || '').toLowerCase().includes(q) ||
        (n.properties?.content || '').toLowerCase().includes(q)
      )
      const summary = results.map((n) => ({ id: n.id, name: n.name, preview: (n.properties?.content || '').slice(0, 100) }))
      ;window.__worldsmith_notebook_search__ = summary
      break
    }

    case 'execute_code': {
      const noteId = payload.noteId as string
      const code = payload.code as string
      if (noteId && code) {
        const note = notebookNotes.value.find((n) => n.id === noteId)
        if (note) {
          try {
        const iframe = document.createElement('iframe')
            iframe.style.display = 'none'
            iframe.sandbox.add('allow-scripts')
            const escapedCode = code.replace(/<\/script>/gi, '<\\/script>')
            const srcdoc = `<!DOCTYPE html><html><head><script>
              const __logs = [];
              const console = { log: (...a) => __logs.push(a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')), error: (...a) => __logs.push('ERROR: ' + a.map(String).join(' ')) };
              try { ${escapedCode} } catch(e) { __logs.push('ERROR: ' + (e.message || String(e))); }
              parent.postMessage({ type: 'code-output', logs: __logs }, '*');
            <\/script></head><body></body></html>`
            iframe.srcdoc = srcdoc
            document.body.appendChild(iframe)
            const output = await new Promise<string>((resolve) => {
              const timer = setTimeout(() => { iframe.remove(); resolve('执行超时（5秒限制）') }, 5000)
              function onMsg(e: MessageEvent) {
                if (e.data?.type === 'code-output' && e.source === iframe.contentWindow) {
                  clearTimeout(timer)
                  window.removeEventListener('message', onMsg)
                  iframe.remove()
                  const l = e.data.logs || []
                  resolve(l.length > 0 ? l.join('\n') : '(无输出)')
                }
              }
              window.addEventListener('message', onMsg)
            })
            await entityStore.update(noteId, { properties: { ...note.properties, codeOutput: output } })
          } catch (err: any) {
            await entityStore.update(noteId, { properties: { ...note.properties, codeOutput: 'ERROR: ' + (err?.message || String(err)) } })
          }
        }
      }
      break
    }

    case 'create_backlink': {
      const { sourceId, targetId } = payload as { sourceId: string; targetId: string }
      if (!sourceId || !targetId) break
      const source = notebookNotes.value.find((n) => n.id === sourceId)
      const target = notebookNotes.value.find((n) => n.id === targetId)
      if (source && target) {
        await createBidirectional({ type: 'note_link', sourceId, targetId })
      }
      break
    }

    case 'export_note': {
      const noteId = payload.noteId as string
      const format = (payload.format as string) || 'markdown'
      const note = notebookNotes.value.find((n) => n.id === noteId)
      if (!note) break
      const content = note.properties?.content || ''
      const filename = `${note.name}.${format === 'html' ? 'html' : 'md'}`
      const mimeType = format === 'html' ? 'text/html' : 'text/markdown'
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      break
    }

    default:
      console.warn(`[Agent→notebook] unknown action: ${action}`, payload)
  }
})
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
.nb-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-tertiary); font-size: var(--font-size-base); }
</style>
