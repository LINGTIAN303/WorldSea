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
    const { resolveEntityDataDir } = await import('@/space/workspace')
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
