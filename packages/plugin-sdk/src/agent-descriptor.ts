import type { LibraryDescriptor, CapabilityDeclaration } from '@agent/toolbus/capability-types'
import type { IToolContext } from '@agent/toolbus/types'
import type { ToolParameter } from '@agent/bridge-types'

const stringParam = (description: string, required = true): ToolParameter => ({
  type: 'string',
  description,
  required,
})

const numberParam = (description: string, required = false): ToolParameter => ({
  type: 'number',
  description,
  required,
})

const objectParam = (description: string, required = true): ToolParameter => ({
  type: 'object',
  description,
  required,
})

const ENTITY_TYPE_MAP: Record<string, string> = {
  manuscript: 'manuscript',
  notebook: 'notebook',
  outline: 'outline_node',
  timeline: 'timeline',
  graph: 'graph',
  mindmap: 'mindmap',
  characters: 'character',
  organizations: 'organization',
  regions: 'region',
}

function genericPluginWriteExecute(pluginId: string, entityType: string) {
  return async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const action = String(args.action)
    const data = args.data as Record<string, unknown>
    const entityId = args.entityId ? String(args.entityId) : undefined

    if (!['create', 'update', 'append'].includes(action)) {
      return JSON.stringify({ ok: false, error: `不支持的操作: ${action}` })
    }

    if (action === 'create') {
      const name = (data as any).title || (data as any).volumeName || (data as any).name || '未命名'
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
  }
}

const pluginManuscriptWrite: CapabilityDeclaration = {
  id: 'plugin.manuscript.write',
  name: '写入正文插件',
  description: '将内容写入正文（manuscript）插件。支持 create(新建卷/章)、update(更新)、append(追加) 操作。写入前需用户确认。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，结构因操作而异。create 可含 title/volumeName/content 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'manuscript', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('manuscript', ENTITY_TYPE_MAP.manuscript),
}

const pluginNotebookWrite: CapabilityDeclaration = {
  id: 'plugin.notebook.write',
  name: '写入笔记插件',
  description: '将内容写入笔记（notebook）插件。支持 create/update/append 操作。如需更精细控制，使用 notebook.create 或 notebook.update。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，结构因操作而异', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'notebook', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('notebook', ENTITY_TYPE_MAP.notebook),
}

const pluginNotebookCreate: CapabilityDeclaration = {
  id: 'plugin.notebook.create',
  name: '创建笔记',
  description: '创建笔记本笔记。支持 markdown/code/canvas/reference 类型。代码笔记可指定语言。',
  category: 'crud',
  parameters: {
    content: stringParam('笔记内容（Markdown）', true),
    noteType: { ...stringParam('笔记类型: markdown/code/canvas/reference', false), enum: ['markdown', 'code', 'canvas', 'reference'] },
    tags: objectParam('标签数组', false),
    folderId: stringParam('所属文件夹ID', false),
    codeLanguage: stringParam('代码语言（noteType=code时）', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'notebook', fieldPolicy: 'prefer-defined' },
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

const pluginNotebookUpdate: CapabilityDeclaration = {
  id: 'plugin.notebook.update',
  name: '更新笔记',
  description: '更新笔记本笔记内容、标签或关联实体。',
  category: 'crud',
  parameters: {
    noteId: stringParam('笔记实体ID', true),
    content: stringParam('新内容（覆盖）', false),
    appendContent: stringParam('追加内容', false),
    tags: objectParam('新标签数组', false),
    linkedEntities: objectParam('关联实体ID数组', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'notebook', fieldPolicy: 'prefer-defined' },
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

const pluginNotebookLink: CapabilityDeclaration = {
  id: 'plugin.notebook.link',
  name: '创建笔记双向链接',
  description: '创建两个笔记之间的双向链接。',
  category: 'crud',
  parameters: {
    sourceId: stringParam('源笔记ID', true),
    targetId: stringParam('目标笔记ID', true),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'notebook', fieldPolicy: 'prefer-defined' },
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

const pluginCodeExecute: CapabilityDeclaration = {
  id: 'plugin.code.execute',
  name: '执行沙箱代码',
  description: '在沙箱中执行 JavaScript 代码并返回结果。仅限 notebook 代码笔记使用。需用户确认。超时5秒自动终止。',
  category: 'io',
  parameters: {
    code: stringParam('JavaScript 代码', true),
    noteId: stringParam('关联笔记ID', true),
    timeout: numberParam('超时毫秒数，默认5000', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
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

const pluginTimelineWrite: CapabilityDeclaration = {
  id: 'plugin.timeline.write',
  name: '写入时间线插件',
  description: '将内容写入时间线（timeline）插件。支持 create/update/append 操作。需要 UI 渲染支持。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 title/startTime/endTime/content/description 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri'], chain: ['internal'], requiresUI: true },
  schemaContext: { entityType: 'timeline', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('timeline', ENTITY_TYPE_MAP.timeline),
}

const pluginGraphWrite: CapabilityDeclaration = {
  id: 'plugin.graph.write',
  name: '写入图谱插件',
  description: '将内容写入图谱（graph）插件。支持 create/update/append 操作。需要 UI 渲染支持。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 name/description/nodes/edges 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri'], chain: ['internal'], requiresUI: true },
  schemaContext: { entityType: 'graph', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('graph', ENTITY_TYPE_MAP.graph),
}

const pluginMindmapWrite: CapabilityDeclaration = {
  id: 'plugin.mindmap.write',
  name: '写入思维导图插件',
  description: '将内容写入思维导图（mindmap）插件。支持 create/update/append 操作。需要 UI 渲染支持。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 name/description/children 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri'], chain: ['internal'], requiresUI: true },
  schemaContext: { entityType: 'mindmap', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('mindmap', ENTITY_TYPE_MAP.mindmap),
}

const pluginCharacterWrite: CapabilityDeclaration = {
  id: 'plugin.character.write',
  name: '写入角色插件',
  description: '将内容写入角色（characters）插件。支持 create/update/append 操作。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 name/description/personality/background/abilities 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'character', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('characters', ENTITY_TYPE_MAP.characters),
}

const pluginFactionWrite: CapabilityDeclaration = {
  id: 'plugin.faction.write',
  name: '写入派系/组织插件',
  description: '将内容写入派系/组织（organizations）插件。支持 create/update/append 操作。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 name/description/ideology/hierarchy/members 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'organization', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('organizations', ENTITY_TYPE_MAP.organizations),
}

const pluginRegionWrite: CapabilityDeclaration = {
  id: 'plugin.region.write',
  name: '写入区域插件',
  description: '将内容写入区域（regions）插件。支持 create/update/append 操作。',
  category: 'crud',
  parameters: {
    action: { ...stringParam('操作类型: create/update/append', true), enum: ['create', 'update', 'append'] },
    data: objectParam('写入数据，可含 name/description/geography/climate/resources 等', true),
    entityId: stringParam('更新/追加时的目标实体ID', false),
  },
  availability: { platforms: ['web', 'tauri', 'cli'], chain: ['internal'] },
  schemaContext: { entityType: 'region', fieldPolicy: 'prefer-defined' },
  execute: genericPluginWriteExecute('regions', ENTITY_TYPE_MAP.regions),
}

export const pluginSdkDescriptor: LibraryDescriptor = {
  id: '@worldsea/plugin-sdk',
  name: 'Plugin SDK',
  version: '0.1.0',
  capabilities: [
    pluginManuscriptWrite,
    pluginNotebookWrite,
    pluginNotebookCreate,
    pluginNotebookUpdate,
    pluginNotebookLink,
    pluginCodeExecute,
    pluginTimelineWrite,
    pluginGraphWrite,
    pluginMindmapWrite,
    pluginCharacterWrite,
    pluginFactionWrite,
    pluginRegionWrite,
  ],
}
