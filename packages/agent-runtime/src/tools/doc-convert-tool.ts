/**
 * 文档转换工具
 *
 * 使用 MarkItDown 将各种文档格式转换为 Markdown。
 * 采用前端优先 + 后端回退策略：
 * - 前端可处理的格式（pdf/docx/html/txt/md）：先尝试后端获得更高质量，失败则回退前端内置解析器
 * - 仅后端可处理的格式（pptx/xlsx/mp3 等）：必须依赖后端服务
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/** 后端 MarkItDown 服务地址 */
const BACKEND_CONVERT_URL = 'http://localhost:3100/api/convert'

/** 前端内置解析器已能处理的文件格式 */
const FRONTEND_FORMATS = ['pdf', 'docx', 'html', 'htm', 'txt', 'md']

/**
 * 从文件名中提取小写扩展名
 * @param filename 文件名（含扩展名）
 * @returns 小写的扩展名，不含点号
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filename.length - 1) return ''
  return filename.slice(lastDot + 1).toLowerCase()
}

/**
 * 调用后端 MarkItDown 转换服务
 * @param filename 文件名
 * @param contentBase64 文件内容的 Base64 编码
 * @returns 后端返回的转换结果
 */
async function callBackendConvert(filename: string, contentBase64: string): Promise<Response> {
  return fetch(BACKEND_CONVERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content_base64: contentBase64 }),
  })
}

/**
 * doc_convert — 将文档文件转换为 Markdown 格式
 *
 * 支持格式：PDF、DOCX、PPTX、XLSX、HTML、音频等。
 * 策略：前端可解析格式先尝试后端（更高质量），失败则回退前端；
 *       仅后端可解析格式必须依赖后端服务。
 */
export const docConvertTool: ToolDefinition = {
  name: 'doc_convert',
  description: '将文档文件转换为 Markdown 格式。支持 PDF、DOCX、PPTX、XLSX、HTML、音频等格式。使用场景：导入外部设定文档、转换参考资料为可搜索的 Markdown、将 Word/PDF 设定集导入知识库。',
  parameters: {
    filename: { type: 'string', description: '文件名含扩展名', required: true },
    content_base64: { type: 'string', description: '文件内容的 Base64 编码', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'file',
    displayName: '文档转换',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const filename = String(args.filename ?? '')
    const contentBase64 = String(args.content_base64 ?? '')

    // 1. 校验必填参数
    if (!filename) {
      return JSON.stringify({ error: '缺少必填参数 filename' })
    }
    if (!contentBase64) {
      return JSON.stringify({ error: '缺少必填参数 content_base64' })
    }

    // 2. 获取文件扩展名
    const ext = getFileExtension(filename)
    if (!ext) {
      return JSON.stringify({ error: `无法识别文件扩展名: ${filename}` })
    }

    // 3. 判断是否为前端可处理的格式
    const isFrontendFormat = FRONTEND_FORMATS.includes(ext)

    // 4. 尝试后端 MarkItDown 转换
    try {
      const resp = await callBackendConvert(filename, contentBase64)

      if (resp.ok) {
        // 后端转换成功
        const result = await resp.json()
        return JSON.stringify({
          filename,
          ...result,
          note: '使用后端 MarkItDown 服务（更高质量）',
          status: 'backend_success',
        })
      }

      // 后端返回非 2xx 状态码
      const errorText = await resp.text().catch(() => '')
      const backendError = `后端服务返回 ${resp.status}: ${errorText.slice(0, 200)}`

      if (isFrontendFormat) {
        // 前端可处理格式：回退到前端内置解析器
        return JSON.stringify({
          filename,
          note: '后端不可用，请使用前端内置解析器',
          frontend_format: ext,
          status: 'frontend_fallback',
          backend_error: backendError,
        })
      }

      // 仅后端可处理格式：无法回退，返回错误
      return JSON.stringify({
        error: `后端转换服务不可用，无法处理 .${ext} 格式文件。请确保后端 MarkItDown 服务正在运行（${BACKEND_CONVERT_URL}）`,
        filename,
        status: 'backend_unavailable',
        backend_error: backendError,
      })
    } catch (err: any) {
      // 网络错误等异常
      const errorMessage = err.message || String(err)

      if (isFrontendFormat) {
        // 前端可处理格式：回退到前端内置解析器
        return JSON.stringify({
          filename,
          note: '后端不可用，请使用前端内置解析器',
          frontend_format: ext,
          status: 'frontend_fallback',
          backend_error: `无法连接后端服务: ${errorMessage}`,
        })
      }

      // 仅后端可处理格式：无法回退，返回错误
      return JSON.stringify({
        error: `无法连接后端转换服务，无法处理 .${ext} 格式文件。请确保后端 MarkItDown 服务正在运行（${BACKEND_CONVERT_URL}）。错误: ${errorMessage}`,
        filename,
        status: 'backend_unavailable',
      })
    }
  },
}

export const docConvertTools: ToolDefinition[] = [docConvertTool]
