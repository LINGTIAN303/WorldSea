/**
 * 自绘文件选择器的浏览/选择状态机（从 FilePickerHost.vue 抽出，避免单文件超行数门禁）。
 *
 * 职责：盘符与快捷位置加载、目录读取、历史前进后退、可编辑路径、过滤排序、
 * 虚拟窗口切片、选中集合与可确认判定、原生对话框兜底。视图层只做渲染与事件绑定。
 * 交互与令牌口径见 docs/details/注释/tauri/components/FilePickerHost.md
 */

import { computed, ref } from 'vue'
import { invoke } from '@/composables/transport'
import { resolveEntityDataDir } from '@worldsea/entity-core/core'
import type { FilePickerRequest } from '@worldsea/entity-core/core'
import { computeVirtualWindow } from '@worldsea/ui-kit/components/data/virtualWindow'
import { loadRecentDirs, pushRecentDir } from './filePickerRecent'
import {
  breadcrumbOf,
  formatBytes,
  isVisible,
  matchesQuery,
  normalizePath,
  overLimitReason,
  parentPath,
  sortEntries,
  type DriveEntry,
  type FsEntry,
  type QuickLocation,
} from '@/components/files/filePickerModel'
import { useFilePickerSelection } from './useFilePickerSelection'

/** 行高（虚拟窗口强依赖固定值，与样式 .fp-row 高度一致） */
export const ROW_HEIGHT = 30
/** 视口外多渲染的行数（快速滚动时不露白） */
const OVERSCAN = 6

/** 盘符介质类型中文说明 */
const DRIVE_KIND_LABELS: Record<string, string> = {
  fixed: '本地磁盘',
  removable: '可移动磁盘',
  network: '网络驱动器',
  cdrom: '光盘',
  ram: '内存盘',
  unknown: '驱动器',
}

/** 一行渲染数据：条目 + 超限原因 */
export interface PickerRow {
  entry: FsEntry
  index: number
  limit: string | null
}

export function useFilePickerBrowse(options: {
  /** 当前请求（null = 面板关闭） */
  request: () => FilePickerRequest | null
  /** 兑现结果（null = 取消） */
  settle: (paths: string[] | null) => void
}) {
  const drives = ref<DriveEntry[]>([])
  const quickLocations = ref<QuickLocation[]>([])
  /** 最近实际做出选择的目录（持久化；左轨独立分组） */
  const recentDirs = ref<string[]>(loadRecentDirs())
  const currentPath = ref('')
  const pathDraft = ref('')
  const entries = ref<FsEntry[]>([])
  const loadingList = ref(false)
  const listError = ref('')
  const focusIndex = ref(0)
  const scrollTop = ref(0)
  const viewportHeight = ref(400)
  const history = ref<string[]>([])
  const historyIndex = ref(-1)
  /** 当前目录内的名称过滤词（不递归；切换目录时清空） */
  const query = ref('')

  const isDirMode = computed(() => options.request()?.mode === 'directory')
  const multiple = computed(() => !isDirMode.value && !!options.request()?.multiple)

  /** 真实路径比较口径（大小写与分隔符归一） */
  function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false
    return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()
  }

  /** 路径所属盘符根（`D:/a/b` → `D:`）；非盘符路径返回空串 */
  function driveRootOf(path: string | null): string {
    if (!path) return ''
    const m = /^([A-Za-z]:)/.exec(normalizePath(path))
    return m ? m[1] : ''
  }

  function driveTitle(drive: DriveEntry): string {
    return `${drive.path}\n${DRIVE_KIND_LABELS[drive.kind] ?? DRIVE_KIND_LABELS.unknown}`
  }

  /** 加载盘符与快捷位置（任一失败静默降级为空，不影响主列表） */
  async function loadLocations(): Promise<void> {
    const { desktopDir, downloadDir, documentDir, pictureDir } = await import('@tauri-apps/api/path')
    const [driveList, desktop, download, document, picture, entityDir] = await Promise.all([
      invoke<DriveEntry[]>('cmd_fs_drives').catch(() => [] as DriveEntry[]),
      desktopDir().catch(() => ''),
      downloadDir().catch(() => ''),
      documentDir().catch(() => ''),
      pictureDir().catch(() => ''),
      resolveEntityDataDir().catch(() => null),
    ])
    drives.value = driveList
    const candidates: Array<QuickLocation | null> = [
      entityDir ? { id: 'entity', label: '项目数据', path: entityDir, icon: 'folder' } : null,
      desktop ? { id: 'desktop', label: '桌面', path: desktop, icon: 'monitor' } : null,
      download ? { id: 'download', label: '下载', path: download, icon: 'download' } : null,
      document ? { id: 'document', label: '文档', path: document, icon: 'file' } : null,
      picture ? { id: 'picture', label: '图片', path: picture, icon: 'image' } : null,
    ]
    quickLocations.value = candidates.filter((c): c is QuickLocation => c !== null)
  }

  /** 读取目录（不含递归；失败保留错误信息供重试） */
  async function loadDir(path: string): Promise<void> {
    if (!path) return
    loadingList.value = true
    listError.value = ''
    try {
      const list = await invoke<FsEntry[]>('cmd_fs_list', { path, recursive: false })
      entries.value = Array.isArray(list) ? list : []
    } catch (err) {
      entries.value = []
      listError.value = `无法读取该目录：${err instanceof Error ? err.message : String(err)}`
    } finally {
      loadingList.value = false
      scrollTop.value = 0
    }
  }

  /** 导航到指定路径（记入历史；选中清空） */
  function navigate(path: string): void {
    const target = normalizePath(path)
    if (!target) return
    currentPath.value = target
    pathDraft.value = target
    resetSelection()
    query.value = ''
    // 截断前进历史（浏览器语义）
    history.value = [...history.value.slice(0, historyIndex.value + 1), target]
    historyIndex.value = history.value.length - 1
    void loadDir(target)
  }

  /** 历史跳转（不追加新记录） */
  async function jumpToHistory(path: string): Promise<void> {
    currentPath.value = path
    pathDraft.value = path
    resetSelection()
    query.value = ''
    await loadDir(path)
  }

  function goBack(): void {
    if (historyIndex.value <= 0) return
    historyIndex.value--
    void jumpToHistory(history.value[historyIndex.value])
  }

  function goForward(): void {
    if (historyIndex.value >= history.value.length - 1) return
    historyIndex.value++
    void jumpToHistory(history.value[historyIndex.value])
  }

  const canGoUp = computed(() => parentPath(currentPath.value) !== null)

  function goUp(): void {
    const up = parentPath(currentPath.value)
    if (up) navigate(up)
  }

  function reload(): void {
    if (currentPath.value) void loadDir(currentPath.value)
  }

  /** 手输路径回车跳转（`D:\a\b` 与 `C:/` 两种写法都认） */
  function commitPathDraft(): void {
    const draft = pathDraft.value.trim()
    if (draft) navigate(draft)
  }

  function resetPathDraft(): void {
    pathDraft.value = currentPath.value
  }

  /* ── 列表与虚拟窗口 ── */

  /** 可见条目：无搜索词时目录恒可见（保证可导航）+ 扩展名过滤；有搜索词时目录也按名称过滤 */
  const visibleEntries = computed(() => {
    const q = query.value.trim()
    return sortEntries(
      entries.value.filter((e) => {
        if (q) return matchesQuery(e.name, q)
        return isVisible(e, options.request()?.filters)
      }),
    )
  })

  /* ── 选择与键盘（语义集中在 useFilePickerSelection） ── */

  const selection = useFilePickerSelection({
    visible: visibleEntries,
    request: options.request,
    isDirMode,
    multiple,
    currentPath,
    focusIndex,
  })

  const {
    selected, rangeAnchor, summary, overLimitCount, canConfirm,
    onRowClick: applyRowClick, moveFocus, focusSelect, selectAll, clearSelection, resetSelection,
  } = selection

  const rows = computed<PickerRow[]>(() => {
    const all = visibleEntries.value
    const { start, end } = computeVirtualWindow(
      all.length,
      scrollTop.value,
      viewportHeight.value,
      ROW_HEIGHT,
      OVERSCAN,
    )
    const maxBytes = options.request()?.maxBytes
    const out: PickerRow[] = []
    for (let i = start; i < end; i++) {
      const entry = all[i]
      out.push({ entry, index: i, limit: overLimitReason(entry, maxBytes) })
    }
    return out
  })

  function onScroll(el: HTMLElement): void {
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight || viewportHeight.value
  }

  /** 面包屑（无显式根：从盘符展开，便于跨盘跳转） */
  const crumbs = computed(() => breadcrumbOf(currentPath.value))

  /** 键盘回车：进目录，或对焦点文件确认 */
  function focusEnter(): void {
    const entry = visibleEntries.value[focusIndex.value]
    if (!entry) return
    if (entry.isDir) return void navigate(entry.path)
    const limit = overLimitReason(entry, options.request()?.maxBytes)
    // 未选中则先选中（双击文件的同义语义），已选中则直接确认
    if (!selected.value.has(entry.path)) applyRowClick({ entry, index: focusIndex.value, limit })
    else if (!limit) confirm()
  }

  function confirm(): void {
    if (!canConfirm.value) return
    const paths = isDirMode.value ? [currentPath.value] : [...selected.value]
    // 记一次「最近目录」：目录模式记选中目录，文件模式记文件所在目录
    const remembered = isDirMode.value ? currentPath.value : parentPath(paths[0] ?? '') ?? currentPath.value
    if (remembered) recentDirs.value = pushRecentDir(remembered)
    options.settle(paths.map(normalizePath))
  }

  function onRowDblClick(row: PickerRow): void {
    if (row.entry.isDir) navigate(row.entry.path)
    else if (!row.limit) confirm()
  }

  /** 每次新请求进来：重置状态并按 defaultPath 起步（不可读则回落首个快捷位置/盘符） */
  async function reset(defaultPath?: string | null): Promise<void> {
    resetSelection()
    scrollTop.value = 0
    listError.value = ''
    query.value = ''
    history.value = []
    historyIndex.value = -1
    await loadLocations()
    const start = defaultPath || quickLocations.value[0]?.path || drives.value[0]?.path || ''
    if (start) navigate(start)
    else {
      currentPath.value = ''
      pathDraft.value = ''
      entries.value = []
    }
  }

  /**
   * 原生兜底：网络位置、OneDrive 云端占位、超长路径等自绘难以完整覆盖的场景由系统对话框逃生。
   * 结果同样按正斜杠返回。
   */
  async function useNativeDialog(): Promise<void> {
    const request = options.request()
    if (!request) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        directory: request.mode === 'directory',
        multiple: request.mode === 'directory' ? false : !!request.multiple,
        title: request.title,
        defaultPath: request.defaultPath ?? currentPath.value ?? undefined,
        filters: request.mode === 'directory' ? undefined : request.filters,
      })
      if (picked === null || picked === undefined) return
      const list = Array.isArray(picked) ? picked : [picked]
      const paths = list.filter((p): p is string => typeof p === 'string').map(normalizePath)
      options.settle(paths.length ? paths : null)
    } catch (err) {
      listError.value = `系统对话框失败：${err instanceof Error ? err.message : String(err)}`
    }
  }

  return {
    // 数据
    drives,
    quickLocations,
    recentDirs,
    currentPath,
    pathDraft,
    query,
    entries,
    loadingList,
    listError,
    selected,
    focusIndex,
    history,
    historyIndex,
    // 派生
    isDirMode,
    multiple,
    canGoUp,
    visibleEntries,
    rows,
    crumbs,
    summary,
    overLimitCount,
    canConfirm,
    // 动作
    navigate,
    goBack,
    goForward,
    goUp,
    reload,
    commitPathDraft,
    resetPathDraft,
    onScroll,
    onRowClick: applyRowClick,
    onRowDblClick,
    confirm,
    reset,
    useNativeDialog,
    // 键盘导航
    rangeAnchor,
    moveFocus,
    focusSelect,
    focusEnter,
    selectAll,
    clearSelection,
    // 工具
    samePath,
    driveRootOf,
    driveTitle,
    formatBytes,
  }
}
