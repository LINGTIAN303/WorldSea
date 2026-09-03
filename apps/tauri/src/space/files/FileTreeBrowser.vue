<template>
  <div class="ftb">
    <!-- 顶部：标题 + 刷新 + 面包屑 -->
    <div class="ftb-header">
      <div class="ftb-title-row">
        <span class="ftb-title"><WsIcon name="folder" size="sm" /> {{ title }}</span>
        <div class="ftb-title-actions">
          <button class="ftb-action-btn" title="在系统文件资源管理器中打开项目目录" :disabled="!resolvedRoot" @click="openInExplorer"><WsIcon name="folder-open" size="sm" /></button>
          <button class="ftb-action-btn" title="刷新" @click="refresh"><WsIcon name="refresh" size="sm" /></button>
        </div>
      </div>
      <div v-if="rootPath" class="ftb-breadcrumb">
        <button class="ftb-crumb" :class="{ on: breadcrumbs.length === 0 }" title="工作区根目录" @click="openDir(rootPath)">
          <WsIcon name="home" size="xs" />
        </button>
        <template v-for="(seg, i) in breadcrumbs" :key="i">
          <span class="ftb-crumb-sep">/</span>
          <button class="ftb-crumb" :class="{ on: i === breadcrumbs.length - 1 }" @click="openDir(breadcrumbPath(i))">
            {{ seg }}
          </button>
        </template>
      </div>
      <div v-else class="ftb-no-dir">未绑定项目目录</div>
    </div>

    <!-- 工具栏：新建文件/文件夹/上传（compact 时压缩为图标） -->
    <div v-if="currentPath" class="ftb-toolbar">
      <button class="ftb-tool-btn" @click="openInput('newFile', currentPath)" :title="'新建文件'"><WsIcon name="file" size="xs" /><span v-if="!compact">新建文件</span></button>
      <button class="ftb-tool-btn" @click="openInput('newFolder', currentPath)" :title="'新建文件夹'"><WsIcon name="folder" size="xs" /><span v-if="!compact">新建文件夹</span></button>
      <button class="ftb-tool-btn" @click="onUpload" :title="'上传'"><WsIcon name="upload" size="xs" /><span v-if="!compact">上传</span></button>
      <button v-if="isInsideTmp" class="ftb-tool-btn danger" @click="onClearTmp" title="删除临时区全部内容（含子 Agent 临时目录 sub-*），Agent 下次使用会自动重建"><WsIcon name="trash" size="xs" /><span v-if="!compact">清空临时区</span></button>
      <input ref="fileInput" type="file" class="ftb-file-input" @change="onFilePicked" />
    </div>

    <!-- 目录树 -->
    <div class="ftb-body">
      <div v-if="loading" class="ftb-empty">加载中…</div>
      <div v-else-if="flatNodes.length === 0" class="ftb-empty">工作区为空</div>
      <div
        v-for="fn in flatNodes"
        :key="fn.node.path"
        class="ftb-row"
        :class="{ dir: fn.node.isDir, active: fn.node.path === currentPath }"
        :style="{ paddingLeft: fn.depth * 14 + 8 + 'px' }"
      >
        <button
          v-if="fn.node.isDir"
          class="ftb-toggle"
          :class="{ open: fn.node.expanded }"
          :aria-label="fn.node.expanded ? '折叠' : '展开'"
          @click.stop="toggleNode(fn.node)"
        ><WsIcon name="chevron-right" size="xs" /></button>
        <span v-else class="ftb-toggle-spacer"></span>
        <WsIcon :name="fn.node.isDir ? 'folder' : 'file'" size="xs" :class="fn.node.isDir ? 'icon-folder' : 'icon-file'" />
        <button class="ftb-name" :title="fn.node.path" @click="fn.node.isDir ? toggleNode(fn.node) : emit('select', fn.node)">
          {{ fn.node.name }}
        </button>
        <span
          v-if="fn.partition"
          class="ftb-part-chip"
          :class="fn.partition === 'tmp' ? 'p-tmp' : 'p-out'"
          :title="fn.partition === 'tmp' ? '临时区：Agent 全权，可自由创建与清理' : '成果区：收官产物'"
        >{{ fn.partition === 'tmp' ? '临时区' : '成果区' }}</span>
        <span v-if="!fn.node.isDir" class="ftb-size">{{ formatSize(fn.node.size) }}</span>
        <div class="ftb-row-actions">
          <button v-if="fn.node.isDir" class="ftb-row-btn" title="在此新建文件" @click.stop="openInput('newFile', fn.node.path)"><WsIcon name="file" size="xs" /></button>
          <button class="ftb-row-btn" title="重命名" @click.stop="openInput('rename', undefined, fn.node)"><WsIcon name="edit" size="xs" /></button>
          <button class="ftb-row-btn danger" title="删除" @click.stop="onDelete(fn.node)"><WsIcon name="trash" size="xs" /></button>
        </div>
      </div>
    </div>

    <!-- 输入弹窗（新建文件/文件夹/重命名） -->
    <div v-if="inputDialog" class="ftb-modal-backdrop" @click.self="inputDialog = null">
      <div class="ftb-modal">
        <div class="ftb-modal-header">
          <span class="ftb-modal-title">{{ inputDialog.title }}</span>
          <button class="ftb-modal-close" @click="inputDialog = null" title="关闭"><WsIcon name="close" size="sm" /></button>
        </div>
        <div class="ftb-modal-body">
          <label class="ftb-input-label">{{ inputDialog.label }}</label>
          <input v-model="inputDialog.value" class="ftb-input" :placeholder="inputDialog.placeholder" @keydown.enter="confirmInput" autofocus />
        </div>
        <div class="ftb-modal-footer">
          <button class="ftb-modal-btn" @click="inputDialog = null">取消</button>
          <button class="ftb-modal-btn primary" @click="confirmInput">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { WsIcon, useConfirm } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgent } from '@/agent/composables/useAgent'
import { resolveWorkspaceDir, ensureWorkspaceDir } from '../workspace'

/** 目录树节点（对应 cmd_fs_list 返回的 FsEntry camelCase 结构） */
export interface FsNode {
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

/** 扁平化后的树节点（带缩进深度与工作区分区标记） */
interface FlatNode {
  node: FsNode
  depth: number
  /** 工作区分区（agent-tmp=临时区 / agent-out=成果区；其余为 undefined） */
  partition?: 'tmp' | 'out'
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

const props = withDefaults(
  defineProps<{
    /** 显式根目录；缺省回退 currentWorkdir → resolveWorkspaceDir() */
    rootPath?: string | null
    /** 是否窄栏压缩（左栏会话侧边栏内嵌时） */
    compact?: boolean
    /** 面板标题（右栏/左栏可自定义） */
    title?: string
  }>(),
  { rootPath: null, compact: false, title: '项目目录' },
)
const emit = defineEmits<{ select: [node: FsNode] }>()

const { currentWorkdir } = useAgent()
const { confirm } = useConfirm()

const currentPath = ref<string | null>(null)
const rootChildren = ref<FsNode[]>([])
const loading = ref(false)
const fileInput = ref<HTMLInputElement>()
const inputDialog = ref<InputDialog | null>(null)
const resolvedRoot = ref<string | null>(props.rootPath)

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
  if (!resolvedRoot.value || !currentPath.value) return []
  const rel = norm(currentPath.value).slice(norm(resolvedRoot.value).length).replace(/^\/+/, '')
  return rel ? rel.split('/').filter(Boolean) : []
})

/** 生成第 index 个面包屑对应的完整路径 */
function breadcrumbPath(index: number): string {
  const segs = breadcrumbs.value.slice(0, index + 1)
  return joinPath(resolvedRoot.value!, ...segs)
}

/** 扁平化目录树（仅展示已展开节点的子孙） */
const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = []
  const root = resolvedRoot.value
  const walk = (nodes: FsNode[], depth: number): void => {
    for (const node of nodes) {
      // 工作区分区标记（M3：agent-tmp/agent-out 一级目录 chip 标注）
      let partition: 'tmp' | 'out' | undefined
      if (root) {
        const rel = norm(node.path).slice(norm(root).length).replace(/^\/+/, '')
        const first = rel.split('/').filter(Boolean)[0]?.toLowerCase()
        partition = first === 'agent-tmp' ? 'tmp' : first === 'agent-out' ? 'out' : undefined
      }
      out.push({ node, depth, partition })
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
    console.warn('[FileTreeBrowser] 列出目录失败:', err)
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
  if (!resolvedRoot.value) return
  await openDir(currentPath.value ?? resolvedRoot.value)
}

/** 在系统文件资源管理器中打开项目目录（2026-09-03 额外建议）
 *  注意：explorer.exe 对 `/` 分隔路径解析异常，需转回反斜杠（前端 norm 为 `/` 存储） */
async function openInExplorer(): Promise<void> {
  if (!resolvedRoot.value) return
  try {
    const nativePath = resolvedRoot.value.replace(/\//g, '\\')
    await invoke('cmd_open_in_explorer', { path: nativePath })
  } catch (err) {
    console.warn('[FileTreeBrowser] 打开系统文件夹失败:', err)
  }
}

/** 初始化：解析根路径（props 显式根优先；缺省回落 currentWorkdir → 统一根/默认工作区） */
async function init(): Promise<void> {
  const wd = props.rootPath ?? currentWorkdir.value ?? (await resolveWorkspaceDir())
  if (!wd) {
    resolvedRoot.value = null
    currentPath.value = null
    rootChildren.value = []
    return
  }
  resolvedRoot.value = norm(wd)
  await openDir(resolvedRoot.value)
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
    base: dir,
  }
}

/** 输入弹窗确认（新建文件/文件夹/重命名） */
async function confirmInput(): Promise<void> {
  const d = inputDialog.value
  if (!d) return
  const name = d.value.trim()
  if (!name) return
  try {
    if (d.mode === 'newFile') {
      await invoke('cmd_fs_write', { path: joinPath(d.base!, name), content: '', createDirs: false })
    } else if (d.mode === 'newFolder') {
      await invoke('cmd_fs_mkdir', { path: joinPath(d.base!, name) })
    } else if (d.mode === 'rename' && d.target) {
      const dir = d.target.slice(0, d.target.lastIndexOf('/'))
      await invoke('cmd_fs_rename', { src: d.target, dest: joinPath(dir, name) })
    }
    inputDialog.value = null
    await refresh()
  } catch (err) {
    console.warn('[FileTreeBrowser] 操作失败:', err)
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
    console.warn('[FileTreeBrowser] 删除失败:', err)
  }
}

/** 当前浏览路径是否位于 agent-tmp 临时区内（含其本身与子级）——决定「清空临时区」入口可见性 */
const isInsideTmp = computed<boolean>(() => {
  if (!resolvedRoot.value || !currentPath.value) return false
  const rel = norm(currentPath.value).slice(norm(resolvedRoot.value).length).replace(/^\/+/, '')
  const first = rel.split('/').filter(Boolean)[0]?.toLowerCase()
  return first === 'agent-tmp'
})

/** 清空临时区：确认后递归删除 {workdir}/agent-tmp 并重建空目录（Agent/子 Agent 下次使用自动写入） */
async function onClearTmp(): Promise<void> {
  if (!resolvedRoot.value) return
  const tmpPath = joinPath(resolvedRoot.value, 'agent-tmp')
  const ok = await confirm({
    type: 'warning',
    title: '清空临时区',
    description: `将删除 ${tmpPath} 下的全部内容（含子 Agent 临时目录 sub-*），并重建空临时区。确定继续？`,
  })
  if (!ok) return
  try {
    await invoke('cmd_fs_delete', { path: tmpPath })
    await ensureWorkspaceDir(tmpPath) // 重建空目录，保持临时区可见
    // 删除后当前路径可能已不存在：回到根目录刷新
    if (!/agent-tmp$/i.test(norm(currentPath.value ?? ''))) currentPath.value = resolvedRoot.value
    await refresh()
  } catch (err) {
    console.warn('[FileTreeBrowser] 清空临时区失败:', err)
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
    console.warn('[FileTreeBrowser] 上传失败:', err)
  } finally {
    input.value = ''
  }
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(init)
// 根/会话切换（workdir 变化）时重新初始化
watch(
  () => props.rootPath,
  () => void init(),
)
watch(currentWorkdir, () => {
  if (!props.rootPath) void init()
})
</script>

<style scoped>
.ftb {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-surface-elevated);
}

.ftb-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 6px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.ftb-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ftb-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}
.ftb-title-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ftb-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ftb-action-btn {
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
.ftb-action-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.ftb-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: var(--font-size-xs);
  overflow-x: auto;
  scrollbar-width: none;
}
.ftb-breadcrumb::-webkit-scrollbar {
  display: none;
}
.ftb-crumb {
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
.ftb-crumb:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.ftb-crumb.on {
  color: var(--color-primary);
  font-weight: 600;
}
.ftb-crumb-sep {
  color: var(--color-text-tertiary);
  opacity: 0.6;
}
.ftb-no-dir {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.ftb-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.ftb-tool-btn {
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
.ftb-tool-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
/* 危险操作（清空临时区）：红色描边/文字 */
.ftb-tool-btn.danger {
  color: #e5484d;
  border-color: rgba(229, 72, 77, 0.4);
}
.ftb-tool-btn.danger:hover {
  border-color: #e5484d;
  color: #e5484d;
}
.ftb-file-input {
  display: none;
}

.ftb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px 8px;
}
.ftb-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.ftb-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: default;
}
.ftb-row:hover {
  background: var(--color-surface);
}
.ftb-row.active {
  background: var(--color-primary-muted);
}
.ftb-toggle {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  padding: 0;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.ftb-toggle.open {
  transform: rotate(90deg);
}
.ftb-toggle-spacer {
  width: 16px;
  flex-shrink: 0;
}
.icon-folder {
  color: var(--color-text-secondary);
}
.icon-file {
  color: var(--color-text-tertiary);
}
.ftb-name {
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
.ftb-name:hover {
  color: var(--color-text);
}

/* 工作区分区 chip */
.ftb-part-chip {
  flex-shrink: 0;
  margin-left: 2px;
  padding: 0 6px;
  font-size: var(--font-size-2xs);
  line-height: 16px;
  border-radius: 3px;
  white-space: nowrap;
  user-select: none;
}
.ftb-part-chip.p-tmp {
  color: #6a9955;
  background: rgba(106, 153, 85, 0.12);
  border: 1px solid rgba(106, 153, 85, 0.35);
}
.ftb-part-chip.p-out {
  color: #e8a33d;
  background: rgba(232, 163, 61, 0.12);
  border: 1px solid rgba(232, 163, 61, 0.35);
}

.ftb-size {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.ftb-row-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}
.ftb-row:hover .ftb-row-actions {
  opacity: 1;
}
.ftb-row-btn {
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
  padding: 0;
}
.ftb-row-btn:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text);
}
.ftb-row-btn.danger:hover {
  color: #e5484d;
}

/* 输入弹窗 */
.ftb-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.ftb-modal {
  width: 280px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.ftb-modal-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}
.ftb-modal-title {
  flex: 1;
  font-size: var(--font-size-xs);
  font-weight: 600;
}
.ftb-modal-close {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.ftb-modal-close:hover {
  color: var(--color-text);
}
.ftb-modal-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ftb-input-label {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}
.ftb-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  outline: none;
}
.ftb-input:focus {
  border-color: var(--color-primary);
}
.ftb-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}
.ftb-modal-btn {
  padding: 5px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.ftb-modal-btn.primary {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.ftb-modal-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
</style>