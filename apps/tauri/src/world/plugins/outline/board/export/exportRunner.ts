/**
 * export/exportRunner —— 导出执行器：把导出 IR 变成可下载文件
 *
 * 【docx 复用既有链路】项目里 docx 导出的架构是
 * 「HTML → IR（`htmlToDocxBlocks`）→ docx 对象（`blocksToDocx`）→ Blob」，
 * 与 manuscript 芽共用。本文件把白板导出器产出的 HTML 直接喂入同一条链，
 * 故 **docx 与 markdown 的规则天然一致**（同一份 IR 的两个序列化产物），
 * 且零新增依赖。
 *
 * 【跨芽引用点收敛】这两个模块目前位于 manuscript 芽内。为不牵动另一条工作线，
 * 本文件**是唯一的跨芽引用点**——将来把它们下沉到 app 共享位置（`@/composables/`）时
 * 只需改这里（挂账登记见施工分解 §十二）。
 *
 * 【为什么跳过资产图片预处理】manuscript 导出会先把 `convertFileSrc` 绝对 URL 换回 data URL；
 * 大纲导出的产物只含标题/摘要/表格（**不含图片**），故不做这一步（省一次 IO 与失败面）。
 */
/** 导出格式（UI 与执行器共用） */
export type ExportFormat = 'md' | 'docx'

/** 触发浏览器下载（与 manuscript 的 downloadBlob 同形态，避免两条下载实现） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadText(content: string, filename: string, mimeType = 'text/plain'): void {
  downloadBlob(new Blob([content], { type: `${mimeType};charset=utf-8` }), filename)
}

/** 文件名安全化（与 manuscript `exportChapter` 同规则：去掉非法字符） */
export function safeFileName(name: string, fallback = '大纲'): string {
  const cleaned = (name ?? '').trim().replace(/[/\\?%*:|"<>]/g, '_')
  return cleaned || fallback
}

/**
 * 导出 HTML → docx Blob。
 *
 * 输入用 HTML 而不是直接构造 docx IR：docx 链路的解析层（`htmlToDocxBlocks`）已覆盖
 * heading / paragraph / table / ul 全部所需结构，直接复用可**少一份 IR→IR 映射**
 * （那正是最容易悄悄写错的地方），且保证「HTML 预览所见 = docx 所得」。
 * 调用方本来就有 `result.html`，无额外序列化成本。
 *
 * 字体取「预览字体 → 内容字体 → 微软雅黑」，与 manuscript 导出一致，避免同项目两种字体。
 */
export async function htmlToDocxBlob(html: string, title: string): Promise<Blob> {
  const [{ htmlToBlocks }, { buildDocxBlob }, { useFontStore }] = await Promise.all([
    import('@/world/plugins/manuscript/composables/htmlToDocxBlocks'),
    import('@/world/plugins/manuscript/composables/blocksToDocx'),
    import('@/stores/fontStore'),
  ])
  const prefs = useFontStore().prefs
  const defaultFont = prefs.preview.family || prefs.content.family || 'Microsoft YaHei'
  return buildDocxBlob(htmlToBlocks(html), { title, defaultFont })
}
