/** useFileExtract：文档内容提取（docx/pdf/text 统一解析，pdfjs 改 Web Worker），详细见 docs/details/注释/web/composables/useFileExtract.md */

/// 支持的文档扩展名
const DOC_EXTENSIONS = ['.docx']
const PDF_EXTENSIONS = ['.pdf']
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.toml', '.ini',
  '.log', '.html', '.css', '.js', '.ts', '.vue', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.sh', '.sql',
]

/// 单文件最大文本体积：5MB
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024

/// PDF 最大解析页数（防止超大 PDF 卡死）
const PDF_MAX_PAGES = 50

export interface ExtractedDocument {
  name: string
  mimeType: string
  textContent: string
}

/**
 * 提取文档文本内容
 *
 * @param file 用户选择的文件
 * @returns 提取结果；不识别的文件类型返回 null（调用方走 unsupported 分支）
 *          解析失败时 textContent 包含错误信息前缀，仍返回对象以保留文件名
 */
export async function extractDocumentText(file: File): Promise<ExtractedDocument | null> {
  const dotIdx = file.name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? '.' + file.name.slice(dotIdx + 1).toLowerCase() : ''

  // ─── Word 文档：mammoth 提取纯文本 ───
  if (DOC_EXTENSIONS.includes(ext)) {
    try {
      const mammoth = await import('mammoth')
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      return {
        name: file.name,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        textContent: result.value || '[Word 文件内容为空]',
      }
    } catch (err) {
      return {
        name: file.name,
        mimeType: file.type,
        textContent: `[Word 文件解析失败: ${(err as Error).message}]`,
      }
    }
  }

  // ─── PDF：pdfjs-dist 在 Web Worker 中解析，避免阻塞主线程 ───
  if (PDF_EXTENSIONS.includes(ext)) {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      // 修复：原 workerSrc='' 会回退到主线程同步解析，大 PDF 卡顿。
      // 改用 workerPort + new Worker 显式启动 Web Worker。
      // 仅初始化一次（pdfjs 内部会缓存 GlobalWorkerOptions.workerPort）。
      if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
        pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
          new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url),
          { type: 'module' },
        )
      }
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const pages: string[] = []
      const pageCount = Math.min(pdf.numPages, PDF_MAX_PAGES)
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const text = content.items.map((item: any) => item.str).join(' ')
        if (text.trim()) pages.push(text)
      }
      return {
        name: file.name,
        mimeType: 'application/pdf',
        textContent: pages.join('\n\n---\n\n') || '[PDF 文件内容为空或为扫描件]',
      }
    } catch (err) {
      return {
        name: file.name,
        mimeType: file.type,
        textContent: `[PDF 文件解析失败: ${(err as Error).message}]`,
      }
    }
  }

  // ─── 纯文本类：直接读取 ───
  if (TEXT_EXTENSIONS.includes(ext)) {
    if (file.size > MAX_TEXT_FILE_SIZE) {
      return {
        name: file.name,
        mimeType: file.type || 'text/plain',
        textContent: `[文本文件超过 ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB 限制，未解析]`,
      }
    }
    try {
      const text = await file.text()
      return {
        name: file.name,
        mimeType: file.type || 'text/plain',
        textContent: text,
      }
    } catch (err) {
      return {
        name: file.name,
        mimeType: file.type || 'text/plain',
        textContent: `[文本文件读取失败: ${(err as Error).message}]`,
      }
    }
  }

  // 不识别的文件类型
  return null
}
