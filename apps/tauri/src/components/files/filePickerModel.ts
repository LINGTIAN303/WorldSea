/**
 * 自绘文件选择器的纯逻辑（路径归一 / 面包屑 / 排序 / 过滤 / 超限判定）。
 * 与 DOM 和 Tauri 无关，供 FilePickerHost.vue 与单测共用。
 * 设计意图见 docs/details/注释/packages/entity-core/core/FilePickerApi.md
 */

import type { FilePickerFilter } from '@worldsea/entity-core/core'

/** 目录项（cmd_fs_list 的 camelCase 形状） */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  /** unix 毫秒字符串（元数据不可用时缺省） */
  modified?: string | null
}

/** 快捷位置（左侧轨） */
export interface QuickLocation {
  id: string
  label: string
  path: string
  /** 图标名（WsIcon 名称） */
  icon: string
}

/** 盘符条目（cmd_fs_drives 形状） */
export interface DriveEntry {
  name: string
  path: string
  /** fixed / removable / network / cdrom / ram / unknown */
  kind: string
}

/** 归一为正斜杠、折叠重复分隔符、去尾部（根除外） */
export function normalizePath(path: string): string {
  const posix = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (posix.length > 1 && posix.endsWith('/')) return posix.replace(/\/+$/, '')
  return posix
}

/** 判断是否为 Windows 盘符根（`C:` / `C:/`） */
export function isDriveRoot(path: string): boolean {
  return /^[A-Za-z]:$/.test(normalizePath(path))
}

/** 判断是否为 POSIX 根 */
export function isPosixRoot(path: string): boolean {
  return normalizePath(path) === '/'
}

/** 上级目录；已在根返回 null（Win32 盘符根与 POSIX 根都算顶） */
export function parentPath(path: string): string | null {
  const p = normalizePath(path)
  if (isPosixRoot(p) || isDriveRoot(p)) return null
  const idx = p.lastIndexOf('/')
  if (idx < 0) return null
  if (idx === 0) return '/'
  return p.slice(0, idx)
}

/** 拼接路径段（忽略空段；绝对段会覆盖前缀由调用方保证） */
export function joinPath(base: string, ...segments: string[]): string {
  const parts = [normalizePath(base), ...segments.map(normalizePath)].filter(Boolean)
  return normalizePath(parts.join('/'))
}

/**
 * 面包屑：给定路径与可选根，逐级返回 [{ label, path }]（含根自身）。
 * 有根且路径在根内时以根为首项；否则按绝对路径从头展开（`D:` 或 `/` 作首项）。
 */
export function breadcrumbOf(path: string, base?: string | null): Array<{ label: string; path: string }> {
  const target = normalizePath(path)
  const root = base ? normalizePath(base) : ''
  // 在根内：裁掉根前缀，省去重复的上级导航
  if (root && (target === root || target.startsWith(`${root}/`))) {
    const rest = target.slice(root.length).split('/').filter(Boolean)
    return [
      { label: baseNameOf(root), path: root },
      ...rest.map((seg, i) => ({ label: seg, path: `${root}/${rest.slice(0, i + 1).join('/')}` })),
    ]
  }
  const segments = target.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = []
  let cursor = ''
  for (const seg of segments) {
    // 盘符段（`D:`）作为首项时路径不带尾斜杠；其余段逐级累积
    cursor = cursor ? `${cursor}/${seg}` : seg
    crumbs.push({ label: seg, path: normalizePath(cursor) })
  }
  if (isPosixRoot(target)) return [{ label: '/', path: '/' }]
  return crumbs
}

/** 路径末段 */
export function baseNameOf(path: string): string {
  const p = normalizePath(path)
  if (isPosixRoot(p)) return '/'
  const idx = p.lastIndexOf('/')
  const name = idx >= 0 ? p.slice(idx + 1) : p
  // 盘符根 `C:` 的末段保持 `C:`
  return name || p
}

/** 扩展名（小写、无点） */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 名称是否满足过滤器（过滤器为空 = 全通过） */
export function matchesFilters(name: string, filters?: FilePickerFilter[]): boolean {
  if (!filters || filters.length === 0) return true
  const ext = extensionOf(name)
  const allowed = new Set(filters.flatMap(f => f.extensions.map(e => e.toLowerCase())))
  return allowed.has(ext)
}

/** 名称是否命中搜索词（大小写不敏感的子串匹配；空查询恒通过） */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

/** 扩展名 → 中文类型名（列表「类型」列；未知显示 `扩展名 文件`） */
const TYPE_LABELS: Record<string, string> = {
  md: 'Markdown 源文件',
  markdown: 'Markdown 源文件',
  txt: '文本文档',
  json: 'JSON 文件',
  yaml: 'YAML 文件',
  yml: 'YAML 文件',
  png: 'PNG 图片',
  jpg: 'JPEG 图片',
  jpeg: 'JPEG 图片',
  gif: 'GIF 图片',
  webp: 'WebP 图片',
  svg: 'SVG 矢量图',
  bmp: 'BMP 图片',
  mp4: 'MP4 视频',
  webm: 'WebM 视频',
  mov: 'QuickTime 视频',
  m4v: 'M4V 视频',
  glb: 'GLB 模型',
  gltf: 'glTF 模型',
  ttf: 'TrueType 字体',
  otf: 'OpenType 字体',
  woff: 'WOFF 字体',
  woff2: 'WOFF2 字体',
  zip: '压缩文件',
  pdf: 'PDF 文档',
}

/** 类型列文案（目录返回「文件夹」） */
export function typeLabelOf(entry: FsEntry): string {
  if (entry.isDir) return '文件夹'
  const ext = extensionOf(entry.name)
  if (!ext) return '文件'
  return TYPE_LABELS[ext] ?? `${ext.toUpperCase()} 文件`
}

/** 条目是否受当前过滤器可见（目录恒可见，保证可导航） */
export function isVisible(entry: FsEntry, filters?: FilePickerFilter[]): boolean {
  if (entry.isDir) return true
  return matchesFilters(entry.name, filters)
}

/** 超限原因（未超限或未设上限返回 null） */
export function overLimitReason(entry: FsEntry, maxBytes?: number): string | null {
  if (!maxBytes || entry.isDir || entry.size <= maxBytes) return null
  return `超过 ${formatBytes(maxBytes)} 上限`
}

/** 字节 → 人类可读（选择器行内与状态栏共用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** 排序键：目录优先，然后按名称本地化比较 */
export function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.isDir ? -1 : 1,
  )
}

/**
 * Shift 范围选择的区间（闭区间，已 clamp 到合法下标）。
 * @returns 落在 [lo, hi] 内的条目下标；空列表返回 null
 */
export function rangeWindow(total: number, from: number, to: number): { lo: number; hi: number } | null {
  if (total <= 0) return null
  const a = Math.max(0, Math.min(total - 1, from))
  const b = Math.max(0, Math.min(total - 1, to))
  return { lo: Math.min(a, b), hi: Math.max(a, b) }
}

/**
 * 键盘移动后的焦点下标（clamp 到列表边界）。
 * @param delta 正数向下、负数向上
 */
export function moveFocusIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, current + delta))
}

/** 可出缩略图的扩展名（浏览器能直接解码的位图；svg 与字体等不出缩略图） */
const THUMBNAIL_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'apng'])

/** 该条目是否可生成缩略图（仅文件，且扩展名在可解码位图集合内） */
export function canThumbnail(entry: FsEntry): boolean {
  if (entry.isDir) return false
  return THUMBNAIL_EXTS.has(extensionOf(entry.name))
}

/** 路径所属盘符根（`D:/a/b` → `D:`）；非盘符路径返回空串 */
export function driveRootOf(path: string | null): string {
  if (!path) return ''
  const p = normalizePath(path)
  // 盘符形如 `D:`（后跟 `/` 或到头）；逐字符校验避免正则误伤网络路径
  if (p.length >= 2 && /^[A-Za-z]$/.test(p[0]) && p[1] === ':') return p.slice(0, 2)
  return ''
}

/** 盘符介质类型中文说明 */
const DRIVE_KIND_LABELS: Record<string, string> = {
  fixed: '本地磁盘',
  removable: '可移动磁盘',
  network: '网络驱动器',
  cdrom: '光盘',
  ram: '内存盘',
  unknown: '驱动器',
}

/** 盘符悬浮提示（路径 + 介质类型） */
export function driveTitle(drive: DriveEntry): string {
  return `${drive.path}\n${DRIVE_KIND_LABELS[drive.kind] ?? DRIVE_KIND_LABELS.unknown}`
}

/* ════════════════════════════════════════
   视图模式与网格布局
   ════════════════════════════════════════ */

/** 视图模式：详细信息列表 / 缩略图网格 */
export type PickerViewMode = 'list' | 'grid'

/** 网格布局常量（与 .fp-cell 系列样式保持同步） */
export const GRID = {
  /** 单格总宽（含内边距） */
  CELL_W: 104,
  /** 单格总高：96 缩略图区 + 22 文件名行 + 4 上下间距 */
  CELL_H: 122,
} as const

/** 按容器内容宽度算每行列数（至少 1，避免除零与负宽） */
export function gridColumns(containerWidth: number): number {
  return Math.max(1, Math.floor(Math.max(0, containerWidth) / GRID.CELL_W))
}

/** 网格虚拟化的总行数（条目按行折算） */
export function gridRowCount(itemCount: number, cols: number): number {
  if (itemCount <= 0 || cols <= 0) return 0
  return Math.ceil(itemCount / cols)
}

/**
 * 网格下的键盘位移量（↑↓ 跨一整行，←→ 邻格）。
 * 列表模式不用此函数（↑↓ = ±1）。
 */
export function gridFocusDelta(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', cols: number): number {
  switch (key) {
    case 'ArrowLeft': return -1
    case 'ArrowRight': return 1
    case 'ArrowUp': return -cols
    case 'ArrowDown': return cols
  }
}

/** 修改时间显示（无值返回 `—`） */export function formatModified(modified?: string | null): string {
  if (!modified) return '—'
  const ms = Number(modified)
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 选中路径集合的统计（数量 + 总字节；目录不计体积） */
export function selectionSummary(
  entries: FsEntry[],
  selected: Set<string>,
): { count: number; totalBytes: number } {
  let count = 0
  let totalBytes = 0
  for (const entry of entries) {
    if (!selected.has(entry.path)) continue
    count++
    if (!entry.isDir) totalBytes += entry.size
  }
  return { count, totalBytes }
}
