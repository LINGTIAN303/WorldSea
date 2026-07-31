/**
 * 文件管理工具集
 *
 * 管理项目工作区文件的完整生命周期：
 * - file_list: 列表查询（按路径前缀或关联实体筛选）
 * - file_read: 读取文件内容（文本或 base64）
 * - file_write: 创建/覆盖文件
 * - file_delete: 删除文件
 * - file_associate: 将文件关联/取消关联到实体
 * - file_analyze: 分析文件结构并推荐目标插件
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'

/** file_list — 列出文件，支持路径前缀和实体关联两种筛选方式 */
export const fileListTool: ToolDefinition = {
  name: 'file_list',
  description: '列出项目工作区中的文件。可按路径前缀筛选、按关联实体筛选。返回文件元数据列表（名称、路径、大小、类型、关联实体）。',
  parameters: {
    pathPrefix: { type: 'string', description: '路径前缀筛选，如 "/docs/" 或 "/characters/"' },
    entityId: { type: 'string', description: '按关联实体 ID 筛选文件' },
  },
  meta: {
    permission: 'safe',
    category: 'file',
    displayName: '列出文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let files = await ctx.stores.file.getAllFiles()
    if (args.pathPrefix) {
      const prefix = String(args.pathPrefix)
      files = files.filter(f => f.path.startsWith(prefix))
    }
    if (args.entityId) {
      const eid = String(args.entityId)
      files = files.filter(f => f.entityId === eid)
    }
    const results = files.map(f => ({
      id: f.id,
      name: f.name,
      path: f.path,
      mimeType: f.mimeType,
      size: f.size,
      entityId: f.entityId,
      tags: f.tags,
      updatedAt: f.updatedAt,
    }))
    return JSON.stringify({ total: results.length, files: results })
  },
}

/** file_read — 读取文件内容，支持通过 ID 或路径定位 */
export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description: '读取项目工作区中指定文件的内容。支持通过文件 ID 或路径读取。文本文件返回原文内容，二进制文件返回 base64 编码。适用于查看用户上传的文件、AI 之前生成的文件等。',
  parameters: {
    id: { type: 'string', description: '文件 ID' },
    path: { type: 'string', description: '文件路径（与 id 二选一）' },
  },
  meta: {
    permission: 'safe',
    category: 'file',
    displayName: '读取文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let fileId = args.id ? String(args.id) : undefined
    if (!fileId && args.path) {
      const file = await ctx.stores.file.getByPath(String(args.path))
      if (!file) return JSON.stringify({ error: `文件路径不存在: ${args.path}` })
      fileId = file.id
    }
    if (!fileId) return JSON.stringify({ error: '请提供 id 或 path 参数' })
    const file = await ctx.stores.file.getById(fileId)
    if (!file) return JSON.stringify({ error: `文件不存在: ${fileId}` })
    const content = await ctx.stores.file.getContent(fileId)
    if (!content) return JSON.stringify({ error: `文件内容不存在: ${fileId}` })
    return JSON.stringify({
      id: file.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      size: file.size,
      entityId: file.entityId,
      content: content.textContent || content.binaryData,
      isBinary: !content.textContent && !!content.binaryData,
    })
  },
}

/** file_write — 创建或覆盖文件，路径必须以 / 开头 */
export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description: '在项目工作区中创建或覆盖文件。需要用户确认保存路径后才执行。适用于 AI 生成文档、导出数据、创建配置文件等。文件可关联到实体。',
  parameters: {
    path: { type: 'string', description: '文件保存路径，如 "/docs/world-overview.md"', required: true },
    content: { type: 'string', description: '文件内容（文本）', required: true },
    name: { type: 'string', description: '文件显示名称，默认取路径最后一段' },
    entityId: { type: 'string', description: '关联实体 ID（可选）' },
    mimeType: { type: 'string', description: 'MIME 类型，默认 text/plain' },
    overwrite: { type: 'boolean', description: '是否覆盖已存在的文件，默认 false' },
  },
  meta: {
    permission: 'moderate',
    category: 'file',
    displayName: '写入文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const path = String(args.path)
    if (!path.startsWith('/')) return JSON.stringify({ error: '路径必须以 / 开头' })
    const name = args.name ? String(args.name) : path.split('/').pop() || 'untitled'
    const mimeType = args.mimeType ? String(args.mimeType) : guessMimeType(path)
    const content = String(args.content)
    const entityId = args.entityId ? String(args.entityId) : undefined
    const overwrite = args.overwrite === true

    const existing = await ctx.stores.file.getByPath(path)
    if (existing && !overwrite) {
      return JSON.stringify({ error: `文件已存在: ${path}，设置 overwrite: true 以覆盖` })
    }

    if (existing && overwrite) {
      await ctx.stores.file.remove(existing.id)
    }

    const id = await ctx.stores.file.add(name, path, mimeType, new Blob([content]).size, content, entityId)
    return JSON.stringify({ success: true, id, path, name, size: content.length })
  },
}

/** file_delete — 删除文件，支持 ID 或路径定位 */
export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete',
  description: '删除项目工作区中的文件。此操作不可逆，需用户确认。可通过文件 ID 或路径指定。',
  parameters: {
    id: { type: 'string', description: '文件 ID' },
    path: { type: 'string', description: '文件路径（与 id 二选一）' },
  },
  meta: {
    permission: 'dangerous',
    category: 'file',
    displayName: '删除文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let fileId = args.id ? String(args.id) : undefined
    if (!fileId && args.path) {
      const file = await ctx.stores.file.getByPath(String(args.path))
      if (!file) return JSON.stringify({ error: `文件路径不存在: ${args.path}` })
      fileId = file.id
    }
    if (!fileId) return JSON.stringify({ error: '请提供 id 或 path 参数' })
    const file = await ctx.stores.file.getById(fileId)
    if (!file) return JSON.stringify({ error: `文件不存在: ${fileId}` })
    await ctx.stores.file.remove(fileId)
    return JSON.stringify({ success: true, id: fileId, name: file.name, path: file.path })
  },
}

/** file_associate — 将文件关联到实体或取消关联 */
export const fileAssociateTool: ToolDefinition = {
  name: 'file_associate',
  description: '将文件关联到实体，或取消关联。关联后，查看实体时可快速找到相关文件。例如将角色头像图片关联到角色实体。',
  parameters: {
    fileId: { type: 'string', description: '文件 ID', required: true },
    entityId: { type: 'string', description: '实体 ID。设为空字符串则取消关联' },
  },
  meta: {
    permission: 'moderate',
    category: 'file',
    displayName: '关联文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const fileId = String(args.fileId)
    const entityId = args.entityId !== undefined ? String(args.entityId) : undefined
    const file = await ctx.stores.file.getById(fileId)
    if (!file) return JSON.stringify({ error: `文件不存在: ${fileId}` })
    if (entityId === '') {
      await ctx.stores.file.disassociateEntity(fileId)
      return JSON.stringify({ success: true, fileId, action: 'disassociated' })
    }
    if (entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (!entity) return JSON.stringify({ error: `实体不存在: ${entityId}` })
      await ctx.stores.file.associateEntity(fileId, entityId)
      return JSON.stringify({ success: true, fileId, entityId, entityName: entity.name, action: 'associated' })
    }
    return JSON.stringify({ error: '请提供 entityId 参数' })
  },
}

/**
 * file_analyze — 分析文件结构和内容
 * 分析深度: basic（类型+摘要）/ deep（结构+语义+路由建议）
 * 根据文件扩展名和内容特征推荐目标插件
 */
export const fileAnalyzeTool: ToolDefinition = {
  name: 'file_analyze',
  description: '分析上传文件的类型、内容结构和语义，生成摘要和路由建议。AI 根据分析结果决定如何处理文件。',
  parameters: {
    id: { type: 'string', description: '文件 ID', required: true },
    analysisDepth: { type: 'string', description: 'basic(类型+摘要)/deep(结构+语义+路由建议)', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'file',
    displayName: '分析文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const fileId = String(args.id)
    const depth = String(args.analysisDepth || 'deep')

    const file = await ctx.stores.file.getById(fileId)
    if (!file) return JSON.stringify({ ok: false, error: `文件不存在: ${fileId}` })

    const content = await ctx.stores.file.getContent(fileId)
    if (!content) return JSON.stringify({ ok: false, error: `文件内容不存在: ${fileId}` })

    const textContent = content.textContent || ''
    const isBinary = !textContent && !!content.binaryData

    const result: Record<string, unknown> = {
      ok: true,
      fileId,
      fileName: file.name,
      mimeType: file.mimeType,
      size: file.size,
      isBinary,
    }

    if (isBinary) {
      result.summary = '二进制文件，无法提取文本内容'
      result.suggestedTargets = [{ plugin: 'notebook', reason: '二进制文件建议作为附件关联到笔记' }]
      return JSON.stringify(result)
    }

    const lines = textContent.split('\n')
    const headings = lines.filter(l => /^#{1,6}\s/.test(l.trim()))
    const codeBlocks = (textContent.match(/```[\s\S]*?```/g) || []).length
    const hasFrontmatter = textContent.startsWith('---')

    result.structure = {
      lineCount: lines.length,
      wordCount: textContent.length,
      headingCount: headings.length,
      headings: headings.slice(0, 10),
      codeBlockCount: codeBlocks,
      hasFrontmatter,
    }

    result.contentPreview = textContent.slice(0, 500)

    if (depth === 'deep') {
      const suggestions: { plugin: string; reason: string }[] = []
      const ext = file.name.split('.').pop()?.toLowerCase() || ''

      if (['md', 'markdown'].includes(ext)) {
        if (codeBlocks > headings.length) {
          suggestions.push({ plugin: 'notebook', reason: '含大量代码块，适合作为代码笔记' })
        } else if (headings.length > 3) {
          suggestions.push({ plugin: 'manuscript', reason: '含多级标题结构，可能是正文内容' })
        }
        suggestions.push({ plugin: 'notebook', reason: 'Markdown 文件可直接作为笔记导入' })
      } else if (['docx', 'doc'].includes(ext)) {
        suggestions.push({ plugin: 'manuscript', reason: 'Word 文档通常为正文内容' })
        suggestions.push({ plugin: 'notebook', reason: '可拆分为多条笔记' })
      } else if (['txt'].includes(ext)) {
        suggestions.push({ plugin: 'notebook', reason: '文本文件适合作为笔记导入' })
      } else if (['js', 'ts', 'py', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'vue', 'rs', 'go'].includes(ext)) {
        suggestions.push({ plugin: 'notebook', reason: '代码文件适合作为代码笔记' })
      } else if (['pptx', 'ppt'].includes(ext)) {
        suggestions.push({ plugin: 'notebook', reason: 'PPT 内容可拆分为多条笔记' })
      }

      if (suggestions.length === 0) {
        suggestions.push({ plugin: 'notebook', reason: '默认建议导入笔记本' })
      }

      result.suggestedTargets = suggestions
    }

    return JSON.stringify(result)
  },
}

/** 根据文件扩展名猜测 MIME 类型 */
function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const mimeMap: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    toml: 'text/toml',
    csv: 'text/csv',
    pdf: 'application/pdf',
  }
  return mimeMap[ext || ''] || 'text/plain'
}

export const fileTools = [fileListTool, fileReadTool, fileWriteTool, fileDeleteTool, fileAssociateTool, fileAnalyzeTool]
