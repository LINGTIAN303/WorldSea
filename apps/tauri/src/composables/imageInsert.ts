/**
 * imageInsert —— 编辑器图片插入共享逻辑（笔记本 / 文稿两处编辑器复用）
 *
 * 图片来源两条路：
 * ① 工具栏按钮 → 隐藏 `<input type="file">` → 本模块校验后交给调用方插入；
 * ② 粘贴 / 拖拽（截图贴笔记是高频场景）→ 编辑器 `handlePaste` / `handleDrop`
 *    → `pickImageFiles` 过滤 → 本模块校验 + 插入。
 *
 * 存储 MVP 决策：图片以 **base64 data URL** 直接进实体 `properties.content`
 * （编辑器尚未有图片资产目录 / 上传通路，这是最小可行方案）。代价是正文体积 ——
 * 故设 **2MB/张** 上限，超限明确 toast（不留静默）。资产目录化（随项目存文件 +
 * 引用相对路径）是后续挂账，届时 src 改为 `convertFileSrc` 即可，本模块的校验逻辑不变。
 */
import { toastWarn } from '@/composables/useToast'
import type { Editor } from '@tiptap/vue-3'

/** 单张图片上限。base64 膨胀约 1.37 倍，2MB 原图 ≈ 2.7MB 字符 —— 实体 JSON 可承受 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** 从粘贴 / 拖拽数据里挑出图片文件 */
export function pickImageFiles(files: FileList | null | undefined): File[] {
  if (!files) return []
  return Array.from(files).filter(f => f.type.startsWith('image/'))
}

export interface ImageReadResult {
  ok: boolean
  /** 成功：data URL；失败：人类可读原因 */
  src?: string
  reason?: string
}

/** 校验类型与大小，读取为 data URL */
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
 * 批量插入图片（工具栏选择 / 粘贴 / 拖拽共用）。
 * 成功项逐张 `setImage`；被拒项汇总后**一次 toast**（不逐条轰炸）。
 * 返回成功张数（供调用方决定是否提示）。
 */
export async function insertImageFilesInto(editor: Editor | null | undefined, files: File[]): Promise<number> {
  if (!editor || files.length === 0) return 0
  let inserted = 0
  const rejected: string[] = []
  for (const file of files) {
    const r = await fileToImageDataUrl(file)
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
