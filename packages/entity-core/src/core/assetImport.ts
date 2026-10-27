/**
 * assetImport —— 形象/视频资产导入（2026-10-25 形象图批计划 §五）
 *
 * 与 imageAssets（apps 层，正文插图 2MB base64 链路）分流：本模块服务形象图/视频，
 * 大文件（模型可达 200MB、视频 1GB）不走 base64 IPC（内存放大 + IPC 超时），主链路为
 * 「plugin-dialog 选路径 → cmd_fs_copy 磁盘直拷」；拖拽/粘贴的 File 对象无磁盘路径
 * （dragDropEnabled:false，HTML5 拖拽拿不到 path），只能走 base64 兜底并受 30MB 硬上限，
 * 超限提示改用「选择文件」按钮。落盘同 `{entityDataDir}/assets/`（与素材面板同源）。
 *
 * resolveEntityDataDir 由 apps/tauri workspace.ts 下沉至此（单一真源，apps 侧改 re-export）。
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir, join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import type { PortraitKind } from '../types/entity'
import { getProjectManager } from './ProjectManager'

/** 资产类别：形象图四细分 + 视频（决定扩展名表 / 上限 / 落盘文件名前缀） */
export type AssetKind = PortraitKind | 'video'

/** 各类别接受的扩展名（对话框 filter 与 File 链路校验共用；apng 扩展名即 png 归 static，UI 可改判） */
export const ASSET_KIND_EXTS: Record<AssetKind, string[]> = {
  static: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'],
  animated: ['gif', 'webp', 'png'],
  lottie: ['json'],
  model: ['glb', 'gltf'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
}

/** 对话框 filter 展示名 */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  static: '静态图片',
  animated: '动态图（GIF/APNG/动态WebP）',
  lottie: 'Lottie 动画（JSON）',
  model: '3D 模型（GLB/GLTF）',
  video: '视频',
}

/** 各类别大小上限（字节） */
export const ASSET_KIND_LIMITS: Record<AssetKind, number> = {
  static: 10 * 1024 * 1024,
  animated: 30 * 1024 * 1024,
  lottie: 5 * 1024 * 1024,
  model: 200 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
}

/** File（base64 IPC）链路硬上限：超过只能走对话框路径直传 */
export const FILE_LINK_MAX_BYTES = 30 * 1024 * 1024

/** 资产目录名（与 imageAssets.ASSET_DIR_NAME 同源；apps 层不便反向依赖此处，双侧字面量一致） */
export const ASSET_DIR_NAME = 'assets'

/** 按文件名推断资产类别（gif 必动图优先；png/webp 静动同扩展归 static，误判可 UI 改判） */
export function detectAssetKind(filename: string): AssetKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'gif') return 'animated'
  if (ASSET_KIND_EXTS.static.includes(ext)) return 'static'
  if (ext === 'json') return 'lottie'
  if (ext === 'glb' || ext === 'gltf') return 'model'
  if (ASSET_KIND_EXTS.video.includes(ext)) return 'video'
  return null
}

/** cmd_fs_list 目录项形状（Rust fs_commands） */
export interface AssetDirEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modified?: string
}

/** 资产库条目（F1：跨实体复用已导入资产） */
export interface ProjectAssetInfo {
  path: string
  name: string
  size: number
  modified?: number
  kind: AssetKind
}

/** 落盘命名 `{kind}_{ts}_{rand}.{ext}` 的前缀优先（动图 webp/png 与静态同扩展，靠前缀区分） */
function kindFromAssetName(name: string): AssetKind | null {
  const prefix = name.split('_')[0] as AssetKind
  return Object.hasOwn(ASSET_KIND_EXTS, prefix) ? prefix : null
}

/** 目录项 → 资产库条目（类别并集过滤 + 类别判定 + mtime 降序；纯函数供单测） */
export function selectProjectAssets(entries: AssetDirEntry[], kinds: AssetKind[]): ProjectAssetInfo[] {
  const allowed = new Set(kinds)
  const exts = new Set(kinds.flatMap((k) => ASSET_KIND_EXTS[k]))
  return entries
    .filter((e) => !e.isDir)
    .flatMap((e) => {
      const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
      if (!exts.has(ext)) return []
      const prefixed = kindFromAssetName(e.name)
      const detected = detectAssetKind(e.name)
      const kind = prefixed && allowed.has(prefixed) ? prefixed : detected && allowed.has(detected) ? detected : null
      if (!kind) return []
      return [{ path: e.path, name: e.name, size: e.size, modified: e.modified ? Number(e.modified) : undefined, kind }]
    })
    .sort((a, b) => (b.modified ?? -1) - (a.modified ?? -1) || a.name.localeCompare(b.name))
}

/**
 * 文件头判动图（2026-10-25 形象图批 D3，走查确认项）：APNG=PNG 含 acTL chunk、
 * 动图 WebP=含 ANIM/ANMF chunk——两者扩展名与静态相同，detectAssetKind 归 static，
 * 上传后读本函数修正为 animated。只扫前 64KB（acTL 必在 IDAT 前，动 WebP 头部即 ANIM）。
 */
export function isAnimatedImageBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 64 * 1024)
  // PNG：89 50 4E 47 0D 0A 1A 0A，chunk 型 'acTL'
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return hasFourcc(head, [0x61, 0x63, 0x54, 0x4c]) // acTL
  }
  // WebP：'RIFF'...'WEBP'，动图 chunk 'ANIM'/'ANMF'
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // RIFF
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // WEBP
  ) {
    return hasFourcc(head, [0x41, 0x4e, 0x49, 0x4d]) || hasFourcc(head, [0x41, 0x4e, 0x4d, 0x46]) // ANIM / ANMF
  }
  return false
}

function hasFourcc(hay: Uint8Array, cc: number[]): boolean {
  outer: for (let i = 0; i + cc.length <= hay.length; i++) {
    for (let j = 0; j < cc.length; j++) {
      if (hay[i + j] !== cc[j]) continue outer
    }
    return true
  }
  return false
}

/** 读取已落盘资产的头部字节并判动图（fetch asset URL——静态图上限 10MB 内，全量读可接受） */
export async function isAnimatedAsset(assetUrl: string): Promise<boolean> {
  try {
    const buf = new Uint8Array(await (await fetch(assetUrl)).arrayBuffer())
    return isAnimatedImageBytes(buf)
  } catch {
    return false
  }
}

export interface AssetImportResult {
  ok: boolean
  /** 成功：convertFileSrc 绝对 URL（实体字段存它） */
  src?: string
  /** 成功：落盘绝对路径 */
  path?: string
  reason?: string
}

/** 是否为 Tauri 运行时（浏览器 preview 无 __TAURI_INTERNALS__）——与 apps workspace.ts 同判据 */
function isTauriRuntime(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/**
 * 解析工作台实体存储根（原 apps/tauri workspace.ts 实现，2026-10-25 下沉为单一真源）：
 * 默认项目 → `<home>/WorldSea/worlddata`；普通项目 → 项目目录本身；非 Tauri / 未就绪 → null。
 */
export async function resolveEntityDataDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const pm = getProjectManager()
    const project = pm.getCurrentProjectId() ? await pm.getCurrentProject() : undefined
    if (project?.isDefault) {
      return await join(await homeDir(), 'WorldSea', 'worlddata')
    }
    return await pm.getCurrentProjectDir()
  } catch {
    return null
  }
}

/** 列出资产库中指定类别的资产（目录不存在 / 项目未就绪 → 空数组，不抛错） */
export async function listProjectAssets(kinds: AssetKind[]): Promise<ProjectAssetInfo[]> {
  const root = await resolveEntityDataDir()
  if (!root) return []
  try {
    const entries = await invoke<AssetDirEntry[]>('cmd_fs_list', { path: `${root}/${ASSET_DIR_NAME}` })
    return selectProjectAssets(entries, kinds)
  } catch {
    return []
  }
}

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

/** 落盘目标路径（`{root}/assets/{kind}_{ts}_{rand}.{ext}`；确保 assets 目录存在） */
async function resolveDestPath(kind: AssetKind, ext: string): Promise<string | null> {
  const root = await resolveEntityDataDir()
  if (!root) return null
  const dir = `${root}/${ASSET_DIR_NAME}`
  try {
    await invoke('cmd_fs_mkdir', { path: dir })
  } catch {
    // 目录已存在/无权限：写拷贝环节会再报错，此处不重复拦
  }
  return `${dir}/${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
}

/**
 * 对话框选路径 → `cmd_fs_copy_progress` 磁盘直拷（大文件主链路，分块 + 进度事件，
 * 不经 base64 IPC）。用户取消对话框返回 ok:false（无 reason，静默）。
 * onProgress(copied, total) 供调用方渲染进度（批 C 走查：大视频静默导入无反馈）。
 */
export async function importAssetByDialog(
  kind: AssetKind,
  onProgress?: (copied: number, total: number) => void,
): Promise<AssetImportResult> {
  let picked: string | null = null
  try {
    const r = await open({
      multiple: false,
      filters: [{ name: ASSET_KIND_LABELS[kind], extensions: ASSET_KIND_EXTS[kind] }],
    })
    picked = typeof r === 'string' ? r : null
  } catch {
    return { ok: false, reason: '打开文件对话框失败' }
  }
  if (!picked) return { ok: false }
  return importAssetByPath(kind, picked, onProgress)
}

/** 路径直拷（cmd_fs_stat 校验大小 → cmd_fs_copy_progress 分块复制；src 须为磁盘文件路径） */
export async function importAssetByPath(
  kind: AssetKind,
  src: string,
  onProgress?: (copied: number, total: number) => void,
): Promise<AssetImportResult> {
  let size: number
  try {
    const stat = await invoke<{ size: number }>('cmd_fs_stat', { path: src })
    size = stat.size
  } catch {
    return { ok: false, reason: `读取「${src}」信息失败` }
  }
  const limit = ASSET_KIND_LIMITS[kind]
  if (size > limit) {
    return { ok: false, reason: `「${src}」超过${ASSET_KIND_LABELS[kind]} ${formatMb(limit)} 上限（${formatMb(size)}）` }
  }
  const dest = await resolveDestPath(kind, extOf(src))
  if (!dest) return { ok: false, reason: '项目目录未就绪，无法落盘' }
  // 进度事件按本任务 dest 过滤（多任务并发互不串扰）
  let unlisten: (() => void) | undefined
  if (onProgress) {
    try {
      const h = await listen<{ dest: string; copied: number; total: number }>('asset-copy-progress', (e) => {
        if (e.payload.dest === dest) onProgress(e.payload.copied, e.payload.total)
      })
      unlisten = h
    } catch {
      // 事件订阅失败：降级为无进度（不阻塞导入）
    }
  }
  try {
    await invoke('cmd_fs_copy_progress', { src, dest })
  } catch (err) {
    return { ok: false, reason: `「${src}」导入失败: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    unlisten?.()
  }
  return { ok: true, path: dest, src: convertFileSrc(dest) }
}

/**
 * File 对象导入（拖拽/粘贴兜底链路）：base64 经 `cmd_fs_write` 落盘——
 * 受 FILE_LINK_MAX_BYTES 硬上限（IPC 内存放大），超限引导用对话框直传。
 */
export async function importAssetByFile(kind: AssetKind, file: File): Promise<AssetImportResult> {
  const detected = detectAssetKind(file.name)
  if (detected !== kind) {
    return { ok: false, reason: `「${file.name}」不属于${ASSET_KIND_LABELS[kind]}可接受的格式` }
  }
  if (file.size > Math.min(ASSET_KIND_LIMITS[kind], FILE_LINK_MAX_BYTES)) {
    return {
      ok: false,
      reason: file.size > FILE_LINK_MAX_BYTES
        ? `「${file.name}」超过 ${formatMb(FILE_LINK_MAX_BYTES)}，请点「选择文件」按钮（支持大文件直传）`
        : `「${file.name}」超过${ASSET_KIND_LABELS[kind]} ${formatMb(ASSET_KIND_LIMITS[kind])} 上限`,
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let base64: string
  try {
    let bin = ''
    const CHUNK = 0x8000 // 分块拼接避免 String.fromCharCode 爆栈（与 imageAssets 同法）
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    base64 = btoa(bin)
  } catch {
    return { ok: false, reason: `「${file.name}」编码失败` }
  }
  const dest = await resolveDestPath(kind, extOf(file.name))
  if (!dest) return { ok: false, reason: '项目目录未就绪，无法落盘' }
  try {
    await invoke('cmd_fs_write', { path: dest, content: base64, createDirs: true, encoding: 'base64' })
  } catch (err) {
    return { ok: false, reason: `「${file.name}」落盘失败: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true, path: dest, src: convertFileSrc(dest) }
}
