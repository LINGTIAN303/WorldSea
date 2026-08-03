<template>
  <div class="knowledge-wall">
    <div class="panel-header">
      <h3 class="panel-title" :style="{ fontFamily: fontFamily }">知识墙</h3>
      <div class="panel-header-actions">
        <div class="view-toggle">
          <button class="toggle-btn" :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'"><WsIcon name="tree" size="xs" /></button>
          <button class="toggle-btn" :class="{ active: viewMode === 'card' }" @click="viewMode = 'card'">🃏</button>
        </div>
        <button class="panel-close-btn" @click="emit('close')" title="关闭">✕</button>
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
            <span class="folder-icon"><WsIcon :name="expandedFolders.has(group.prefix) ? 'folder-open' : 'folder'" size="xs" /></span>
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
                  <button class="entry-mount-btn" @click="mountToInput(entry, $event)" title="挂载到输入框"><WsIcon name="paperclip" size="xs" /></button>
                  <span class="entry-status"><WsIcon :name="getStatusIcon(entry)" size="xs" /></span>
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
            <button class="entry-mount-btn" @click="mountToInput(entry, $event)" title="挂载到输入框"><WsIcon name="paperclip" size="xs" /></button>
            <span class="card-status"><WsIcon :name="getStatusIcon(entry)" size="xs" /></span>
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
        <button class="panel-close-btn" @click="previewEntry = null">✕</button>
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
            <button class="panel-close-btn" @click="showAddDialog = false">✕</button>
          </div>
          <div class="kb-dialog-body">
            <div class="kb-field">
              <label class="kb-label">路径</label>
              <input v-model="newEntry.path" class="kb-input" placeholder="例: entities/character/backstory" />
            </div>
            <div class="kb-field">
              <label class="kb-label">作用域</label>
              <div class="kb-scope-toggle">
                <button class="scope-btn" :class="{ active: newEntry.scope === 'global' }" @click="newEntry.scope = 'global'">🌐 全局</button>
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
import { WsIcon } from '@worldsmith/ui-kit'
import { kbList, kbSearchKeyword, kbWrite, kbReadById } from '@agent/kb/kb-store'
import type { KBEntry, KBScope } from '@agent/kb/kb-store'
import { useActivityLog } from '../composables/useActivityLog'
import { usePersonaFont } from '../composables/usePersonaFont'
import { useSpaceStore } from '../stores/space-store'

const emit = defineEmits<{
  add: []
  select: [entry: KBEntry]
  close: []
}>()

const { addLog } = useActivityLog()
const { fontFamily } = usePersonaFont()
const spaceStore = useSpaceStore()

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
  return 'sparkles'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function mountToInput(entry: KBEntry, e?: Event): void {
  if (e) { e.stopPropagation(); e.preventDefault() }
  const fileName = entry.path.split('/').pop() || entry.path
  spaceStore.inputInjection = { label: fileName, ref: `@${entry.path} ` }
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
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
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
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel-close-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.panel-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  margin: 0;
  letter-spacing: var(--letter-spacing-wide);
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
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-base);
}
.toggle-btn.active {
  background: var(--color-primary-muted);
}

.panel-search {
  padding: 8px 14px;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--font-size-xs);
  background: var(--color-surface);
  color: var(--color-text);
}
.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.panel-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 24px;
  font-size: var(--font-size-sm);
}

.tree-group {
  margin-bottom: 4px;
}

.tree-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.tree-folder:hover {
  background: var(--color-surface);
}

.folder-icon {
  font-size: var(--font-size-base);
}

.folder-name {
  flex: 1;
  font-weight: 500;
}

.folder-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  padding: 1px 6px;
  border-radius: 10px;
}

.tree-items {
  padding-left: 20px;
}

.kb-entry, .kb-card {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.kb-entry:hover, .kb-card:hover {
  background: var(--color-surface);
}
.kb-entry.selected, .kb-card.selected {
  background: var(--color-primary-muted);
}

.entry-header, .card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
}

.entry-scope, .card-scope {
  color: var(--color-primary);
  font-weight: 500;
}

.entry-path, .card-path {
  flex: 1;
  color: var(--color-text);
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-status, .card-status {
  font-size: var(--font-size-sm);
}

.entry-mount-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-tertiary);
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
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.entry-summary, .card-summary {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
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
  font-size: var(--font-size-2xs);
  padding: 1px 6px;
  background: var(--color-surface);
  border-radius: 4px;
  color: var(--color-text-secondary);
}

.card-meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.preview-panel {
  border-top: 1px solid var(--color-border);
  max-height: 200px;
  overflow-y: auto;
  flex-shrink: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-surface);
}

.preview-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.preview-scope {
  font-size: var(--font-size-2xs);
  color: var(--color-primary);
  padding: 0 14px 4px;
}

.preview-content {
  margin: 0;
  padding: 8px 14px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  max-height: 140px;
  overflow-y: auto;
}

.panel-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.add-btn {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.add-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-muted);
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
  background: var(--color-surface-elevated);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.kb-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.kb-dialog-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
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
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.kb-input {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text);
}
.kb-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.kb-scope-toggle {
  display: flex;
  gap: 4px;
}

.scope-btn {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.scope-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-muted);
}

.kb-textarea {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}
.kb-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.kb-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}

.kb-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.kb-btn-cancel {
  background: var(--color-surface);
  color: var(--color-text-secondary);
}
.kb-btn-cancel:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.kb-btn-confirm {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
.kb-btn-confirm:hover {
  opacity: 0.9;
}
.kb-btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
