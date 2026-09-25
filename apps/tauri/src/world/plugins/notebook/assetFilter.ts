/**
 * 素材面板支持格式（2026-09-14 拍板：文件 tab 重定位「素材面板」）
 *
 * 「笔记本芽所支持的格式」口径 = 芽内可消费，两族：
 * ① 图片 —— 可预览（FilePreview 的 image kind）且可插入正文（imageInsert，base64 进 content）；
 * ② 文档 —— 四渲染器可预览（docx/xlsx/pdf/pptx；ppt 由 LibreOffice 转换链承载，
 *    与 FilePreview 的 PPTX_EXT 同清单，含 ppt）。
 *
 * md/txt/code/html 等文本在芽内无消费行为（其预览走 Agent 空间右栏），按拍板过滤。
 * 清单与 FilePreview.vue 的 IMAGE_EXT / DOCX/XLSX/PDF/PPTX_EXT 对齐；
 * 不 import SFC 内部常量（组件未导出），此处独立维护并以单测锁定一致性口径。
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const DOC_EXTS = new Set(['docx', 'xlsx', 'pdf', 'pptx', 'ppt'])

/** 取小写扩展名（无点）；「.gitignore」这类点前缀名视为无扩展名 */
export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1).toLowerCase()
}

/** 是否素材面板支持的文件（FileTreeBrowser 的 fileFilter 与点击判定共用同一判据） */
export function isSupportedAsset(name: string): boolean {
  const e = fileExt(name)
  return IMAGE_EXTS.has(e) || DOC_EXTS.has(e)
}
