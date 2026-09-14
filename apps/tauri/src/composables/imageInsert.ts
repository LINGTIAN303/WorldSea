/**
 * imageInsert —— 编辑器图片插入共享逻辑（笔记本 / 文稿两处编辑器复用）
 *
 * 图片来源两条路：
 * ① 工具栏按钮 → 隐藏 `<input type="file">` → 本模块校验后交给调用方插入；
 * ② 粘贴 / 拖拽（截图贴笔记是高频场景）→ 编辑器 `handlePaste` / `handleDrop`
 *    → `pickImageFiles` 过滤 → 本模块校验 + 插入。
 *
 * 存储策略（2026-09-14 资产目录化）：优先落盘项目资产目录
 * `{entityDataDir}/assets/`（见 imageAssets.ts），正文引用 convertFileSrc 绝对
 * URL；**落盘失败（非 Tauri / 项目未就绪 / 写入错误）回落 base64 data URL** ——
 * 功能不断链，行为与 MVP 一致。旧笔记里的 data URL 无需迁移，双格式天然兼容。
 * 2MB/张 上限两路同口径，超限明确 toast（不留静默）。
 */
import { toastWarn } from '@/composables/useToast'
import type { Editor } from '@tiptap/vue-3'
import { writeImageAsset } from './imageAssets'

/** 单张图片上限。base64 膨胀约 1.37 倍，2MB 原图 ≈ 2.7MB 字符 —— 实体 JSON 可承受 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** 从粘贴 / 拖拽数据里挑出图片文件 */
export function pickImageFiles(files: FileList | null | undefined): File[] {
  if (!files) return []
  return Array.from(files).filter(f => f.type.startsWith('image/'))
}

export interface ImageReadResult {
  ok: boolean
  /** 成功：data URL 或资产 URL；失败：人类可读原因 */
  src?: string
  reason?: string
}

/**
 * 校验类型与大小，读取为 data URL（降级路径；正常路径走 writeImageAsset 落盘）
 */
export function fileToImageDataUrl(file: File): Promise<ImageReadResult> {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) {
      resolve({ ok: false, reason: `「${file.name}」不是图片文件` })
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      resolve({ ok: false, reason: `「${file.name}」超过 2MB 上限（${(file.size / 1024 / 1024).toFixed(1)}MB）` })
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({ ok: true, src: String(reader.result) })
    reader.onerror = () => resolve({ ok: false, reason: `「${file.name}」读取失败` })
    reader.readAsDataURL(file)
  })
}

/**
 * 校验类型与大小，优先落盘项目资产目录（asset URL，正文体积友好）；
 * 落盘不可用 / 失败时回落 data URL（功能不断链）。两路校验同口径。
 */
export async function fileToImageSrc(file: File): Promise<ImageReadResult> {
  const r = await writeImageAsset(file)
  if (r.ok && r.src) return { ok: true, src: r.src }
  if (r.reason && !r.reason.includes('不是图片') && !r.reason.includes('上限')) {
    // 校验通过但落盘失败 → 回落 data URL；校验本身不通过 → 交给 data URL 路径给出统一文案
    console.warn('[imageInsert] 资产落盘失败，回落 data URL:', r.reason)
    return fileToImageDataUrl(file)
  }
  return fileToImageDataUrl(file)
}

/**
 * 批量插入图片（工具栏选择 / 粘贴 / 拖拽共用）。
 * 成功项逐张 `setImage`；被拒项汇总后**一次 toast**（不逐条轰炸）。
 * 返回成功张数（供调用方决定是否提示）。
 */
export async function insertImageFilesInto(editor: Editor | null | undefined, files: File[]): Promise<number> {
  if (!editor || files.length === 0) return 0
  let inserted = 0
  const rejected: string[] = []
  for (const file of files) {
    const r = await fileToImageSrc(file)
    if (r.ok && r.src) {
      editor.chain().focus().setImage({ src: r.src, alt: file.name }).run()
      inserted++
    } else if (r.reason) {
      rejected.push(r.reason)
    }
  }
  if (rejected.length) {
    toastWarn(rejected.join('；'))
  }
  return inserted
}
