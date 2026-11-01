<template>
  <div class="ftb">
    <!-- 后续目录导航：保留旧行，右下角 R1 角标（首载走骨架） -->
    <div v-if="treeLoading && treeLoaded" class="ftb-dir-indicator">
      <WsInlineLoading size="sm" label="正在载入目录" />
    </div>
    <!-- 头部：经典模式=标题行+面包屑（左栏/浮层，含资源管理器/刷新）；合并模式=面包屑+工具同一行（右栏两层头，2026-09-03 UI 改造，资源管理器/刷新上移面板头） -->
    <div class="ftb-header" :class="{ 'ftb-header--merged': mergedHeader }">
      <div v-if="!mergedHeader" class="ftb-title-row">
        <span class="ftb-title"><WsIcon name="folder" size="sm" /> {{ title }}</span>
        <div class="ftb-title-actions">
          <button class="ftb-action-btn" :class="{ on: viewMode === 'trash' }" :title="viewMode === 'trash' ? '返回目录树' : `回收站（${trashItems.length} 项，30 天自动清理）`" @click="toggleTrashView"><WsIcon name="trash" size="sm" /></button>
          <button class="ftb-action-btn" title="在系统文件资源管理器中打开项目目录" :disabled="!resolvedRoot" @click="openInExplorer"><WsIcon name="folder-open" size="sm" /></button>
          <button class="ftb-action-btn" title="刷新" @click="refresh"><WsIcon name="refresh" size="sm" /></button>
        </div>
      </div>
      <div v-if="rootPath" class="ftb-breadcrumb">
        <button class="ftb-crumb" :class="{ on: breadcrumbs.length === 0 }" title="工作区根目录" @click="openDir(rootPath)">
          <WsIcon name="home" size="xs" />
          <span v-if="rootBaseName">{{ rootBaseName }}</span>
        </button>
        <template v-for="(seg, i) in breadcrumbs" :key="i">
          <span class="ftb-crumb-sep">/</span>
          <button class="ftb-crumb" :class="{ on: i === breadcrumbs.length - 1 }" @click="openDir(breadcrumbPath(i))">
            {{ seg }}
          </button>
        </template>
      </div>
      <div v-else class="ftb-no-dir">未绑定项目目录</div>
      <!-- 合并模式：工具按钮收入头行右侧 -->
      <div v-if="currentPath && mergedHeader" class="ftb-toolbar">
        <button class="ftb-tool-btn" @click="openInput('newFile', currentPath)" :title="'新建文件'"><WsIcon name="file" size="xs" /><span>新建文件</span></button>
        <button class="ftb-tool-btn" @click="openInput('newFolder', currentPath)" :title="'新建文件夹'"><WsIcon name="folder" size="xs" /><span>新建文件夹</span></button>
        <button class="ftb-tool-btn" @click="onUpload" :title="'上传'"><WsIcon name="upload" size="xs" /><span>上传</span></button>
        <button v-if="isInsideTmp" class="ftb-tool-btn danger" @click="onClearTmp" title="删除临时区全部内容（含子 Agent 临时目录 sub-*），Agent 下次使用会自动重建"><WsIcon name="trash" size="xs" /><span>清空临时区</span></button>
      </div>
    </div>

    <!-- 工具栏（经典模式独立行）：新建文件/文件夹/上传（compact 时压缩为图标） -->
    <div v-if="currentPath && !mergedHeader" class="ftb-toolbar">
      <button class="ftb-tool-btn" @click="openInput('newFile', currentPath)" :title="'新建文件'"><WsIcon name="file" size="xs" /><span v-if="!compact">新建文件</span></button>
      <button class="ftb-tool-btn" @click="openInput('newFolder', currentPath)" :title="'新建文件夹'"><WsIcon name="folder" size="xs" /><span v-if="!compact">新建文件夹</span></button>
      <button class="ftb-tool-btn" @click="onUpload" :title="'上传'"><WsIcon name="upload" size="xs" /><span v-if="!compact">上传</span></button>
      <button v-if="isInsideTmp" class="ftb-tool-btn danger" @click="onClearTmp" title="删除临时区全部内容（含子 Agent 临时目录 sub-*），Agent 下次使用会自动重建"><WsIcon name="trash" size="xs" /><span v-if="!compact">清空临时区</span></button>
    </div>

    <!-- 回收站视图（三期「删除可逆化」）：还原 / 永久删除 / 清空 -->
    <div v-if="viewMode === 'trash'" class="ftb-body">
      <div class="ftb-trash-bar">
        <span class="ftb-trash-hint">回收站 · {{ trashItems.length }} 项 · 30 天后自动清理</span>
        <button
          v-if="trashItems.length"
          class="ftb-tool-btn danger"
          :disabled="trashBusy"
          @click="onTrashEmpty"
          title="永久删除全部回收站内容，不可撤销"
        ><WsIcon name="trash" size="xs" /><span>清空</span></button>
      </div>
      <div v-if="trashItems.length === 0" class="ftb-empty">回收站为空</div>
      <div v-for="item in trashItems" :key="item.id" class="ftb-row ftb-trash-row">
        <WsIcon :name="item.isDir ? 'folder' : 'file'" size="xs" class="icon-folder" />
        <span class="ftb-name" :title="item.originalPath">{{ item.name }}</span>
        <span class="ftb-trash-time">{{ new Date(item.deletedAt).toLocaleDateString() }}</span>
        <div class="ftb-row-actions">
          <button class="ftb-row-btn" title="还原到原位置" :disabled="trashBusy" @click.stop="onTrashRestore(item)"><WsIcon name="undo" size="xs" /></button>
          <button class="ftb-row-btn danger" title="永久删除（不可撤销）" :disabled="trashBusy" @click.stop="onTrashDelete(item)"><WsIcon name="trash" size="xs" /></button>
        </div>
      </div>
    </div>

    <!-- 目录树 -->
    <div v-else class="ftb-body">
      <div v-if="treeLoading && !treeLoaded" class="ftb-skeleton">
        <WsSkeleton
          v-for="n in 6"
          :key="n"
          variant="text"
          :lines="1"
          label="正在载入目录"
          :style="{ width: `${58 + (n % 4) * 10}%` }"
          :aria-hidden="n > 1 || undefined"
        />
      </div>
      <div v-else-if="treeLoaded && !treeLoading && flatNodes.length === 0" class="ftb-empty">工作区为空</div>
      <template v-else-if="treeLoaded">
      <div
        v-for="fn in flatNodes"
        :key="fn.node.path"
        class="ftb-row"
        :class="{ dir: fn.node.isDir, active: fn.node.path === currentPath, muted: fn.muted }"
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
        <WsIcon v-if="fn.node.isDir" name="folder" size="xs" class="icon-folder" />
        <FileIcon v-else :name="fn.node.name" class="icon-file" />
        <!-- 行内重命名（2026-09-03 UI 改造：弹窗→树行内编辑框，回车确认/Esc 或失焦提交取消逻辑见 confirmRename） -->
        <input
          v-if="renamingPath === fn.node.path"
          :ref="focusRenameInput"
          v-model="renameValue"
          class="ftb-rename-input"
          @click.stop
          @keydown.enter.prevent="confirmRename"
          @keydown.esc.prevent="cancelRename"
          @blur="confirmRename"
        />
        <button v-else class="ftb-name" :title="fn.node.path" @click="fn.node.isDir ? toggleNode(fn.node) : emit('select', fn.node)">
          {{ fn.node.name }}
        </button>
        <span
          v-if="fn.partition"
          class="ftb-part-chip"
          :class="fn.partition === 'tmp' ? 'p-tmp' : 'p-out'"
          :title="fn.partition === 'tmp' ? '临时区：Agent 全权，可自由创建与清理' : '成果区：收官产物'"
        >{{ fn.partition === 'tmp' ? '临时区' : '成果区' }}</span>
        <WsInlineLoading v-if="fn.node.loading" size="sm" label="正在载入目录" class="ftb-node-loading" />
        <span v-if="!fn.node.isDir" class="ftb-size">{{ formatSize(fn.node.size) }}</span>
        <div class="ftb-row-actions">
          <button v-if="fn.node.isDir" class="ftb-row-btn" title="在此新建文件" @click.stop="openInput('newFile', fn.node.path)"><WsIcon name="file" size="xs" /></button>
          <button class="ftb-row-btn" title="重命名" @click.stop="renameInline(fn.node)"><WsIcon name="edit" size="xs" /></button>
          <button class="ftb-row-btn danger" title="删除" @click.stop="onDelete(fn.node)"><WsIcon name="trash" size="xs" /></button>
        </div>
      </div>
      </template>
    </div>

    <!-- 输入弹窗（新建文件/文件夹/重命名）：统一 TuiModal 基座（2026-09-03 UI 改造，替换自绘模态） -->
    <TuiModal :show="!!inputDialog" :title="inputDialog?.title ?? ''" size="sm" @close="inputDialog = null">
      <template v-if="inputDialog">
        <label class="ftb-input-label">{{ inputDialog.label }}</label>
        <input v-model="inputDialog.value" class="ftb-input" :placeholder="inputDialog.placeholder" @keydown.enter="confirmInput" autofocus />
      </template>
      <template #footer>
        <TuiButton variant="ghost" @click="inputDialog = null">取消</TuiButton>
        <TuiButton variant="primary" @click="confirmInput">确定</TuiButton>
      </template>
    </TuiModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { FileIcon, TuiButton, WsIcon, WsSkeleton, WsInlineLoading, useAsyncTask, useConfirm } from '@worldsea/ui-kit'
import TuiModal from '../../components/ui/TuiModal.vue'
import { invoke } from '@/composables/transport'
import { resolveWorkspaceDir, ensureWorkspaceDir } from '@/composables/workspace'
import { useFileTrash, type FileTrashRecord } from '@/composables/fileTrash'
import { toastInfo, toastError } from '@/composables/useToast'
import { getFilePickerApi, hasFilePicker, baseNameOf } from '@worldsea/entity-core/core'

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
  /** 内部目录视觉弱化（entities 等：真实存储可见但低亮，2026-09-14 拍板「弱化不隐藏」） */
  muted?: boolean
}

/** 输入弹窗状态：新建文件/文件夹（重命名已改为树行内编辑，不走弹窗） */
interface InputDialog {
  title: string
  label: string
  placeholder: string
  value: string
  mode: 'newFile' | 'newFolder'
  base?: string
}

const props = withDefaults(
  defineProps<{
    /** 显式根目录；缺省回退 resolveWorkspaceDir() */
    rootPath?: string | null
    /** 是否窄栏压缩（左栏会话侧边栏内嵌时） */
    compact?: boolean
    /** 面板标题（右栏/左栏可自定义） */
    title?: string
    /** 合并头部模式：面包屑+工具同一行、无标题行（右栏两层头）；缺省经典模式（标题行+面包屑+独立工具行，左栏/浮层） */
    mergedHeader?: boolean
    /** 文件过滤器（素材面板等场景）：返回 false 的**文件**不显示，目录不受影响（保留导航） */
    fileFilter?: (name: string) => boolean
  }>(),
  { rootPath: null, compact: false, title: '项目目录', mergedHeader: false },
)
const emit = defineEmits<{ select: [node: FsNode] }>()

/** 暴露刷新（父级面板头刷新按钮调用；保留展开状态） */
defineExpose({ refresh })

const { confirm } = useConfirm()

const currentPath = ref<string | null>(null)
const rootChildren = ref<FsNode[]>([])
const { visible: treeLoading, run: runTreeLoad } = useAsyncTask({ successHold: 0 })
const treeLoaded = ref(false)
const inputDialog = ref<InputDialog | null>(null)
const resolvedRoot = ref<string | null>(props.rootPath)

// ── 文件回收站（三期「删除可逆化」）：删除 = 移入 {root}/.trash + 记账，30 天过期 ──
const fileTrash = useFileTrash(() => resolvedRoot.value)
const trashItems = ref<FileTrashRecord[]>([])
const viewMode = ref<'tree' | 'trash'>('tree')
const trashBusy = ref(false)

async function refreshTrash(): Promise<void> {
  await fileTrash.reload()
  trashItems.value = [...fileTrash.items()]
}

async function onTrashRestore(item: FileTrashRecord): Promise<void> {
  if (trashBusy.value) return
  trashBusy.value = true
  try {
    const dest = await fileTrash.restore(item.id)
    trashItems.value = [...fileTrash.items()]
    toastInfo(`已还原「${item.name}」`)
    if (viewMode.value === 'tree') await refresh()
    void dest
  } catch (err) {
    toastError(`还原失败：${String(err)}`)
  } finally {
    trashBusy.value = false
  }
}

async function onTrashDelete(item: FileTrashRecord): Promise<void> {
  if (trashBusy.value) return
  const ok = await confirm({
    type: 'warning',
    title: '永久删除确认',
    description: `将永久删除「${item.name}」，此操作不可撤销。确定继续？`,
  })
  if (!ok) return
  trashBusy.value = true
  try {
    await fileTrash.permanentDelete(item.id)
    trashItems.value = [...fileTrash.items()]
  } catch (err) {
    toastError(`删除失败：${String(err)}`)
  } finally {
    trashBusy.value = false
  }
}

async function onTrashEmpty(): Promise<void> {
  if (trashBusy.value || trashItems.value.length === 0) return
  const ok = await confirm({
    type: 'warning',
    title: '清空回收站',
    description: `将永久删除回收站内全部 ${trashItems.value.length} 项，此操作不可撤销。确定继续？`,
  })
  if (!ok) return
  trashBusy.value = true
  try {
    await fileTrash.empty()
    trashItems.value = [...fileTrash.items()]
  } catch (err) {
    toastError(`清空失败：${String(err)}`)
  } finally {
    trashBusy.value = false
  }
}

function toggleTrashView(): void {
  viewMode.value = viewMode.value === 'tree' ? 'trash' : 'tree'
  if (viewMode.value === 'trash') void refreshTrash()
}

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
      let muted: boolean | undefined
      if (root) {
        const rel = norm(node.path).slice(norm(root).length).replace(/^\/+/, '')
        const first = rel.split('/').filter(Boolean)[0]?.toLowerCase()
        partition = first === 'agent-tmp' ? 'tmp' : first === 'agent-out' ? 'out' : undefined
        // 回收站目录从树中隐藏（独立「回收站」视图承载，双入口只会造成混乱）
        if (depth === 0 && first === '.trash') continue
        // 实体存储目录弱化（真实存储格式可见但低亮，拍板：弱化不隐藏）
        muted = first === 'entities' ? true : undefined
        // 素材过滤（fileFilter）：仅过滤文件行，目录保留供导航（新建文件等操作不受影响）
        if (!node.isDir && props.fileFilter && !props.fileFilter(node.name)) continue
      }
      out.push({ node, depth, partition, muted })
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

/** 打开目录（更新 currentPath 并加载其条目）；首载走 R2 骨架，后续导航保留旧行避免跳动 */
async function openDir(path: string): Promise<void> {
  currentPath.value = norm(path)
  try {
    await runTreeLoad(async () => {
      rootChildren.value = await loadDir(norm(path))
      treeLoaded.value = true
    })
  } catch {
    /* loadDir 已兜底错误 */
  }
}

/** 展开/折叠目录节点（懒加载子条目）；展开状态按根路径持久化（面板折叠/重挂不丢，2026-09-07） */
async function toggleNode(node: FsNode): Promise<void> {
  if (!node.isDir) return
  if (node.expanded) {
    node.expanded = false
    persistExpanded(node.path, false)
    return
  }
  node.expanded = true
  persistExpanded(node.path, true)
  currentPath.value = norm(node.path)
  if (!node.loaded && !node.loading) {
    node.loading = true
    node.children = await loadDir(node.path)
    node.loading = false
    node.loaded = true
  }
}

/** 展开状态持久化（localStorage 按根路径隔离）：面板折叠/切 Tab 重挂后恢复展开记忆 */
function expandedStoreKey(): string {
  return `ws:tree-expanded:${resolvedRoot.value ?? ''}`
}

function persistExpanded(path: string, expanded: boolean): void {
  try {
    const key = expandedStoreKey()
    const set = new Set<string>(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
    const p = norm(path)
    if (expanded) set.add(p)
    else set.delete(p)
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    /* localStorage 不可用时静默降级（仅当前会话内记忆） */
  }
}

function readExpandedStore(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(expandedStoreKey()) ?? '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

/** 刷新当前目录：保留已展开目录的状态（2026-09-03 UI 改造，此前刷新会折叠整棵树） */
async function refresh(): Promise<void> {
  if (!resolvedRoot.value) return
  const expandedPaths = new Set<string>()
  collectExpanded(rootChildren.value, expandedPaths)
  rootChildren.value = await loadDir(currentPath.value ?? resolvedRoot.value)
  await restoreExpanded(rootChildren.value, expandedPaths)
}

/** 收集当前已展开目录的路径集合 */
function collectExpanded(nodes: FsNode[], acc: Set<string>): void {
  for (const n of nodes) {
    if (n.isDir && n.expanded) {
      acc.add(norm(n.path))
      if (n.children) collectExpanded(n.children, acc)
    }
  }
}

/** 恢复展开状态：逐层重载已展开目录的子条目（懒加载目录需重新拉取） */
async function restoreExpanded(nodes: FsNode[], expandedPaths: Set<string>): Promise<void> {
  for (const n of nodes) {
    if (!n.isDir || !expandedPaths.has(norm(n.path))) continue
    n.expanded = true
    if (!n.loaded) {
      n.loading = true
      n.children = await loadDir(n.path)
      n.loading = false
      n.loaded = true
    }
    if (n.children) await restoreExpanded(n.children, expandedPaths)
  }
}

/** 根目录基名（面包屑根节点显示，替代纯 home 图标） */
const rootBaseName = computed<string>(() => {
  if (!resolvedRoot.value) return ''
  const segs = norm(resolvedRoot.value).split('/').filter(Boolean)
  return segs[segs.length - 1] ?? ''
})

/** 文件类型图标：共享映射（fileIcons.ts，目录树/tab/预览头三处同源；2026-09-07 抽出） */

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

/** 初始化：解析根路径（props 显式根优先；缺省回落统一根/默认工作区） */
async function init(): Promise<void> {
  const wd = props.rootPath ?? (await resolveWorkspaceDir())
  if (!wd) {
    resolvedRoot.value = null
    currentPath.value = null
    rootChildren.value = []
    return
  }
  resolvedRoot.value = norm(wd)
  await openDir(resolvedRoot.value)
  // 恢复持久化的展开状态（面板折叠/重挂后不丢；逐层懒加载，2026-09-07）
  const saved = readExpandedStore()
  if (saved.size > 0) await restoreExpanded(rootChildren.value, saved)
}

/** 打开输入弹窗（新建文件/文件夹）；重命名走树行内编辑（renameInline） */
function openInput(mode: 'newFile' | 'newFolder', base?: string): void {
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

// ── 行内重命名（2026-09-03 UI 改造：弹窗→树行内编辑框） ──
const renamingPath = ref<string | null>(null)
const renameValue = ref('')
const renameOriginal = ref('')

/** 进入行内重命名：记录目标路径与原名，聚焦全选 */
function renameInline(target: FsNode): void {
  renamingPath.value = norm(target.path)
  renameValue.value = target.name
  renameOriginal.value = target.name
}

/** 函数 ref：重命名输入框渲染后聚焦并全选 */
function focusRenameInput(el: unknown): void {
  if (el) {
    const input = el as HTMLInputElement
    input.focus()
    input.select()
  }
}

/** 提交重命名（回车/失焦触发；Esc 先置空目标故此处自动跳过） */
async function confirmRename(): Promise<void> {
  const path = renamingPath.value
  if (!path) return
  const name = renameValue.value.trim()
  renamingPath.value = null
  if (!name || name === renameOriginal.value) return
  const dir = path.slice(0, path.lastIndexOf('/'))
  try {
    await invoke('cmd_fs_rename', { src: path, dest: joinPath(dir, name) })
    await refresh()
  } catch (err) {
    console.warn('[FileTreeBrowser] 重命名失败:', err)
  }
}

/** 取消行内重命名 */
function cancelRename(): void {
  renamingPath.value = null
  renameValue.value = ''
}

/** 输入弹窗确认（新建文件/文件夹） */
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
    }
    inputDialog.value = null
    await refresh()
  } catch (err) {
    console.warn('[FileTreeBrowser] 操作失败:', err)
  }
}

/** 删除节点（三期可逆化：默认移入回收站；移入失败才降级为确认后永久删除） */
async function onDelete(node: FsNode): Promise<void> {
  const ok = await confirm({
    type: 'warning',
    title: '删除确认',
    description: `确定删除${node.isDir ? '文件夹' : '文件'}「${node.name}」吗？将移入回收站（30 天后自动清理，可随时还原）。`,
  })
  if (!ok) return
  try {
    await fileTrash.moveToTrash(node.path, node.isDir)
    trashItems.value = [...fileTrash.items()]
    toastInfo(`已移入回收站：${node.name}`)
  } catch (err) {
    // 跨卷 / 占用等导致无法软删除：诚实降级为「确认后永久删除」，不静默失败
    const force = await confirm({
      type: 'warning',
      title: '无法移入回收站',
      description: `移入回收站失败（${String(err)}）。是否永久删除「${node.name}」？此操作不可撤销。`,
    })
    if (!force) return
    try {
      await invoke('cmd_fs_delete', { path: node.path })
    } catch (err2) {
      toastError(`删除失败：${String(err2)}`)
    }
  }
  await refresh()
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

/** 上传：自绘选择器选路径 → 磁盘直拷（原实现走 file.text()，二进制文件会被破坏） */
async function onUpload(): Promise<void> {
  if (!currentPath.value) return
  if (!hasFilePicker()) {
    toastError('文件选择器不可用（请使用桌面端）')
    return
  }
  const paths = await getFilePickerApi().pick({ mode: 'file', multiple: false, title: '上传文件到当前目录' })
  const src = paths?.[0]
  if (!src) return
  try {
    await invoke('cmd_fs_copy', { src, dest: joinPath(currentPath.value, baseNameOf(src)) })
    await refresh()
  } catch (err) {
    toastError(`上传失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(init)
// 根切换时重新初始化
watch(
  () => props.rootPath,
  () => void init(),
)
</script>

<style scoped src="./file-tree-browser.css"></style>
