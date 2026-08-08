<template>
  <div class="knowledge-wall">
    <div class="panel-header">
      <h3 class="panel-title">知识墙</h3>
      <div class="panel-header-actions">
        <div class="view-toggle">
          <button class="toggle-btn" :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'" title="树形视图"><TuiIcon name="tree" :size="14" /></button>
          <button class="toggle-btn" :class="{ active: viewMode === 'card' }" @click="viewMode = 'card'" title="卡片视图"><TuiIcon name="grid" :size="14" /></button>
        </div>
        <button class="panel-close-btn" @click="emit('close')" title="关闭"><TuiIcon name="close" :size="14" /></button>
      </div>
    </div>
    <div class="panel-search">
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索知识..."
        @input="onSearch"
      />
    </div>
    <div class="panel-body">
      <div v-if="loading" class="panel-empty">加载中...</div>
      <div v-else-if="filteredEntries.length === 0" class="panel-empty">
        {{ searchQuery ? '未找到匹配的知识' : '知识墙还是空的' }}
      </div>
      <template v-else-if="viewMode === 'tree'">
        <div v-for="group in treeGroups" :key="group.prefix" class="tree-group">
          <div class="tree-folder" @click="toggleFolder(group.prefix)">
            <span class="folder-icon"><TuiIcon :name="expandedFolders.has(group.prefix) ? 'folderOpen' : 'folder'" :size="14" /></span>
            <span class="folder-name">{{ group.prefix || '/' }}</span>
            <span class="folder-count">{{ group.entries.length }}</span>
          </div>
          <Transition name="ws-slide-down">
            <div v-if="expandedFolders.has(group.prefix)" class="tree-items">
              <div
                v-for="entry in group.entries"
                :key="entry.id"
                class="kb-entry"
                :class="{ selected: selectedId === entry.id }"
                @click="selectEntry(entry)"
              >
                <div class="entry-header">
                  <span class="entry-scope">[{{ entry.scope }}]</span>
                  <span class="entry-path">{{ getFileName(entry.path) }}</span>
                  <button class="entry-mount-btn" @click="mountToInput(entry, $event)" title="挂载到输入框"><TuiIcon name="paperclip" :size="13" /></button>
                  <span class="entry-status"><TuiIcon :name="getStatusIcon(entry)" :size="13" /></span>
                </div>
                <div v-if="entry.summary" class="entry-summary">{{ entry.summary.slice(0, 80) }}</div>
                <div v-if="entry.tags.length" class="entry-tags">
                  <span v-for="tag in entry.tags.slice(0, 3)" :key="tag" class="entry-tag">{{ tag }}</span>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </template>
      <template v-else>
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="kb-card"
          :class="{ selected: selectedId === entry.id }"
          @click="selectEntry(entry)"
        >
          <div class="card-header">
            <span class="card-scope">[{{ entry.scope }}]</span>
            <span class="card-path">{{ entry.path }}</span>
            <button class="entry-mount-btn" @click="mountToInput(entry, $event)" title="挂载到输入框"><TuiIcon name="paperclip" :size="13" /></button>
            <span class="card-status"><TuiIcon :name="getStatusIcon(entry)" :size="13" /></span>
          </div>
          <div v-if="entry.summary" class="card-summary">{{ entry.summary.slice(0, 80) }}</div>
          <div class="card-meta">
            <span class="card-access">{{ entry.accessCount }}</span>
            <span class="card-time">{{ formatTime(entry.updatedAt) }}</span>
          </div>
        </div>
      </template>
    </div>

    <div v-if="previewEntry" class="preview-panel">
      <div class="preview-header">
        <span class="preview-title">{{ previewEntry.path }}</span>
        <button class="panel-close-btn" @click="previewEntry = null"><TuiIcon name="close" :size="14" /></button>
      </div>
      <div class="preview-scope">[{{ previewEntry.scope }}]</div>
      <div v-if="previewLoading" class="panel-empty">加载中...</div>
      <pre v-else class="preview-content">{{ previewContent }}</pre>
    </div>

    <div class="panel-footer">
      <button class="add-btn" @click="showAddDialog = true">+ 新增知识</button>
    </div>

    <Teleport to="body">
      <div v-if="showAddDialog" class="kb-dialog-overlay" @click.self="showAddDialog = false">
        <div class="kb-dialog">
          <div class="kb-dialog-header">
            <span class="kb-dialog-title">新增知识</span>
            <button class="panel-close-btn" @click="showAddDialog = false"><TuiIcon name="close" :size="14" /></button>
          </div>
          <div class="kb-dialog-body">
            <div class="kb-field">
              <label class="kb-label">路径</label>
              <input v-model="newEntry.path" class="kb-input" placeholder="例: entities/character/backstory" />
            </div>
            <div class="kb-field">
              <label class="kb-label">作用域</label>
              <div class="kb-scope-toggle">
                <button class="scope-btn" :class="{ active: newEntry.scope === 'global' }" @click="newEntry.scope = 'global'">全局</button>
                <button class="scope-btn" :class="{ active: newEntry.scope === 'project' }" @click="newEntry.scope = 'project'">项目</button>
              </div>
            </div>
            <div class="kb-field">
              <label class="kb-label">摘要</label>
              <input v-model="newEntry.summary" class="kb-input" placeholder="简短描述（可选）" />
            </div>
            <div class="kb-field">
              <label class="kb-label">标签</label>
              <input v-model="newEntry.tagsStr" class="kb-input" placeholder="用逗号分隔，例: 角色,背景,历史" />
            </div>
            <div class="kb-field">
              <label class="kb-label">内容</label>
              <textarea v-model="newEntry.content" class="kb-textarea" rows="6" placeholder="知识内容..."></textarea>
            </div>
          </div>
          <div class="kb-dialog-footer">
            <button class="kb-btn kb-btn-cancel" @click="showAddDialog = false">取消</button>
            <button class="kb-btn kb-btn-confirm" :disabled="!newEntry.path || !newEntry.content" @click="onAddKnowledge">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import { kbList, kbSearchKeyword, kbWrite, kbReadById } from '../kb/useKbRust'
import type { KBEntry, KBScope } from '@agent/kb/kb-store'
import { useActivityLog } from '../composables/useActivityLog'

const emit = defineEmits<{
  add: []
  select: [entry: KBEntry]
  close: []
  mount: [entry: KBEntry]
}>()

const { addLog } = useActivityLog()

const loading = ref(true)
const entries = ref<KBEntry[]>([])
const searchQuery = ref('')
const viewMode = ref<'tree' | 'card'>('tree')
const selectedId = ref<string | null>(null)
const expandedFolders = ref(new Set<string>())
const showAddDialog = ref(false)
const previewEntry = ref<KBEntry | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)

const newEntry = ref({
  path: '',
  scope: 'project' as KBScope,
  summary: '',
  tagsStr: '',
  content: '',
})

const filteredEntries = computed(() => {
  if (!searchQuery.value) return entries.value
  return entries.value.filter(e =>
    e.path.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
    (e.summary && e.summary.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
    e.tags.some(t => t.toLowerCase().includes(searchQuery.value.toLowerCase()))
  )
})

const treeGroups = computed(() => {
  const groups: Map<string, KBEntry[]> = new Map()
  for (const e of filteredEntries.value) {
    const prefix = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/')) : ''
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(e)
  }
  return Array.from(groups.entries()).map(([prefix, entries]) => ({ prefix, entries }))
})

function getFileName(path: string): string {
  return path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path
}

function getStatusIcon(entry: KBEntry): string {
  if (entry.tags.includes('compressed')) return 'package'
  const ageDays = (Date.now() - entry.updatedAt) / 86400000
  if (ageDays > 30 && entry.accessCount < 2) return 'moon'
  return 'sparkle'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 挂载到输入框：转发给父级（AgentWorkspace 追加 `@path ` 到输入框） */
function mountToInput(entry: KBEntry, e?: Event): void {
  if (e) { e.stopPropagation(); e.preventDefault() }
  emit('mount', entry)
}

function toggleFolder(prefix: string) {
  if (expandedFolders.value.has(prefix)) {
    expandedFolders.value.delete(prefix)
  } else {
    expandedFolders.value.add(prefix)
  }
}

let selectSeq = 0

async function selectEntry(entry: KBEntry) {
  selectedId.value = entry.id
  emit('select', entry)
  previewEntry.value = entry
  previewLoading.value = true
  previewContent.value = ''
  const seq = ++selectSeq
  try {
    const full = await kbReadById(entry.id)
    if (seq !== selectSeq) return
    previewContent.value = full?.content || '（无内容）'
  } catch {
    if (seq !== selectSeq) return
    previewContent.value = '（读取失败）'
  }
  previewLoading.value = false
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
async function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (!searchQuery.value) {
      entries.value = await kbList()
    } else {
      entries.value = await kbSearchKeyword(searchQuery.value)
    }
  }, 300)
}

async function onAddKnowledge() {
  if (!newEntry.value.path || !newEntry.value.content) return
  try {
    const tags = newEntry.value.tagsStr
      ? newEntry.value.tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean)
      : []
    await kbWrite({
      path: newEntry.value.path,
      scope: newEntry.value.scope,
      content: newEntry.value.content,
      summary: newEntry.value.summary || undefined,
      tags,
    })
    addLog('knowledge', `新增知识: ${newEntry.value.path}`)
    showAddDialog.value = false
    newEntry.value = { path: '', scope: 'project', summary: '', tagsStr: '', content: '' }
    entries.value = await kbList()
  } catch (err) {
    addLog('error', `新增知识失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

onMounted(async () => {
  try {
    entries.value = await kbList()
  } catch {}
  loading.value = false
})
</script>

<style scoped>
.knowledge-wall {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel-close-btn:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.panel-close-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.panel-title {
  font-size: var(--fs-md);
  font-weight: 600;
  margin: 0;
  letter-spacing: var(--letter-spacing-wide, 0.02em);
}

.view-toggle {
  display: flex;
  gap: 2px;
}

.toggle-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.toggle-btn:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.toggle-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.toggle-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.panel-search {
  padding: 8px 14px;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  background: var(--bg-muted);
  color: var(--text-primary);
}
.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.panel-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
  font-size: var(--fs-sm);
}

.tree-group {
  margin-bottom: 4px;
}

.tree-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.tree-folder:hover {
  background: var(--bg-muted);
}

.folder-icon {
  font-size: var(--fs-base);
  color: var(--text-secondary);
}

.folder-name {
  flex: 1;
  font-weight: 500;
}

.folder-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 1px 6px;
  border-radius: 10px;
}

.tree-items {
  padding-left: 20px;
}

.kb-entry, .kb-card {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.kb-entry:hover, .kb-card:hover {
  background: var(--bg-muted);
}
.kb-entry.selected, .kb-card.selected {
  background: var(--accent-soft);
}

.entry-header, .card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
}

.entry-scope, .card-scope {
  color: var(--accent);
  font-weight: 500;
}

.entry-path, .card-path {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-status, .card-status {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.entry-mount-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.kb-entry:hover .entry-mount-btn,
.kb-card:hover .entry-mount-btn {
  opacity: 1;
}

.entry-mount-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.entry-mount-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.entry-summary, .card-summary {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

.entry-tags {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.entry-tag {
  font-size: var(--fs-xs);
  padding: 1px 6px;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.card-meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.preview-panel {
  border-top: 1px solid var(--border);
  max-height: 200px;
  overflow-y: auto;
  flex-shrink: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-muted);
}

.preview-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.preview-scope {
  font-size: var(--fs-xs);
  color: var(--accent);
  padding: 0 14px 4px;
}

.preview-content {
  margin: 0;
  padding: 8px 14px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  max-height: 140px;
  overflow-y: auto;
}

.panel-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.add-btn {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.add-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.kb-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.kb-dialog {
  width: 420px;
  max-height: 80vh;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.kb-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.kb-dialog-title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
}

.kb-dialog-body {
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kb-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.kb-input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  background: var(--bg-muted);
  color: var(--text-primary);
}
.kb-input:focus {
  outline: none;
  border-color: var(--accent);
}

.kb-scope-toggle {
  display: flex;
  gap: 4px;
}

.scope-btn {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.scope-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.scope-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.kb-textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  background: var(--bg-muted);
  color: var(--text-primary);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}
.kb-textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.kb-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.kb-btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  cursor: pointer;
  border: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}

.kb-btn-cancel {
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.kb-btn-cancel:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.kb-btn-cancel:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.kb-btn-confirm {
  background: var(--accent);
  color: var(--on-accent);
}
.kb-btn-confirm:hover {
  opacity: 0.9;
}
.kb-btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
