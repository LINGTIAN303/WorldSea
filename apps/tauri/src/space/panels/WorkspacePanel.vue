<template>
  <div class="workspace-panel">
    <!-- 顶部：标题 + 刷新 + 面包屑 -->
    <div class="wp-header">
      <div class="wp-title-row">
        <!-- 任务29/术语统一：「工作区」→「项目目录」（统一根口径，见 workspace-unification-plan.md） -->
        <span class="wp-title"><WsIcon name="folder" size="sm" /> 项目目录</span>
        <button class="wp-action-btn" title="刷新" @click="refresh"><WsIcon name="refresh" size="sm" /></button>
      </div>
      <div v-if="rootPath" class="wp-breadcrumb">
        <button class="wp-crumb" :class="{ on: breadcrumbs.length === 0 }" title="工作区根目录" @click="openDir(rootPath)">
          <WsIcon name="home" size="xs" />
        </button>
        <template v-for="(seg, i) in breadcrumbs" :key="i">
          <span class="wp-crumb-sep">/</span>
          <button class="wp-crumb" :class="{ on: i === breadcrumbs.length - 1 }" @click="openDir(breadcrumbPath(i))">
            {{ seg }}
          </button>
        </template>
      </div>
      <div v-else class="wp-no-dir">未绑定项目目录</div>
    </div>

    <!-- 工具栏：新建文件/文件夹/上传 -->
    <div v-if="currentPath" class="wp-toolbar">
      <button class="wp-tool-btn" @click="openInput('newFile', currentPath)"><WsIcon name="file" size="xs" />新建文件</button>
      <button class="wp-tool-btn" @click="openInput('newFolder', currentPath)"><WsIcon name="folder" size="xs" />新建文件夹</button>
      <button class="wp-tool-btn" @click="onUpload"><WsIcon name="upload" size="xs" />上传</button>
      <input ref="fileInput" type="file" class="wp-file-input" @change="onFilePicked" />
    </div>

    <!-- 目录树 -->
    <div class="wp-body">
      <div v-if="loading" class="wp-empty">加载中…</div>
      <div v-else-if="flatNodes.length === 0" class="wp-empty">工作区为空</div>
      <div
        v-for="fn in flatNodes"
        :key="fn.node.path"
        class="wp-row"
        :class="{ dir: fn.node.isDir, active: fn.node.path === currentPath }"
        :style="{ paddingLeft: fn.depth * 14 + 8 + 'px' }"
      >
        <button
          v-if="fn.node.isDir"
          class="wp-toggle"
          :class="{ open: fn.node.expanded }"
          :aria-label="fn.node.expanded ? '折叠' : '展开'"
          @click.stop="toggleNode(fn.node)"
        ><WsIcon name="chevron-right" size="xs" /></button>
        <span v-else class="wp-toggle-spacer"></span>
        <WsIcon :name="fn.node.isDir ? 'folder' : 'file'" size="xs" :class="fn.node.isDir ? 'icon-folder' : 'icon-file'" />
        <button class="wp-name" :title="fn.node.path" @click="fn.node.isDir ? toggleNode(fn.node) : previewFile(fn.node)">
          {{ fn.node.name }}
        </button>
        <span v-if="!fn.node.isDir" class="wp-size">{{ formatSize(fn.node.size) }}</span>
        <div class="wp-row-actions">
          <button v-if="fn.node.isDir" class="wp-row-btn" title="在此新建文件" @click.stop="openInput('newFile', fn.node.path)"><WsIcon name="file" size="xs" /></button>
          <button class="wp-row-btn" title="重命名" @click.stop="openInput('rename', undefined, fn.node)"><WsIcon name="edit" size="xs" /></button>
          <button class="wp-row-btn danger" title="删除" @click.stop="onDelete(fn.node)"><WsIcon name="trash" size="xs" /></button>
        </div>
      </div>
    </div>

    <!-- 输入弹窗（新建文件/文件夹/重命名） -->
    <div v-if="inputDialog" class="wp-modal-backdrop" @click.self="inputDialog = null">
      <div class="wp-modal">
        <div class="wp-modal-header">
          <span class="wp-modal-title">{{ inputDialog.title }}</span>
          <button class="wp-modal-close" @click="inputDialog = null" title="关闭"><WsIcon name="close" size="sm" /></button>
        </div>
        <div class="wp-modal-body">
          <label class="wp-input-label">{{ inputDialog.label }}</label>
          <input v-model="inputDialog.value" class="wp-input" :placeholder="inputDialog.placeholder" @keydown.enter="confirmInput" autofocus />
        </div>
        <div class="wp-modal-footer">
          <button class="wp-modal-btn" @click="inputDialog = null">取消</button>
          <button class="wp-modal-btn primary" @click="confirmInput">确定</button>
        </div>
      </div>
    </div>

    <!-- 文件预览弹窗 -->
    <div v-if="preview" class="wp-modal-backdrop" @click.self="preview = null">
      <div class="wp-modal">
        <div class="wp-modal-header">
          <span class="wp-modal-title">{{ preview.name }}</span>
          <button class="wp-modal-close" @click="preview = null" title="关闭"><WsIcon name="close" size="sm" /></button>
        </div>
        <textarea class="wp-modal-content" :value="preview.content" readonly spellcheck="false"></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon, useConfirm } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgent } from '@/agent/composables/useAgent'
import { resolveWorkspaceDir } from '../workspace'

/** 目录树节点（对应 cmd_fs_list 返回的 FsEntry camelCase 结构） */
interface FsNode {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: string | null
  expanded?: boolean
  loaded?: boolean
  loading?: boolean
  children?: FsNode[]
}

/** 扁平化后的树节点（带缩进深度） */
interface FlatNode {
  node: FsNode
  depth: number
}

/** 输入弹窗状态：新建文件/文件夹/重命名 */
interface InputDialog {
  title: string
  label: string
  placeholder: string
  value: string
  mode: 'newFile' | 'newFolder' | 'rename'
  base?: string
  target?: string
}

const { currentWorkdir } = useAgent()
const { confirm } = useConfirm()

const rootPath = ref<string | null>(null)
const currentPath = ref<string | null>(null)
const rootChildren = ref<FsNode[]>([])
const loading = ref(false)
const fileInput = ref<HTMLInputElement>()
const inputDialog = ref<InputDialog | null>(null)
const preview = ref<{ name: string; content: string } | null>(null)

/** 归一化路径分隔符为 '/'（Rust cmd_fs_list 返回也用 '/'，保证一致） */
function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 拼接路径段（归一化为 '/' 分隔，合并多余分隔符；保留盘符如 C:/ 的前导结构） */
function joinPath(...parts: string[]): string {
  const joined = parts.map(norm).join('/').replace(/\/{2,}/g, '/')
  return joined
}

/** 当前路径相对根路径的面包屑段（空数组=位于根目录） */
const breadcrumbs = computed<string[]>(() => {
  if (!rootPath.value || !currentPath.value) return []
  const rel = norm(currentPath.value).slice(norm(rootPath.value).length).replace(/^\/+/, '')
  return rel ? rel.split('/').filter(Boolean) : []
})

/** 生成第 index 个面包屑对应的完整路径 */
function breadcrumbPath(index: number): string {
  const segs = breadcrumbs.value.slice(0, index + 1)
  return joinPath(rootPath.value!, ...segs)
}

/** 扁平化目录树（仅展示已展开节点的子孙） */
const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = []
  const walk = (nodes: FsNode[], depth: number): void => {
    for (const node of nodes) {
      out.push({ node, depth })
      if (node.isDir && node.expanded && node.children) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(rootChildren.value, 0)
  return out
})

/** 列出指定目录的条目（目录优先、按名称排序） */
async function loadDir(path: string): Promise<FsNode[]> {
  try {
    const entries = await invoke<FsNode[]>('cmd_fs_list', { path, recursive: false })
    return entries.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    )
  } catch (err) {
    console.warn('[WorkspacePanel] 列出目录失败:', err)
    return []
  }
}

/** 打开目录（更新 currentPath 并加载其条目） */
async function openDir(path: string): Promise<void> {
  currentPath.value = norm(path)
  loading.value = true
  rootChildren.value = await loadDir(norm(path))
  loading.value = false
}

/** 展开/折叠目录节点（懒加载子条目） */
async function toggleNode(node: FsNode): Promise<void> {
  if (!node.isDir) return
  if (node.expanded) {
    node.expanded = false
    return
  }
  node.expanded = true
  currentPath.value = norm(node.path)
  if (!node.loaded && !node.loading) {
    node.loading = true
    node.children = await loadDir(node.path)
    node.loading = false
    node.loaded = true
  }
}

/** 刷新当前目录（保留展开状态需重建根，简单起见重新加载当前路径） */
async function refresh(): Promise<void> {
  if (!rootPath.value) return
  await openDir(currentPath.value ?? rootPath.value)
}

/** 初始化：解析空间级根（任务29/C1：会话 workdir 优先；无会话回落统一根 = 当前项目目录，
 *  浏览器 preview 为可读假路径，列表失败时呈空态），不再要求"先创建会话"才能浏览 */
async function init(): Promise<void> {
  const wd = currentWorkdir.value ?? (await resolveWorkspaceDir())
  if (!wd) {
    rootPath.value = null
    currentPath.value = null
    rootChildren.value = []
    return
  }
  rootPath.value = norm(wd)
  await openDir(rootPath.value)
}

/** 打开输入弹窗（新建文件/文件夹/重命名） */
function openInput(mode: InputDialog['mode'], base?: string, target?: FsNode): void {
  if (mode === 'rename') {
    if (!target) return
    inputDialog.value = {
      title: '重命名',
      label: '新名称',
      placeholder: target.name,
      value: target.name,
      mode,
      target: norm(target.path),
    }
    return
  }
  const dir = base ?? currentPath.value
  if (!dir) return
  inputDialog.value = {
    title: mode === 'newFile' ? '新建文件' : '新建文件夹',
    label: mode === 'newFile' ? '文件名' : '文件夹名称',
    placeholder: mode === 'newFile' ? '例如 notes.md' : '例如 src',
    value: '',
    mode,
    base: norm(dir),
  }
}

/** 确认输入弹窗：按模式执行新建/重命名 */
async function confirmInput(): Promise<void> {
  const d = inputDialog.value
  if (!d) return
  const name = d.value.trim()
  if (!name) return
  try {
    if (d.mode === 'newFile') {
      if (!d.base) return
      await invoke('cmd_fs_write', { path: joinPath(d.base, name), content: '', createDirs: false })
    } else if (d.mode === 'newFolder') {
      if (!d.base) return
      await invoke('cmd_fs_mkdir', { path: joinPath(d.base, name) })
    } else if (d.mode === 'rename') {
      if (!d.target) return
      const dir = d.target.slice(0, d.target.lastIndexOf('/'))
      await invoke('cmd_fs_rename', { src: d.target, dest: joinPath(dir, name) })
    }
    inputDialog.value = null
    await refresh()
  } catch (err) {
    console.warn('[WorkspacePanel] 操作失败:', err)
  }
}

/** 删除节点（需确认） */
async function onDelete(node: FsNode): Promise<void> {
  const ok = await confirm({
    type: 'warning',
    title: '删除确认',
    description: `确定删除${node.isDir ? '文件夹' : '文件'} "${node.name}" 吗？此操作不可撤销。`,
  })
  if (!ok) return
  try {
    await invoke('cmd_fs_delete', { path: node.path })
    await refresh()
  } catch (err) {
    console.warn('[WorkspacePanel] 删除失败:', err)
  }
}

/** 触发文件选择（上传） */
function onUpload(): void {
  fileInput.value?.click()
}

/** 上传文件：读取为文本后写入当前目录 */
async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !currentPath.value) return
  try {
    const content = await file.text()
    await invoke('cmd_fs_write', { path: joinPath(currentPath.value, file.name), content, createDirs: false })
    await refresh()
  } catch (err) {
    console.warn('[WorkspacePanel] 上传失败:', err)
  } finally {
    input.value = ''
  }
}

/** 预览文件内容（只读） */
async function previewFile(node: FsNode): Promise<void> {
  try {
    const content = await invoke<string>('cmd_fs_read', { path: node.path, encoding: 'utf-8' })
    preview.value = { name: node.name, content }
  } catch (err) {
    console.warn('[WorkspacePanel] 读取文件失败:', err)
  }
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(init)
// 会话切换（currentWorkdir 变化）时重新初始化工作区
watch(currentWorkdir, () => {
  void init()
})
</script>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-surface-elevated);
}

.wp-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.wp-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wp-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}

.wp-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.wp-action-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.wp-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: var(--font-size-xs);
  overflow-x: auto;
  scrollbar-width: none;
}
.wp-breadcrumb::-webkit-scrollbar {
  display: none;
}

.wp-crumb {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
}
.wp-crumb:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.wp-crumb.on {
  color: var(--color-primary);
  font-weight: 600;
}

.wp-crumb-sep {
  color: var(--color-text-tertiary);
  opacity: 0.6;
}

.wp-no-dir {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.wp-toolbar {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.wp-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.wp-tool-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.wp-file-input {
  display: none;
}

.wp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px;
}

.wp-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 24px;
  font-size: var(--font-size-xs);
}

.wp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  cursor: default;
  transition: background 0.1s;
}
.wp-row:hover {
  background: var(--color-surface);
}
.wp-row.active {
  background: var(--color-primary-muted);
}

.wp-toggle {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}
.wp-toggle.open {
  transform: rotate(90deg);
}

.wp-toggle-spacer {
  width: 16px;
  flex-shrink: 0;
}

.icon-folder {
  color: var(--color-primary);
  flex-shrink: 0;
}
.icon-file {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.wp-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
}
.wp-name:hover {
  color: var(--color-text);
}

.wp-size {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.wp-row-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}
.wp-row:hover .wp-row-actions {
  opacity: 1;
}

.wp-row-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wp-row-btn:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text);
}
.wp-row-btn.danger:hover {
  color: var(--danger);
}

/* ── 弹窗 ── */
.wp-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wp-modal {
  width: 360px;
  max-width: 90vw;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
}

.wp-modal-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}

.wp-modal-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wp-modal-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.wp-modal-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
}

.wp-input-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.wp-input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  outline: none;
}
.wp-input:focus {
  border-color: var(--color-primary);
}

.wp-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.wp-modal-btn {
  padding: 5px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.wp-modal-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.wp-modal-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-surface);
}
.wp-modal-btn.primary:hover {
  opacity: 0.9;
}

.wp-modal-content {
  width: 100%;
  height: 260px;
  padding: 10px;
  border: none;
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  resize: none;
  outline: none;
}
</style>
