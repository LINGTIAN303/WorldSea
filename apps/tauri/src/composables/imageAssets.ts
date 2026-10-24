/**
 * imageAssets —— 图片资产目录化（2026-09-14，承接 e77dcae 的 MVP 挂账）
 *
 * MVP（imageInsert.ts）把图片以 base64 data URL 直接塞进实体 properties.content，
 * 代价是正文 JSON 体积（2MB 图 ≈ 2.7MB 字符）。本模块把图片改为落盘
 * `{entityDataDir}/assets/`（项目级，与素材面板 rootPath 同源 → 落盘即进
 * 面板视野，可预览可被 preview_file 推送），正文引用 `convertFileSrc` 绝对 URL。
 *
 * 【设计决策：正文存绝对 asset URL，而非相对路径】
 * convertFileSrc 产物可直接被编辑器 / PhonePreview / DOMPurify（http scheme
 * 默认放行）渲染 —— 渲染链零改动。代价：项目目录整体迁移后旧引用断链
 * （img 404，非致命）。相对路径方案需要在 Image 扩展 renderHTML / 各预览链
 * 做同步转换（entityDataDir 是异步解析），复杂度不成比例 —— 挂账「资产引用
 * 相对化 + 迁移工具」。
 *
 * 【旧 data URL 兼容】既有笔记正文里的 data URL 原样保留可渲染；导出 docx 时
 * 由 useManuscriptExport → resolveAssetImagesInHtml 统一把资产 URL 换回
 * data URL 再进纯函数导出链（htmlToDocxBlocks / blocksToDocx / imageData
 * 三层零改动，仍只认 data URL）。
 *
 * 【孤儿清理（2026-09-14 挂账落地）】assets/ 兼作素材库（用户手动放的未引用
 * 图不能被自动删）→ 不做自动惰性清理，改 NotebookView 素材 tab 显式按钮 +
 * confirm 列表。引用集 = 全部实体 properties 的 JSON 序列化（不限于笔记，
 * 文稿正文同样引用资产）；宽限期 24h 防「刚插入、正文仍在防抖窗口未落库」
 * 的竞态；mtime 未知一律不删（宁可漏删）。删除实体不联动清理：多实体共享
 * 同一图片时引用判定不划算，误删风险 > 收益。
 *
 * 【迁移 rebase · 2026-10-25 复核】正文存绝对 asset URL，项目目录整体迁移后旧引用断链
 * （img 404 非致命）。`rebaseAssetSrcs` 纯函数保留原 src 的平台前缀形态、仅重编码路径
 * （新绝对路径统一正斜杠，与 cmd_fs_list 口径一致）。
 * **当前没有生产调用点**——`useProjectSwitcher` 仍只有「目录匹配 / 基名新建」两条路，
 * 没有「项目目录失效重选」生命周期。本批决定：保留函数与测试并明确标注挂账，待项目
 * 迁移 / 重选立项时再接；在那之前**不要**在渲染链里临时调用（旧根未知，硬重写会误伤）。
 */

import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'

/** 资产目录名（落 {entityDataDir}/assets/） */
export const ASSET_DIR_NAME = 'assets'

/** 与 imageInsert.IMAGE_MAX_BYTES 同口径（单张 2MB 上限） */
export const ASSET_MAX_BYTES = 2 * 1024 * 1024

/** Windows: http://asset.localhost/<enc>；macOS/Linux: asset://localhost/<enc> */
const ASSET_URL_RE = /^(?:https?:\/\/asset\.localhost\/|asset:\/\/localhost\/)/

/** 是否为资产引用（convertFileSrc 产物）。data URL / 外部 http / 相对路径均非 */
export function isAssetSrc(src: string): boolean {
  return ASSET_URL_RE.test(src)
}

/**
 * asset URL → 磁盘绝对路径（URL 解码；Windows 路径编码后是 %3A%5C 等形态）。
 * 非资产 URL 返回 null。
 */
export function assetSrcToDiskPath(src: string): string | null {
  const m = ASSET_URL_RE.exec(src)
  if (!m) return null
  try {
    return decodeURIComponent(src.slice(m[0].length))
  } catch {
    return null
  }
}

/** 扩展名 → MIME（与 FilePreview IMAGE_EXT / assetFilter 口径一致） */
export function mimeFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    default: return ''
  }
}

/** 实体数据根（项目级目录；项目系统未就绪 / 非 Tauri 返回 null） */
async function resolveRoot(): Promise<string | null> {
  try {
    const { resolveEntityDataDir } = await import('@/composables/workspace')
    return await resolveEntityDataDir()
  } catch {
    return null
  }
}

export interface AssetWriteResult {
  ok: boolean
  /** 成功：convertFileSrc 绝对 URL（正文 src 用它） */
  src?: string
  /** 成功：落盘绝对路径 */
  path?: string
  reason?: string
}

/**
 * 把图片文件写入项目资产目录，返回可渲染 src。
 * 校验（类型 / 2MB）与 imageInsert 同口径；写盘失败返回 ok:false，
 * 由调用方决定回落 data URL（功能不断链）。
 */
export async function writeImageAsset(file: File): Promise<AssetWriteResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, reason: `「${file.name}」不是图片文件` }
  }
  if (file.size > ASSET_MAX_BYTES) {
    return { ok: false, reason: `「${file.name}」超过 2MB 上限（${(file.size / 1024 / 1024).toFixed(1)}MB）` }
  }
  const root = await resolveRoot()
  if (!root) return { ok: false, reason: '项目目录未就绪，无法落盘' }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let base64: string
  try {
    let bin = ''
    const CHUNK = 0x8000 // 分块拼接避免 String.fromCharCode 爆栈
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    base64 = btoa(bin)
  } catch {
    return { ok: false, reason: `「${file.name}」编码失败` }
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = `${root}/${ASSET_DIR_NAME}/${name}`

  try {
    await invoke('cmd_fs_write', { path, content: base64, createDirs: true, encoding: 'base64' })
  } catch (err) {
    return { ok: false, reason: `「${file.name}」落盘失败: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true, path, src: convertFileSrc(path) }
}

/**
 * 导出预处理：把 HTML 里所有资产 URL 替换回 data URL（docx 导出链只认 data URL）。
 * - 读取失败的 src 原样保留 → blocksToDocx 的显式占位降级自然接管（不留静默丢失）
 * - data URL / 外部 http 图不动
 * 纯 IO 编排；判定/还原逻辑见上方纯函数。
 */
export async function resolveAssetImagesInHtml(html: string): Promise<string> {
  if (!html || !html.includes('<img')) return html
  const srcs = new Set<string>()
  const srcRe = /<img\b[^>]*\bsrc="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = srcRe.exec(html))) {
    if (isAssetSrc(m[1])) srcs.add(m[1])
  }
  if (srcs.size === 0) return html

  let out = html
  for (const src of srcs) {
    const disk = assetSrcToDiskPath(src)
    if (!disk) continue
    try {
      const b64 = await invoke<string>('cmd_fs_read', { path: disk, encoding: 'base64' })
      const mime = mimeFromExt(disk) || 'image/png'
      out = out.split(src).join(`data:${mime};base64,${b64}`)
    } catch {
      // 读取失败：保留原 src，导出映射层占位降级
    }
  }
  return out
}

// ── 孤儿资产清理 + 迁移 rebase（2026-09-14 挂账落地，设计见文件头注释）──

/** 孤儿判定宽限期：mtime 早于 now-grace 且未被引用才算孤儿，防「刚插入、正文仍在防抖窗口未落库」的竞态误删 */
export const ASSET_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

export interface AssetFileInfo {
  path: string
  name: string
  size: number
  /** mtime（ms epoch）；缺失 = 未知 → 不满足宽限期，永不判孤儿 */
  modified?: number
}

/**
 * 资产引用扫描正则（JSON / HTML 文本通用）。前缀复用 ASSET_URL_RE 单源
 * （去掉 ^ 行首锚——扫描要匹配文本中任意位置的 URL）；路径部分已百分号编码，
 * 遇引号 / 尖括号 / 空白 / 反斜杠即终止（JSON 字符串边界、HTML 属性边界都
 * 不会误吞）。每次新建实例，避免 g 标志 lastIndex 跨调用残留。
 */
const ASSET_URL_SRC = ASSET_URL_RE.source.replace(/^\^/, '')

function assetScanRe(): RegExp {
  return new RegExp(`${ASSET_URL_SRC}[^"'<>\\s\\\\]+`, 'g')
}

/**
 * 从文本集合收集被引用资产的磁盘绝对路径（Set）。
 * 扫描源由调用方给：实体 properties 的 JSON.stringify 串（正文 content 与
 * 其他字段都可能带 img src）。非资产 URL / 解码失败自动跳过。
 */
export function collectAssetDiskPaths(texts: Iterable<string>): Set<string> {
  const refs = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    const re = assetScanRe()
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const disk = assetSrcToDiskPath(m[0])
      if (disk) refs.add(disk)
    }
  }
  return refs
}

/**
 * 孤儿判定（纯函数）：磁盘文件不在引用集内 且 mtime 早于 now-grace。
 * 两侧路径统一把 \ 归一为 / 再比对（asset URL 解码可能还原出反斜杠，
 * cmd_fs_list 产物恒为正斜杠）。Windows 盘符大小写差异不在此处理：
 * 引用与落盘同源于 resolveEntityDataDir，实际大小写一致；即使漏判也有
 * 24h 宽限 + confirm 列表兜底。
 */
export function findOrphanAssets(
  files: AssetFileInfo[],
  refs: Iterable<string>,
  nowMs: number,
  graceMs: number = ASSET_ORPHAN_GRACE_MS,
): AssetFileInfo[] {
  const cutoff = nowMs - graceMs
  const normRefs = new Set(Array.from(refs, (p) => p.replace(/\\/g, '/')))
  return files.filter((f) => {
    if (normRefs.has(f.path.replace(/\\/g, '/'))) return false
    if (f.modified === undefined) return false
    return f.modified <= cutoff
  })
}

/**
 * 迁移 rebase（纯函数）：项目目录 oldRoot → newRoot 时把正文里的资产 URL
 * 重写到新根。只改前缀命中 oldRoot 的资产引用，其余 src（data URL / 外链 /
 * 其他根）原样；保留原 src 的平台前缀形态（同一台机器迁移，平台不变），
 * 新绝对路径统一正斜杠。前缀边界精确到「oldRoot + /」，worldfoo 不会误判为
 * world 的子路径。
 *
 * @internal 当前仅测试使用；生产调用点待「项目目录失效重选」生命周期（见文件头
 * 2026-10-25 复核）。不要在渲染链里临时调用——旧根未知时硬重写会误伤。
 */
export function rebaseAssetSrcs(html: string, oldRoot: string, newRoot: string): string {
  if (!html || !html.includes('<img') || !oldRoot || !newRoot || oldRoot === newRoot) return html
  const normRoot = oldRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const normNew = newRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normRoot || !normNew) return html
  return html.replace(assetScanRe(), (src) => {
    const head = ASSET_URL_RE.exec(src)
    const disk = assetSrcToDiskPath(src)
    if (!head || !disk) return src
    const normDisk = disk.replace(/\\/g, '/')
    if (!normDisk.startsWith(normRoot + '/')) return src
    const rest = normDisk.slice(normRoot.length + 1)
    return `${src.slice(0, head[0].length)}${encodeURIComponent(`${normNew}/${rest}`)}`
  })
}

/** 列出资产目录下的文件（目录不存在 / 项目未就绪 → 空数组，不抛错） */
export async function listAssetFiles(root: string): Promise<AssetFileInfo[]> {
  try {
    const entries = await invoke<
      Array<{ name: string; path: string; isDir: boolean; size: number; modified?: string }>
    >('cmd_fs_list', { path: `${root}/${ASSET_DIR_NAME}` })
    return entries
      .filter((e) => !e.isDir)
      .map((e) => ({
        path: e.path,
        name: e.name,
        size: e.size,
        modified: e.modified ? Number(e.modified) : undefined,
      }))
  } catch {
    return []
  }
}

/** 逐个删除（cmd_fs_delete 文件 / 目录通用）；返回删除失败的路径（空数组 = 全部成功） */
export async function deleteOrphanAssets(paths: string[]): Promise<string[]> {
  const failed: string[] = []
  for (const p of paths) {
    try {
      await invoke('cmd_fs_delete', { path: p })
    } catch {
      failed.push(p)
    }
  }
  return failed
}
