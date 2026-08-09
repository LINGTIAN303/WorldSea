<template>
  <div class="manuscript-view">
    <!-- 工具栏 Teleport 到 R3 视图工具条的控件区（#view-toolbar-controls），实现单条统一工具栏 -->
    <Teleport to="#view-toolbar-controls">
      <div class="toolbar">
        <CustomDropdown v-model="filterOutline" :options="outlineFilterOptions" />
        <CreateButton label="新建章节" @click="newManuscript" />
        <span class="toolbar-info">共 {{ filteredManuscripts.length }} 章</span>
      </div>
    </Teleport>

    <div class="ms-body">
      <div class="ms-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="ms-sidebar-toggle" role="button" tabindex="0" :aria-expanded="!sidebarCollapsed" @click="sidebarCollapsed = !sidebarCollapsed" @keydown.enter.prevent="sidebarCollapsed = !sidebarCollapsed" @keydown.space.prevent="sidebarCollapsed = !sidebarCollapsed">
          <span><WsIcon :name="sidebarCollapsed ? 'chevron-right' : 'arrow-up'" size="xs" /></span>
        </div>
        <div v-show="!sidebarCollapsed" class="ms-sidebar-content">
          <ChapterList
            :chapters="filteredManuscripts"
            :current-id="current?.id || ''"
            @select="select"
            @reorder="onReorder"
            @delete="deleteChapter"
          />
        </div>
      </div>

      <div v-if="current" class="ms-main">
        <div class="ms-editor-header">
          <input v-model="editTitle" class="ms-title-input" placeholder="章节标题" @blur="saveTitle" />
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
      :all-chapters="manuscripts"
      @close="showExport = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useDuplicateNameCheck, CustomDropdown, CreateButton } from '@worldsmith/plugin-sdk'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import ChapterEditor from './components/ChapterEditor.vue'
import ChapterList from './components/ChapterList.vue'
import PhonePreview from './components/PhonePreview.vue'
import AISidebar from './components/AISidebar.vue'
import ExportDialog from './components/ExportDialog.vue'
import { useChapterEditor } from './composables/useChapterEditor'
import { useChapterSnapshots } from './composables/useChapterSnapshots'
import type { Entity } from '@worldsmith/entity-core'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

const es = useEntityStore()
const rs = useRelationStore()
const { checkAndConfirmName } = useDuplicateNameCheck()

const current = ref<Entity | null>(null)
const editTitle = ref('')
const editStatus = ref('草稿')
const filterOutline = ref('')
const showPreview = ref(false)
const showAI = ref(false)
const showExport = ref(false)
const selectedText = ref('')
const sidebarCollapsed = ref(false)
const aiSidebarRef = ref<{ runAI: (mode: string) => void } | null>(null)

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

const filteredManuscripts = computed(() => {
  if (!filterOutline.value) return manuscripts.value
  return manuscripts.value.filter(m => m.properties.outlineNodeId === filterOutline.value)
})

const outlineNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

const outlineFilterOptions = computed(() => [
  { value: '', label: '全部章节' },
  ...outlineNodes.value.map(n => ({ value: n.id, label: n.name })),
])

function select(m: Entity) {
  current.value = m
  editTitle.value = m.name
  editStatus.value = (m.properties.status as string) || '草稿'
  loadChapter(m)
  loadSnapshots(m)
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

async function newManuscript() {
  const defaultName = '未命名章节'
  const checkedName = await checkAndConfirmName(defaultName, undefined, 'manuscript')
  if (!checkedName) return
  const now = new Date().toISOString()
  const id = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const sortOrder = manuscripts.value.length
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
      entityMentions: '',
      snapshots: '[]',
    },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  await es.add(entity)
  const created = (es.entities ?? []).find(e => e.id === id)
  if (created) select(created)
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

useAgentPluginBridge('manuscript', (event) => {
  console.log(`[Agent→${event.pluginId}] ${event.action}`, event.payload)
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
  overflow-y: auto;
  min-width: 0;
}

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
