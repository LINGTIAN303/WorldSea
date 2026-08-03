<template>
  <WsModal :show="show" title="项目管理" size="md" @close="$emit('close')">
    <div class="project-manager">
      <!-- 新建项目 -->
      <div class="pm-create">
        <input
          type="text"
          class="pm-create-input"
          v-model="newProjectName"
          placeholder="新项目名称..."
          @keydown.enter="onCreateProject"
        />
        <button class="pm-create-btn-dir" :title="newProjectDir || '选择项目目录（可选）'" @click="onSelectNewProjectDir">
          {{ newProjectDir ? '📁' : '📂' }}
        </button>
        <button class="pm-create-btn" :disabled="!newProjectName.trim() || creating" @click="onCreateProject">
          {{ creating ? '创建中...' : '新建' }}
        </button>
      </div>
      <div v-if="newProjectDir" class="pm-create-dir-hint">
        目录：{{ newProjectDir }}
      </div>

      <!-- 项目列表 -->
      <div class="pm-list">
        <div
          v-for="project in projects"
          :key="project.id"
          class="pm-item"
          :class="{ active: project.id === currentProjectId }"
          @click="onSwitchProject(project.id)"
        >
          <div class="pm-item-info">
            <template v-if="editingId === project.id">
              <input
                ref="renameInput"
                type="text"
                class="pm-rename-input"
                v-model="renameValue"
                @keydown.enter="onRenameConfirm(project.id)"
                @keydown.escape="onRenameCancel"
                @blur="onRenameConfirm(project.id)"
              />
            </template>
            <template v-else>
              <span class="pm-item-name">{{ project.name }}</span>
              <span v-if="project.description" class="pm-item-desc">{{ project.description }}</span>
            </template>
          </div>
          <div class="pm-item-meta">
            <span v-if="project.dirPath" class="pm-folder-badge" :title="project.dirPath">📁</span>
            <span v-if="project.id === currentProjectId" class="pm-current-badge">当前</span>
            <span class="pm-item-date">{{ formatDate(project.lastOpenedAt) }}</span>
          </div>
          <div class="pm-item-actions" @click.stop>
            <button v-if="!project.dirPath" class="pm-action-btn" title="绑定本地目录" @click="onBindDir(project)">📂</button>
            <button v-else class="pm-action-btn" title="取消目录绑定" @click="onUnbindDir(project)">📂✕</button>
            <button v-if="project.id === currentProjectId" class="pm-action-btn" title="导出项目" @click="onExportProject">📤</button>
            <button class="pm-action-btn" title="重命名" @click="onRenameStart(project)">✎</button>
            <button
              class="pm-action-btn pm-action-btn--danger"
              title="删除"
              :disabled="project.id === currentProjectId"
              @click="onDeleteProject(project)"
            >✕</button>
          </div>
        </div>

        <div v-if="projects.length === 0" class="pm-empty">
          暂无项目，请创建一个新项目
        </div>
      </div>

      <!-- 导入项目 -->
      <div class="pm-import">
        <button class="pm-import-btn" :disabled="importing" @click="onImportProject">
          {{ importing ? '导入中...' : '📥 从文件夹导入项目' }}
        </button>
      </div>
    </div>
  </WsModal>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import WsModal from '../WsModal.vue'
import { useProjectSwitcher } from '../../composables/useProjectSwitcher'
import { exportProjectToDir, importProjectFromDir } from '../../core/ProjectFS'
import { getProjectManager, setStorageProjectDir } from '@worldsmith/entity-core/core'
import type { ProjectInfo } from '@worldsmith/entity-core/core'
import { useFsWatcher } from '../../composables/useFsWatcher'
import { useConfirm } from '@worldsmith/plugin-sdk'
import { toastSuccess, toastError } from '../../composables/useToast'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const {
  switching,
  currentProject,
  projectList,
  switchProject,
  deleteProject,
  renameProject,
  refreshProjectList,
} = useProjectSwitcher()

const { startWatching, stopWatching } = useFsWatcher()
const { confirm } = useConfirm()

const newProjectDir = ref<string | null>(null)

const projects = computed(() => projectList.value)
const currentProjectId = computed(() => currentProject.value?.id ?? null)

const newProjectName = ref('')
const creating = ref(false)
const importing = ref(false)
const editingId = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement[]>([])

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}小时前`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 30) return `${diffDay}天前`
    return d.toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

async function onCreateProject() {
  const name = newProjectName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    const pm = getProjectManager()
    const project = await pm.createProject(name, undefined, newProjectDir.value ?? undefined)
    // 如果是当前项目，切换到它（会触发 setStorageProjectDir）
    if (project.id !== currentProjectId.value) {
      await switchProject(project.id)
    } else {
      // 已经是当前项目，手动设置目录
      await setStorageProjectDir(newProjectDir.value)
    }
    newProjectName.value = ''
    newProjectDir.value = null
    await refreshProjectList()
    emit('close')
  } catch (err) {
    console.error('[ProjectManager] 创建项目失败:', err)
  } finally {
    creating.value = false
  }
}

async function onSelectNewProjectDir() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title: '选择项目存储目录', multiple: false })
    if (selected) {
      newProjectDir.value = selected as string
    }
  } catch {
    // Tauri 不可用或用户取消
  }
}

async function onBindDir(project: ProjectInfo) {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title: `为「${project.name}」选择本地目录`, multiple: false })
    if (!selected) return
    const dirPath = selected as string
    const pm = getProjectManager()
    await pm.setProjectDir(project.id, dirPath)
    // 如果是当前项目，立即激活 FileStorageBackend + 启动文件监听
    if (project.id === currentProjectId.value) {
      await setStorageProjectDir(dirPath)
      await startWatching()
      // 重新加载 Store 数据（从文件系统读取）
      const { useEntityStore, useRelationStore, useFileStore } = await import('@worldsmith/entity-core/stores')
      await Promise.all([
        useEntityStore().loadAll(),
        useRelationStore().loadAll(),
        useFileStore().loadAll(),
      ])
    }
    await refreshProjectList()
  } catch (err) {
    console.error('[ProjectManager] 绑定目录失败:', err)
    toastError(`绑定目录失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function onUnbindDir(project: ProjectInfo) {
  if (!await confirm({ type: 'warning', title: '取消目录绑定', description: `取消「${project.name}」的目录绑定？\n数据将回到 IndexedDB/SQLite 存储。` })) return
  try {
    const pm = getProjectManager()
    await pm.setProjectDir(project.id, null)
    // 如果是当前项目，切换回 fallback 存储 + 停止监听
    if (project.id === currentProjectId.value) {
      await stopWatching()
      await setStorageProjectDir(null)
      const { useEntityStore, useRelationStore, useFileStore } = await import('@worldsmith/entity-core/stores')
      await Promise.all([
        useEntityStore().loadAll(),
        useRelationStore().loadAll(),
        useFileStore().loadAll(),
      ])
    }
    await refreshProjectList()
  } catch (err) {
    console.error('[ProjectManager] 取消目录绑定失败:', err)
  }
}

async function onSwitchProject(id: string) {
  if (id === currentProjectId.value || switching.value) return
  const ok = await switchProject(id)
  if (ok) emit('close')
}

function onRenameStart(project: ProjectInfo) {
  editingId.value = project.id
  renameValue.value = project.name
  nextTick(() => {
    const input = renameInput.value?.[0]
    input?.focus()
    input?.select()
  })
}

async function onRenameConfirm(id: string) {
  const name = renameValue.value.trim()
  if (name && editingId.value) {
    await renameProject(id, name)
  }
  editingId.value = null
  renameValue.value = ''
}

function onRenameCancel() {
  editingId.value = null
  renameValue.value = ''
}

async function onDeleteProject(project: ProjectInfo) {
  if (project.id === currentProjectId.value) return
  if (!await confirm({ type: 'danger', title: '删除项目', description: `确定删除项目「${project.name}」？此操作不可撤销。` })) return
  try {
    await deleteProject(project.id)
  } catch (err) {
    console.error('[ProjectManager] 删除项目失败:', err)
  }
}

async function onExportProject() {
  try {
    const dir = await exportProjectToDir()
    if (dir) {
      toastSuccess(`项目已导出到：${dir}`)
    }
  } catch (err) {
    console.error('[ProjectManager] 导出项目失败:', err)
    toastError(`导出失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function onImportProject() {
  if (importing.value) return
  importing.value = true
  try {
    const result = await importProjectFromDir()
    if (result) {
      toastSuccess(`项目「${result.projectName}」导入成功！实体：${result.entityCount} 个，关系：${result.relationCount} 个`)
      await refreshProjectList()
      emit('close')
    }
  } catch (err) {
    console.error('[ProjectManager] 导入项目失败:', err)
    toastError(`导入失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.project-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
  max-height: 60vh;
}

.pm-create {
  display: flex;
  gap: 8px;
}

.pm-create-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: var(--bg-secondary, var(--color-bg-surface));
  color: var(--text-color, var(--color-text-primary));
  font-size: var(--font-size-sm, 13px);
  outline: none;
  transition: border-color var(--transition-fast, 0.15s);
}

.pm-create-input:focus {
  border-color: var(--accent, var(--color-accent));
}

.pm-create-btn-dir {
  padding: 8px 10px;
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm, 13px);
  transition: background var(--transition-fast, 0.15s), border-color var(--transition-fast, 0.15s), color var(--transition-fast, 0.15s), box-shadow var(--transition-fast, 0.15s), transform var(--transition-fast, 0.15s), opacity var(--transition-fast, 0.15s), filter var(--transition-fast, 0.15s);
}

.pm-create-btn-dir:hover {
  border-color: var(--accent, var(--color-accent));
  background: var(--hover-bg, var(--color-bg-hover));
}

.pm-create-dir-hint {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-tertiary, var(--color-text-tertiary));
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-create-btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md, 6px);
  background: var(--accent, var(--color-accent));
  color: #fff;
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  transition: opacity var(--transition-fast, 0.15s);
}

.pm-create-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pm-create-btn:not(:disabled):hover {
  opacity: 0.85;
}

.pm-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
}

.pm-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  transition: background var(--transition-fast, 0.15s);
  border: 1px solid transparent;
}

.pm-item:hover {
  background: var(--hover-bg, var(--color-bg-hover));
}

.pm-item.active {
  background: var(--active-bg, var(--color-bg-active));
  border-color: var(--accent, var(--color-accent));
}

.pm-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pm-item-name {
  font-size: var(--font-size-sm, 13px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--text-color, var(--color-text-primary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-item-desc {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-secondary, var(--color-text-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pm-current-badge {
  font-size: var(--font-size-xs, 11px);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent, var(--color-accent));
  color: #fff;
  font-weight: var(--font-weight-medium, 500);
}

.pm-folder-badge {
  font-size: 12px;
  cursor: default;
}

.pm-item-date {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-tertiary, var(--color-text-tertiary));
  white-space: nowrap;
}

.pm-item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast, 0.15s);
  flex-shrink: 0;
}

.pm-item:hover .pm-item-actions {
  opacity: 1;
}

.pm-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary, var(--color-text-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast, 0.15s), border-color var(--transition-fast, 0.15s), color var(--transition-fast, 0.15s), box-shadow var(--transition-fast, 0.15s), transform var(--transition-fast, 0.15s), opacity var(--transition-fast, 0.15s), filter var(--transition-fast, 0.15s);
}

.pm-action-btn:hover {
  background: var(--hover-bg, var(--color-bg-hover));
  color: var(--text-color, var(--color-text-primary));
}

.pm-action-btn--danger:hover {
  background: rgba(220, 50, 50, 0.15);
  color: #dc3232;
}

.pm-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pm-rename-input {
  padding: 2px 6px;
  border: 1px solid var(--accent, var(--color-accent));
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-primary, var(--color-bg));
  color: var(--text-color, var(--color-text-primary));
  font-size: var(--font-size-sm, 13px);
  outline: none;
  width: 100%;
}

.pm-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-tertiary, var(--color-text-tertiary));
  font-size: var(--font-size-sm, 13px);
}

.pm-import {
  border-top: 1px solid var(--border-color, var(--color-border));
  padding-top: 12px;
}

.pm-import-btn {
  width: 100%;
  padding: 8px 16px;
  border: 1px dashed var(--border-color, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: var(--text-secondary, var(--color-text-secondary));
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  transition: background var(--transition-fast, 0.15s), border-color var(--transition-fast, 0.15s), color var(--transition-fast, 0.15s), box-shadow var(--transition-fast, 0.15s), transform var(--transition-fast, 0.15s), opacity var(--transition-fast, 0.15s), filter var(--transition-fast, 0.15s);
}

.pm-import-btn:hover:not(:disabled) {
  border-color: var(--accent, var(--color-accent));
  color: var(--accent, var(--color-accent));
  background: var(--hover-bg, var(--color-bg-hover));
}

.pm-import-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
