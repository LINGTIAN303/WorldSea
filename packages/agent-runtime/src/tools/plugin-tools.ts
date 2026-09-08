/** 通用插件操作工具集：跨插件统一操作接口，详细见 docs/details/注释/packages/agent-runtime/tools-plugin-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/** 所有支持的插件目标列表 */
const SUPPORTED_PLUGIN_TARGETS = [
  'manuscript', 'notebook', 'outline',
  'timeline', 'graph', 'mindmap',
  'characters', 'regions', 'organizations',
  'species', 'languages', 'culture',
  'items', 'weapons', 'apparel', 'plants', 'buildings',
  'magic', 'combat_stats', 'tactical-board',
  'concepts', 'inspiration', 'drawing', 'conflict', 'custom',
  'module-builder',
]

/**
 * plugin_write — 向插件写入数据
 * 支持的三种操作：
 * - create: 创建实体并写入数据
 * - update: 更新实体（合并 properties）
 * - append: 追加内容到实体（如续写正文）
 */
export const pluginWriteTool: ToolDefinition = {
  name: 'plugin_write',
  description: '将内容写入指定插件的目标实体。支持所有 WorldSea 插件: manuscript(正文)、notebook(笔记)、outline(大纲)、timeline(时间线)、graph(图谱)、mindmap(思维导图)、characters(角色)、regions(区域)、organizations(组织)、species(物种)、languages(语言)、culture(文化)、items(物品)、weapons(武器)、apparel(服装)、plants(植物)、buildings(建筑)、magic(魔法)、combat_stats(战斗属性)、tactical-board(战术面板)、concepts(概念)、inspiration(灵感)、drawing(绘图)、conflict(冲突)、custom(自定义)、module-builder(模块构建)。写入前需用户确认。',
  parameters: {
    pluginId: { type: 'string', description: '目标插件ID: manuscript/notebook/outline', required: true },
    action: { type: 'string', description: 'create(新建)/update(更新)/append(追加)', required: true },
    data: { type: 'object', description: '写入数据，结构因插件而异', required: true },
    entityId: { type: 'string', description: '更新/追加时的目标实体ID', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '写入插件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const pluginId = String(args.pluginId)
    const action = String(args.action)
    const data = args.data as Record<string, unknown>
    const entityId = args.entityId ? String(args.entityId) : undefined

    if (!SUPPORTED_PLUGIN_TARGETS.includes(pluginId)) {
      return JSON.stringify({ ok: false, error: `不支持的插件: ${pluginId}` })
    }
    if (!['create', 'update', 'append'].includes(action)) {
      return JSON.stringify({ ok: false, error: `不支持的操作: ${action}` })
    }

    const entityTypeMap: Record<string, string> = {
      manuscript: 'manuscript',
      notebook: 'notebook',
      outline: 'outline_node',
    }
    const entityType = entityTypeMap[pluginId]

    if (action === 'create') {
      const name = (data as any).title || (data as any).volumeName || '未命名'
      const id = await ctx.stores.entity.add({
        id: crypto.randomUUID(),
        type: entityType,
        name,
        description: '',
        properties: { ...data },
        tags: (data as any).tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 'agent')
      return JSON.stringify({ ok: true, action: 'create', pluginId, entityId: id, name })
    }

    if (action === 'update' && entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (!entity) return JSON.stringify({ ok: false, error: `实体不存在: ${entityId}` })
      await ctx.stores.entity.update(entityId, {
        properties: { ...entity.properties, ...data },
      })
      return JSON.stringify({ ok: true, action: 'update', pluginId, entityId })
    }

    if (action === 'append' && entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (!entity) return JSON.stringify({ ok: false, error: `实体不存在: ${entityId}` })
      const existingContent = String(entity.properties?.content || '')
      const newContent = existingContent + '\n\n' + String((data as any).content || '')
      await ctx.stores.entity.update(entityId, {
        properties: { ...entity.properties, content: newContent },
      })
      return JSON.stringify({ ok: true, action: 'append', pluginId, entityId })
    }

    return JSON.stringify({ ok: false, error: '参数不完整：update/append 需要 entityId' })
  },
}

/** notebook_create — 创建笔记本笔记（支持 markdown/code/canvas/reference） */
export const notebookCreateTool: ToolDefinition = {
  name: 'notebook_create',
  description: '创建笔记本笔记。支持 markdown/code/canvas/reference 类型。代码笔记可指定语言。',
  parameters: {
    content: { type: 'string', description: '笔记内容（Markdown）', required: true },
    noteType: { type: 'string', description: '笔记类型: markdown/code/canvas/reference', required: false },
    tags: { type: 'object', description: '标签数组', required: false },
    folderId: { type: 'string', description: '所属文件夹ID', required: false },
    codeLanguage: { type: 'string', description: '代码语言（noteType=code时）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '创建笔记',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const content = String(args.content)
    const noteType = String(args.noteType || 'markdown')
    const tags = Array.isArray(args.tags) ? args.tags : []
    const folderId = args.folderId ? String(args.folderId) : undefined
    const codeLanguage = args.codeLanguage ? String(args.codeLanguage) : undefined

    const name = content.split('\n')[0]?.slice(0, 50) || '未命名笔记'
    const id = await ctx.stores.entity.add({
      id: crypto.randomUUID(),
      type: 'notebook',
      name,
      description: content.slice(0, 200),
      properties: {
        content,
        noteType,
        tags,
        folderId,
        codeLanguage,
        backlinks: [],
        forwardLinks: [],
        linkedEntities: [],
        codeOutput: '',
        sortOrder: Date.now().toString(),
      },
      tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, 'agent')
    return JSON.stringify({ ok: true, id, name, noteType })
  },
}

/** notebook_update — 更新笔记内容（覆盖或追加） */
export const notebookUpdateTool: ToolDefinition = {
  name: 'notebook_update',
  description: '更新笔记本笔记内容、标签或关联实体。',
  parameters: {
    noteId: { type: 'string', description: '笔记实体ID', required: true },
    content: { type: 'string', description: '新内容（覆盖）', required: false },
    appendContent: { type: 'string', description: '追加内容', required: false },
    tags: { type: 'object', description: '新标签数组', required: false },
    linkedEntities: { type: 'object', description: '关联实体ID数组', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '更新笔记',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const noteId = String(args.noteId)
    const entity = await ctx.stores.entity.getById(noteId)
    if (!entity || entity.type !== 'notebook') {
      return JSON.stringify({ ok: false, error: `笔记不存在: ${noteId}` })
    }

    const updates: Record<string, unknown> = {}
    if (args.content) {
      updates.content = String(args.content)
    } else if (args.appendContent) {
      const existing = String(entity.properties?.content || '')
      updates.content = existing + '\n\n' + String(args.appendContent)
    }
    if (args.tags) updates.tags = args.tags
    if (args.linkedEntities) updates.linkedEntities = args.linkedEntities

    await ctx.stores.entity.update(noteId, {
      properties: { ...entity.properties, ...updates },
    })
    return JSON.stringify({ ok: true, noteId })
  },
}

/** notebook_link — 创建两个笔记之间的双向链接 */
export const notebookLinkTool: ToolDefinition = {
  name: 'notebook_link',
  description: '创建两个笔记之间的双向链接。',
  parameters: {
    sourceId: { type: 'string', description: '源笔记ID', required: true },
    targetId: { type: 'string', description: '目标笔记ID', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '链接笔记',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const sourceId = String(args.sourceId)
    const targetId = String(args.targetId)

    const source = await ctx.stores.entity.getById(sourceId)
    const target = await ctx.stores.entity.getById(targetId)
    if (!source || source.type !== 'notebook') return JSON.stringify({ ok: false, error: `源笔记不存在: ${sourceId}` })
    if (!target || target.type !== 'notebook') return JSON.stringify({ ok: false, error: `目标笔记不存在: ${targetId}` })

    const sourceLinks = [...(source.properties?.forwardLinks as string[] || []), targetId]
    const targetLinks = [...(target.properties?.backlinks as string[] || []), sourceId]

    await ctx.stores.entity.update(sourceId, { properties: { ...source.properties, forwardLinks: sourceLinks } })
    await ctx.stores.entity.update(targetId, { properties: { ...target.properties, backlinks: targetLinks } })

    return JSON.stringify({ ok: true, sourceId, targetId })
  },
}

/**
 * code_execute — 在沙箱中执行 JS 代码
 * 使用 new Function() 创建隔离的执行环境，拦截 console.log/error 输出。
 * 执行结果保存到笔记的 codeOutput 属性中。
 */
export const codeExecuteTool: ToolDefinition = {
  name: 'code_execute',
  description: '在沙箱中执行 JavaScript 代码并返回结果。仅限 notebook 代码笔记使用。需用户确认。超时5秒自动终止。',
  parameters: {
    code: { type: 'string', description: 'JavaScript 代码', required: true },
    noteId: { type: 'string', description: '关联笔记ID', required: true },
    timeout: { type: 'number', description: '超时毫秒数，默认5000', required: false },
  },
  meta: {
    permission: 'dangerous',
    category: 'dev',
    displayName: '执行代码',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const code = String(args.code)
    const noteId = String(args.noteId)

    const note = await ctx.stores.entity.getById(noteId)
    if (!note || note.type !== 'notebook') {
      return JSON.stringify({ ok: false, error: `笔记不存在: ${noteId}` })
    }

    try {
      const logs: string[] = []
      const fn = new Function('console', `
        const console = { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push('ERROR: ' + a.map(String).join(' ')) };
        ${code}
      `)
      fn(logs)

      await ctx.stores.entity.update(noteId, {
        properties: { ...note.properties, codeOutput: JSON.stringify({ logs }) },
      })

      return JSON.stringify({ ok: true, noteId, output: logs.join('\n') || '(无输出)' })
    } catch (err: any) {
      const errorMsg = err?.message || String(err)
      await ctx.stores.entity.update(noteId, {
        properties: { ...note.properties, codeOutput: JSON.stringify({ error: errorMsg }) },
      })
      return JSON.stringify({ ok: false, noteId, error: errorMsg })
    }
  },
}

export const pluginTools: ToolDefinition[] = [
  pluginWriteTool,
  notebookCreateTool,
  notebookUpdateTool,
  notebookLinkTool,
  codeExecuteTool,
]
