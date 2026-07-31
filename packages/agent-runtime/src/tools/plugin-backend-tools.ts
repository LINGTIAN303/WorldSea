import type { ToolDefinition } from '../bridge-types'
import { emitEntityCard } from './a2ui-helpers'
import { indexEntity } from '../embedding/index'

function emitPluginEvent(pluginId: string, action: string, payload: unknown): string {
  try {
    const detail = { pluginId, action, payload, timestamp: Date.now() }
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('worldsmith:agent:plugin-action', { detail }))
    }
    return JSON.stringify({ ok: true, pluginId, action, dispatched: true })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) })
  }
}

function emitPluginQuery(pluginId: string, query: string, params?: unknown): string {
  try {
    const detail = { pluginId, query, params, timestamp: Date.now() }
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('worldsmith:agent:plugin-query', { detail }))
    }
    return JSON.stringify({ ok: true, pluginId, query, dispatched: true, note: '需要通过UI状态读取查询结果' })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) })
  }
}

/**
 * 插件后端工具集（域级合并版）
 *
 * 通过 window CustomEvent 机制与前端插件通信，提供：
 * - timeline: 时间线事件管理
 * - graph: 关系图谱操作
 * - mindmap: 思维导图操作
 * - manuscript: 稿件章节管理
 * - outline: 大纲结构管理
 * - notebook: 笔记管理
 * - tactical: 战术面板操作
 * - magic: 魔法技能树操作
 * - module_builder: 自定义模块管理
 * - entity_type: 实体类型 CRUD（角色/文化/语言/冲突/建筑/道具/概念/战力/服饰/素材）
 *
 * 所有操作通过 window.dispatchEvent 通知前端插件，
 * 插件处理后通过 UI 状态更新返回结果。
 */

// ============================================================
// 1. Timeline Tool
// ============================================================

const timelineTool: ToolDefinition = {
  name: 'timeline',
  description: '时间线操作：创建/更新/排序/冲突检测/查询/导出事件，以及布局/分组/缩放/折叠控制',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_event', 'update_event', 'sort_events', 'detect_conflicts', 'get_events', 'export', 'set_layout_mode', 'set_group_mode', 'zoom', 'toggle_collapse'],
    },
    name: { type: 'string', description: '事件名称（create_event 用）' },
    date: { type: 'string', description: '事件日期（如 1200-01-15 或 第三纪元1420年）' },
    dateEnd: { type: 'string', description: '结束日期（持续事件）' },
    description: { type: 'string', description: '事件描述' },
    era: { type: 'string', description: '所属年代（create_event 用）/ 按年代过滤（get_events 用）' },
    importance: { type: 'string', description: '重要性: 普通/重要/关键/细微' },
    status: { type: 'string', description: '状态: 正史/传闻/传说' },
    location: { type: 'string', description: '发生地点' },
    parentId: { type: 'string', description: '父级事件名称' },
    tags: { type: 'array', description: '标签列表' },
    eventId: { type: 'string', description: '事件ID（update_event/toggle_collapse 用）' },
    changes: { type: 'object', description: '要修改的字段 { name?, date?, dateEnd?, description?, era?, importance?, status?, location?, parentId? }' },
    method: { type: 'string', description: '排序方式: chronological(时间顺序) / reverse(倒序)' },
    threshold: { type: 'number', description: '冲突检测的时间阈值（天），默认30' },
    keyword: { type: 'string', description: '按关键词搜索' },
    limit: { type: 'number', description: '返回数量上限，默认20' },
    format: { type: 'string', description: '导出格式: json / csv / mermaid' },
    mode: { type: 'string', description: '布局模式: horizontal / vertical' },
    groupBy: { type: 'string', description: '分组方式: character / location / era / tag / none' },
    level: { type: 'string', description: '缩放级别: era / decade / year / month / day' },
    collapsed: { type: 'boolean', description: '是否折叠' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'timeline_create_event', 'timeline_update_event', 'timeline_sort_events',
      'timeline_detect_conflicts', 'timeline_get_events', 'timeline_export_timeline',
      'timeline_set_layout_mode', 'timeline_set_group_mode', 'timeline_zoom', 'timeline_toggle_collapse',
    ],
  },
  execute: async (args, ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_event': {
        const entityName = String(args.name)
        const entities = await ctx.stores.entity.getAllEntities()
        const duplicate = entities.some((e: any) => e.type === 'event' && e.name === entityName)
        if (duplicate) {
          return JSON.stringify({ error: `已存在同名事件 "${entityName}"`, hint: '请使用不同名称或先用 timeline get_events 查看' })
        }
        const entity = {
          id: crypto.randomUUID(),
          type: 'event',
          name: entityName,
          description: String(args.description || ''),
          properties: {
            date: args.date || '',
            dateEnd: args.dateEnd || '',
            era: args.era || '',
            importance: args.importance || '普通',
            status: args.status || '正史',
            location: args.location || '',
            parentId: args.parentId || '',
          },
          tags: Array.isArray(args.tags) ? args.tags : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        const id = await ctx.stores.entity.add(entity, 'agent')
        emitEntityCard(ctx, { ...entity, id })
        indexEntity({ ...entity, id }).catch(() => {})
        emitPluginEvent('timeline', 'create_event', { ...args, id })
        return JSON.stringify({ success: true, id, name: entity.name })
      }
      case 'update_event': {
        const entityId = String(args.eventId)
        const existing = await ctx.stores.entity.getById(entityId)
        if (!existing) return JSON.stringify({ error: `事件 ${entityId} 不存在`, hint: '请使用 timeline get_events 查看现有事件' })
        const changes = (args.changes || {}) as Record<string, unknown>
        const updates: Record<string, unknown> = {}
        if (changes.name) updates.name = String(changes.name)
        if (changes.description) updates.description = String(changes.description)
        const newProps = { ...(existing.properties || {}) }
        if (changes.date !== undefined) newProps.date = changes.date
        if (changes.dateEnd !== undefined) newProps.dateEnd = changes.dateEnd
        if (changes.era !== undefined) newProps.era = changes.era
        if (changes.importance !== undefined) newProps.importance = changes.importance
        if (changes.status !== undefined) newProps.status = changes.status
        if (changes.location !== undefined) newProps.location = changes.location
        if (changes.parentId !== undefined) newProps.parentId = changes.parentId
        updates.properties = newProps
        await ctx.stores.entity.update(entityId, updates, 'agent')
        const updated = await ctx.stores.entity.getById(entityId)
        if (updated) {
          emitEntityCard(ctx, updated)
          indexEntity(updated).catch(() => {})
        }
        emitPluginEvent('timeline', 'update_event', args)
        return JSON.stringify({ success: true, id: entityId })
      }
      case 'sort_events': {
        return emitPluginEvent('timeline', 'sort_events', args)
      }
      case 'detect_conflicts': {
        const entities = await ctx.stores.entity.getAllEntities()
        const events = entities.filter((e: any) => e.type === 'event' && e.properties?.date)
        const threshold = Number(args.threshold) || 30
        const conflicts: Array<{ event1: string; event2: string; daysApart: number }> = []
        const parsedDates: Array<{ id: string; name: string; dateStr: string; time: number }> = []
        for (const e of events) {
          const dateStr = String(e.properties?.date || '')
          const time = new Date(dateStr).getTime()
          if (!isNaN(time)) {
            parsedDates.push({ id: e.id, name: e.name, dateStr, time })
          }
        }
        parsedDates.sort((a, b) => a.time - b.time)
        for (let i = 0; i < parsedDates.length; i++) {
          for (let j = i + 1; j < parsedDates.length; j++) {
            const daysApart = Math.abs(parsedDates[j].time - parsedDates[i].time) / (86400000)
            if (daysApart <= threshold && daysApart > 0) {
              conflicts.push({ event1: parsedDates[i].name, event2: parsedDates[j].name, daysApart: Math.round(daysApart) })
            }
          }
        }
        return JSON.stringify({ total: conflicts.length, threshold, conflicts })
      }
      case 'get_events': {
        let entities = await ctx.stores.entity.getAllEntities()
        let events = entities.filter((e: any) => e.type === 'event')
        if (args.era) {
          const eraVal = String(args.era)
          events = events.filter((e: any) => e.properties?.era === eraVal)
        }
        if (args.importance) {
          const impVal = String(args.importance)
          events = events.filter((e: any) => e.properties?.importance === impVal)
        }
        if (args.keyword) {
          const kw = String(args.keyword).toLowerCase()
          events = events.filter((e: any) =>
            e.name.toLowerCase().includes(kw) ||
            (e.description || '').toLowerCase().includes(kw)
          )
        }
        const limit = Number(args.limit) || 20
        const results = events.slice(0, limit).map((e: any) => ({
          id: e.id,
          name: e.name,
          description: e.description || '',
          date: e.properties?.date || '',
          dateEnd: e.properties?.dateEnd || '',
          era: e.properties?.era || '',
          importance: e.properties?.importance || '',
          status: e.properties?.status || '',
          location: e.properties?.location || '',
        }))
        return JSON.stringify({ total: events.length, showing: results.length, events: results })
      }
      case 'export': {
        return emitPluginEvent('timeline', 'export', args)
      }
      case 'set_layout_mode': {
        return emitPluginEvent('timeline', 'set_layout_mode', args)
      }
      case 'set_group_mode': {
        return emitPluginEvent('timeline', 'set_group_mode', args)
      }
      case 'zoom': {
        return emitPluginEvent('timeline', 'zoom', args)
      }
      case 'toggle_collapse': {
        return emitPluginEvent('timeline', 'toggle_collapse', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 2. Graph Tool
// ============================================================

const graphTool: ToolDefinition = {
  name: 'graph',
  description: '关系图谱操作：节点/边查询、路径查找、聚类分析、高亮、快照导出、类型过滤、子图搜索',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['get_nodes', 'get_edges', 'find_path', 'cluster_analysis', 'highlight_nodes', 'export_snapshot', 'filter_by_type', 'search_subgraph'],
    },
    type: { type: 'string', description: '实体类型过滤（get_nodes 用）/ 关系类型过滤（get_edges 用）' },
    keyword: { type: 'string', description: '关键词搜索（get_nodes 用）' },
    sourceId: { type: 'string', description: '源节点ID（get_edges/find_path 用）' },
    targetId: { type: 'string', description: '目标节点ID（get_edges/find_path 用）' },
    method: { type: 'string', description: '聚类算法: louvain / label_propagation / k_means' },
    nodeIds: { type: 'array', description: '要高亮的节点ID列表' },
    format: { type: 'string', description: '导出格式: png / svg / json' },
    types: { type: 'array', description: '要显示的实体类型列表（filter_by_type 用）' },
    centerId: { type: 'string', description: '中心节点ID（search_subgraph 用）' },
    depth: { type: 'number', description: '搜索深度，默认2（search_subgraph 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'graph_get_nodes', 'graph_get_edges', 'graph_find_path', 'graph_cluster_analysis',
      'graph_highlight_nodes', 'graph_export_snapshot', 'graph_filter_by_type', 'graph_search_subgraph',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'get_nodes': {
        return emitPluginQuery('graph', 'get_nodes', args)
      }
      case 'get_edges': {
        return emitPluginQuery('graph', 'get_edges', args)
      }
      case 'find_path': {
        return emitPluginQuery('graph', 'find_path', args)
      }
      case 'cluster_analysis': {
        return emitPluginQuery('graph', 'cluster_analysis', args)
      }
      case 'highlight_nodes': {
        return emitPluginEvent('graph', 'highlight_nodes', args)
      }
      case 'export_snapshot': {
        return emitPluginEvent('graph', 'export_snapshot', args)
      }
      case 'filter_by_type': {
        return emitPluginEvent('graph', 'filter_by_type', args)
      }
      case 'search_subgraph': {
        return emitPluginQuery('graph', 'search_subgraph', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 3. Mindmap Tool
// ============================================================

const mindmapTool: ToolDefinition = {
  name: 'mindmap',
  description: '思维导图操作：节点 CRUD、结构查询、自动布局、图片导出、批量创建、搜索、图分析（孤立/环/路径/移动建议/AI 整理）',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_node', 'update_node', 'delete_node', 'get_structure', 'auto_layout', 'export_image', 'batch_create', 'search_node', 'find_isolated', 'find_cycles', 'highlight_path', 'suggest_move_to_group', 'ai_organize'],
    },
    parentId: { type: 'string', description: '父节点ID（根节点则为root）' },
    label: { type: 'string', description: '节点标签' },
    style: { type: 'object', description: '节点样式配置' },
    nodeId: { type: 'string', description: '节点ID' },
    changes: { type: 'object', description: '要修改的字段 { label?, style?, collapsed? }' },
    algorithm: { type: 'string', description: '布局算法: tree / radial / fishbone' },
    format: { type: 'string', description: '格式: png / svg' },
    structure: { type: 'object', description: '树形结构数据 { label, children?: [...] }' },
    keyword: { type: 'string', description: '搜索关键词' },
    maxDepth: { type: 'number', description: '最大搜索深度，默认 6（find_cycles 用）' },
    sourceId: { type: 'string', description: '起始节点ID（highlight_path 用）' },
    targetId: { type: 'string', description: '目标节点ID（highlight_path 用）' },
    groupId: { type: 'string', description: '目标分组ID（suggest_move_to_group 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'mindmap_create_node', 'mindmap_update_node', 'mindmap_delete_node', 'mindmap_get_structure',
      'mindmap_auto_layout', 'mindmap_export_image', 'mindmap_batch_create', 'mindmap_search_node',
      'mindmap_find_isolated_nodes', 'mindmap_find_cycles', 'mindmap_highlight_path',
      'mindmap_suggest_move_to_group', 'mindmap_ai_organize',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_node': {
        return emitPluginEvent('mindmap', 'create_node', args)
      }
      case 'update_node': {
        return emitPluginEvent('mindmap', 'update_node', args)
      }
      case 'delete_node': {
        return emitPluginEvent('mindmap', 'delete_node', args)
      }
      case 'get_structure': {
        return emitPluginQuery('mindmap', 'get_structure')
      }
      case 'auto_layout': {
        return emitPluginEvent('mindmap', 'auto_layout', args)
      }
      case 'export_image': {
        return emitPluginEvent('mindmap', 'export_image', args)
      }
      case 'batch_create': {
        return emitPluginEvent('mindmap', 'batch_create', args)
      }
      case 'search_node': {
        return emitPluginQuery('mindmap', 'search_node', args)
      }
      case 'find_isolated': {
        return emitPluginEvent('mindmap', 'find_isolated', {})
      }
      case 'find_cycles': {
        return emitPluginEvent('mindmap', 'find_cycles', args)
      }
      case 'highlight_path': {
        return emitPluginEvent('mindmap', 'highlight_path', args)
      }
      case 'suggest_move_to_group': {
        return emitPluginEvent('mindmap', 'suggest_move_to_group', args)
      }
      case 'ai_organize': {
        return emitPluginEvent('mindmap', 'ai_organize', {})
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 4. Manuscript Tool
// ============================================================

const manuscriptTool: ToolDefinition = {
  name: 'manuscript',
  description: '稿件管理：章节创建/更新/列表/内容获取/实体引用/导出/排序/拆分',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_chapter', 'update_chapter', 'list_chapters', 'get_chapter_content', 'insert_mention', 'export_document', 'reorder_chapters', 'split_chapter'],
    },
    title: { type: 'string', description: '章节标题（create_chapter 用）' },
    content: { type: 'string', description: '初始正文内容（create_chapter 用）/ 新正文内容（update_chapter 用）' },
    volumeName: { type: 'string', description: '所属卷名' },
    status: { type: 'string', description: '状态: draft / writing / review / done' },
    chapterId: { type: 'string', description: '章节ID' },
    entityId: { type: 'string', description: '要引用的实体ID（insert_mention 用）' },
    position: { type: 'number', description: '插入位置（字符偏移）' },
    format: { type: 'string', description: '导出格式: html / pdf / markdown / docx' },
    chapters: { type: 'array', description: '指定导出的章节ID列表' },
    chapterIds: { type: 'array', description: '章节ID新顺序（reorder_chapters 用）' },
    splitPoints: { type: 'array', description: '拆分点（字符偏移数组，split_chapter 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'manuscript_create_chapter', 'manuscript_update_chapter', 'manuscript_list_chapters',
      'manuscript_get_chapter_content', 'manuscript_insert_mention', 'manuscript_export_document',
      'manuscript_reorder_chapters', 'manuscript_split_chapter',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_chapter': {
        return emitPluginEvent('manuscript', 'create_chapter', args)
      }
      case 'update_chapter': {
        return emitPluginEvent('manuscript', 'update_chapter', args)
      }
      case 'list_chapters': {
        return emitPluginQuery('manuscript', 'list_chapters', args)
      }
      case 'get_chapter_content': {
        return emitPluginQuery('manuscript', 'get_chapter_content', args)
      }
      case 'insert_mention': {
        return emitPluginEvent('manuscript', 'insert_mention', args)
      }
      case 'export_document': {
        return emitPluginEvent('manuscript', 'export_document', args)
      }
      case 'reorder_chapters': {
        return emitPluginEvent('manuscript', 'reorder_chapters', args)
      }
      case 'split_chapter': {
        return emitPluginEvent('manuscript', 'split_chapter', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 5. Outline Tool
// ============================================================

const outlineTool: ToolDefinition = {
  name: 'outline',
  description: '大纲操作：节点创建/更新/移动/删除/结构查询/实体关联/导出/批量创建',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_node', 'update_node', 'move_node', 'get_structure', 'link_entity', 'export_outline', 'delete_node', 'batch_create'],
    },
    title: { type: 'string', description: '节点标题（create_node 用）' },
    parentId: { type: 'string', description: '父节点ID（根节点为root）' },
    type: { type: 'string', description: '节点类型: act / sequence / scene / beat' },
    nodeId: { type: 'string', description: '节点ID' },
    changes: { type: 'object', description: '要修改的字段 { title?, type?, description?, status? }' },
    newParentId: { type: 'string', description: '新父节点ID（move_node 用）' },
    position: { type: 'number', description: '在新父节点中的位置索引（move_node 用）' },
    entityId: { type: 'string', description: '实体ID（link_entity 用）' },
    format: { type: 'string', description: '导出格式: text / json / markdown' },
    structure: { type: 'object', description: '树形结构 { title, type, children?: [...] }（batch_create 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'outline_create_node', 'outline_update_node', 'outline_move_node', 'outline_get_structure',
      'outline_link_entity', 'outline_export_outline', 'outline_delete_node', 'outline_batch_create',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_node': {
        return emitPluginEvent('outline', 'create_node', args)
      }
      case 'update_node': {
        return emitPluginEvent('outline', 'update_node', args)
      }
      case 'move_node': {
        return emitPluginEvent('outline', 'move_node', args)
      }
      case 'get_structure': {
        return emitPluginQuery('outline', 'get_structure')
      }
      case 'link_entity': {
        return emitPluginEvent('outline', 'link_entity', args)
      }
      case 'export_outline': {
        return emitPluginEvent('outline', 'export', args)
      }
      case 'delete_node': {
        return emitPluginEvent('outline', 'delete_node', args)
      }
      case 'batch_create': {
        return emitPluginEvent('outline', 'batch_create', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 6. Notebook Tool
// ============================================================

const notebookTool: ToolDefinition = {
  name: 'notebook',
  description: '笔记操作：创建/更新/列表/执行代码/双向链接/导出/搜索/删除',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_note', 'update_note', 'list_notes', 'execute_code', 'create_backlink', 'export_note', 'search_notes', 'delete_note'],
    },
    content: { type: 'string', description: '笔记内容（Markdown格式）/ 新内容' },
    noteType: { type: 'string', description: '类型: log / research / diagnosis / code' },
    folderId: { type: 'string', description: '文件夹ID' },
    tags: { type: 'array', description: '标签列表' },
    noteId: { type: 'string', description: '笔记ID' },
    code: { type: 'string', description: '代码内容（execute_code 用）' },
    sourceId: { type: 'string', description: '源笔记ID（create_backlink 用）' },
    targetId: { type: 'string', description: '目标笔记ID（create_backlink 用）' },
    format: { type: 'string', description: '导出格式: markdown / html / pdf' },
    keyword: { type: 'string', description: '按关键词搜索（list_notes 用）' },
    query: { type: 'string', description: '搜索关键词（search_notes 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'notebook_create_note', 'notebook_update_note', 'notebook_list_notes',
      'notebook_execute_code', 'notebook_create_backlink', 'notebook_export_note',
      'notebook_search_notes', 'notebook_delete_note',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_note': {
        return emitPluginEvent('notebook', 'create_note', args)
      }
      case 'update_note': {
        return emitPluginEvent('notebook', 'update_note', args)
      }
      case 'list_notes': {
        return emitPluginQuery('notebook', 'list_notes', args)
      }
      case 'execute_code': {
        return emitPluginEvent('notebook', 'execute_code', args)
      }
      case 'create_backlink': {
        return emitPluginEvent('notebook', 'create_backlink', args)
      }
      case 'export_note': {
        return emitPluginEvent('notebook', 'export_note', args)
      }
      case 'search_notes': {
        return emitPluginQuery('notebook', 'search_notes', args)
      }
      case 'delete_note': {
        return emitPluginEvent('notebook', 'delete_note', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 7. Tactical Tool
// ============================================================

const tacticalTool: ToolDefinition = {
  name: 'tactical',
  description: '战术面板操作：部署/移动/撤销单位、战场状态查询、回合模拟、战斗日志导出、单位属性查询、地形设置',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['deploy_unit', 'move_unit', 'get_battle_state', 'simulate_turn', 'export_battle_log', 'undo_move', 'get_unit_stats', 'set_terrain'],
    },
    unitId: { type: 'string', description: '单位ID' },
    position: { type: 'object', description: '坐标 { x: number, y: number }（deploy_unit 用）' },
    formation: { type: 'string', description: '编队/阵型名称' },
    newPosition: { type: 'object', description: '新坐标 { x: number, y: number }（move_unit 用）' },
    actions: { type: 'array', description: '行动列表 [{ unitId, action, target?, ... }]（simulate_turn 用）' },
    format: { type: 'string', description: '导出格式: json / markdown / html' },
    terrainData: { type: 'object', description: '地形数据（set_terrain 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'tactical_deploy_unit', 'tactical_move_unit', 'tactical_get_battle_state',
      'tactical_simulate_turn', 'tactical_export_battle_log',
      'tactical_undo_move', 'tactical_get_unit_stats', 'tactical_set_terrain',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'deploy_unit': {
        return emitPluginEvent('tactical-board', 'deploy_unit', args)
      }
      case 'move_unit': {
        return emitPluginEvent('tactical-board', 'move_unit', args)
      }
      case 'get_battle_state': {
        return emitPluginQuery('tactical-board', 'get_battle_state')
      }
      case 'simulate_turn': {
        return emitPluginEvent('tactical-board', 'simulate_turn', args)
      }
      case 'export_battle_log': {
        return emitPluginEvent('tactical-board', 'export_battle_log', args)
      }
      case 'undo_move': {
        return emitPluginEvent('tactical-board', 'undo_move', args)
      }
      case 'get_unit_stats': {
        return emitPluginQuery('tactical-board', 'get_unit_stats', args)
      }
      case 'set_terrain': {
        return emitPluginEvent('tactical-board', 'set_terrain', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 8. Magic Tool
// ============================================================

const magicTool: ToolDefinition = {
  name: 'magic',
  description: '魔法技能树操作：创建/更新/删除节点、获取/验证/导出技能树、依赖检查',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_skill_node', 'update_skill_node', 'get_skill_tree', 'validate_tree', 'export_skill_tree', 'delete_skill_node', 'check_dependencies'],
    },
    name: { type: 'string', description: '技能名称（create_skill_node 用）' },
    parentId: { type: 'string', description: '父节点ID（root表示根技能）' },
    cost: { type: 'number', description: '技能点花费' },
    description: { type: 'string', description: '技能描述' },
    effects: { type: 'object', description: '技能效果配置' },
    nodeId: { type: 'string', description: '节点ID' },
    changes: { type: 'object', description: '要修改的字段 { name?, cost?, description?, effects? }' },
    format: { type: 'string', description: '导出格式: json / png / svg' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'magic_create_skill_node', 'magic_update_skill_node', 'magic_get_skill_tree',
      'magic_validate_tree', 'magic_export_skill_tree', 'magic_delete_skill_node', 'magic_check_dependencies',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_skill_node': {
        return emitPluginEvent('magic', 'create_skill_node', args)
      }
      case 'update_skill_node': {
        return emitPluginEvent('magic', 'update_skill_node', args)
      }
      case 'get_skill_tree': {
        return emitPluginQuery('magic', 'get_skill_tree')
      }
      case 'validate_tree': {
        return emitPluginQuery('magic', 'validate_tree')
      }
      case 'export_skill_tree': {
        return emitPluginEvent('magic', 'export_skill_tree', args)
      }
      case 'delete_skill_node': {
        return emitPluginEvent('magic', 'delete_skill_node', args)
      }
      case 'check_dependencies': {
        return emitPluginQuery('magic', 'check_dependencies', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 9. Module Builder Tool
// ============================================================

const moduleBuilderTool: ToolDefinition = {
  name: 'module_builder',
  description: '自定义模块管理：创建/删除/列出模块、组件排序',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['create_module', 'delete_module', 'list_modules', 'reorder_components'],
    },
    name: { type: 'string', description: '模块名称（create_module 用）' },
    description: { type: 'string', description: '模块描述' },
    layout: { type: 'string', description: '布局类型: dashboard / editor / manager / analyzer' },
    moduleId: { type: 'string', description: '模块ID' },
    componentIds: { type: 'array', description: '组件ID新顺序（reorder_components 用）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      'module_builder_create_module', 'module_builder_delete_module',
      'module_builder_list_modules', 'module_builder_reorder_components',
    ],
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    switch (action) {
      case 'create_module': {
        return emitPluginEvent('module-builder', 'create_module', args)
      }
      case 'delete_module': {
        return emitPluginEvent('module-builder', 'delete_module', args)
      }
      case 'list_modules': {
        return emitPluginQuery('module-builder', 'list_modules')
      }
      case 'reorder_components': {
        return emitPluginEvent('module-builder', 'reorder_components', args)
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// 10. Entity Type Tool
// ============================================================

interface EntityTypePluginConfig {
  pluginId: string
  entityType: string
  label: string
  filterFields: string[]
}

const ENTITY_TYPE_PLUGIN_CONFIGS: EntityTypePluginConfig[] = [
  { pluginId: 'character', entityType: 'character', label: '角色', filterFields: ['role', 'affiliation', 'race', 'gender'] },
  { pluginId: 'culture', entityType: 'culture', label: '文化条目', filterFields: ['cultureType'] },
  { pluginId: 'language', entityType: 'language', label: '语言', filterFields: ['langType', 'scope', 'maturity'] },
  { pluginId: 'conflict', entityType: 'conflict', label: '冲突', filterFields: ['conflictType', 'scale'] },
  { pluginId: 'building', entityType: 'building', label: '建筑', filterFields: ['buildingType', 'style', 'status'] },
  { pluginId: 'item', entityType: 'item', label: '道具', filterFields: ['itemType', 'rarity', 'condition'] },
  { pluginId: 'concept', entityType: 'concept', label: '概念', filterFields: ['conceptType'] },
  { pluginId: 'combat_stat', entityType: 'combat_stat', label: '战力条目', filterFields: ['system', 'culture'] },
  { pluginId: 'apparel', entityType: 'apparel', label: '服饰', filterFields: ['apparelType', 'armorClass', 'style'] },
  { pluginId: 'inspiration', entityType: 'inspiration', label: '素材', filterFields: ['materialType'] },
]

const ENTITY_TYPE_ENUMS = ENTITY_TYPE_PLUGIN_CONFIGS.map(c => c.pluginId)

const entityTypeTool: ToolDefinition = {
  name: 'entity_type',
  description: '实体类型 CRUD：对角色/文化/语言/冲突/建筑/道具/概念/战力/服饰/素材进行列表/创建/更新/详情查询',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['list', 'create', 'update', 'get_detail'],
    },
    entity_type: {
      type: 'string',
      description: '实体类型',
      required: true,
      enum: ENTITY_TYPE_ENUMS,
    },
    name: { type: 'string', description: '实体名称（create 用）' },
    description: { type: 'string', description: '描述' },
    properties: { type: 'object', description: '属性字段（create/update 用）' },
    tags: { type: 'array', description: '标签列表' },
    entityTypeId: { type: 'string', description: '实体ID（update/get_detail 用）' },
    changes: { type: 'object', description: '要修改的字段（update 用）' },
    // 动态过滤字段（list 用）—— 各实体类型特有的过滤参数
    role: { type: 'string', description: '按 role 过滤（character）' },
    affiliation: { type: 'string', description: '按 affiliation 过滤（character）' },
    race: { type: 'string', description: '按 race 过滤（character）' },
    gender: { type: 'string', description: '按 gender 过滤（character）' },
    cultureType: { type: 'string', description: '按 cultureType 过滤（culture）' },
    langType: { type: 'string', description: '按 langType 过滤（language）' },
    scope: { type: 'string', description: '按 scope 过滤（language）' },
    maturity: { type: 'string', description: '按 maturity 过滤（language）' },
    conflictType: { type: 'string', description: '按 conflictType 过滤（conflict）' },
    scale: { type: 'string', description: '按 scale 过滤（conflict）' },
    buildingType: { type: 'string', description: '按 buildingType 过滤（building）' },
    style: { type: 'string', description: '按 style 过滤（building/apparel）' },
    status: { type: 'string', description: '按 status 过滤（building）' },
    itemType: { type: 'string', description: '按 itemType 过滤（item）' },
    rarity: { type: 'string', description: '按 rarity 过滤（item）' },
    condition: { type: 'string', description: '按 condition 过滤（item）' },
    conceptType: { type: 'string', description: '按 conceptType 过滤（concept）' },
    system: { type: 'string', description: '按 system 过滤（combat_stat）' },
    culture: { type: 'string', description: '按 culture 过滤（combat_stat）' },
    apparelType: { type: 'string', description: '按 apparelType 过滤（apparel）' },
    armorClass: { type: 'string', description: '按 armorClass 过滤（apparel）' },
    materialType: { type: 'string', description: '按 materialType 过滤（inspiration）' },
  },
  meta: {
    permission: 'moderate' as const,
    category: 'plugin' as const,
    aliases: [
      // character
      'character_list', 'character_create', 'character_update', 'character_get_detail',
      // culture
      'culture_list', 'culture_create', 'culture_update', 'culture_get_detail',
      // language
      'language_list', 'language_create', 'language_update', 'language_get_detail',
      // conflict
      'conflict_list', 'conflict_create', 'conflict_update', 'conflict_get_detail',
      // building
      'building_list', 'building_create', 'building_update', 'building_get_detail',
      // item
      'item_list', 'item_create', 'item_update', 'item_get_detail',
      // concept
      'concept_list', 'concept_create', 'concept_update', 'concept_get_detail',
      // combat_stat
      'combat_stat_list', 'combat_stat_create', 'combat_stat_update', 'combat_stat_get_detail',
      // apparel
      'apparel_list', 'apparel_create', 'apparel_update', 'apparel_get_detail',
      // inspiration
      'inspiration_list', 'inspiration_create', 'inspiration_update', 'inspiration_get_detail',
    ],
  },
  execute: async (args, ctx) => {
    const action = String(args.action)
    const entityTypeValue = String(args.entity_type)
    const config = ENTITY_TYPE_PLUGIN_CONFIGS.find(c => c.pluginId === entityTypeValue)
    if (!config) {
      return JSON.stringify({ error: `未知实体类型: ${entityTypeValue}`, hint: `可选: ${ENTITY_TYPE_ENUMS.join(', ')}` })
    }
    const { entityType, label, filterFields } = config

    switch (action) {
      case 'list': {
        let entities = await ctx.stores.entity.getAllEntities()
        let filtered = entities.filter((e: any) => e.type === entityType)
        for (const field of filterFields) {
          if (args[field]) {
            const val = String(args[field])
            filtered = filtered.filter((e: any) =>
              e.properties?.[field] === val ||
              (e[field] && String(e[field]).toLowerCase().includes(val.toLowerCase()))
            )
          }
        }
        const results = filtered.map((e: any) => ({
          id: e.id, name: e.name, description: e.description || '',
          properties: e.properties || {}, tags: e.tags || [],
        }))
        return JSON.stringify({ total: filtered.length, items: results })
      }
      case 'create': {
        const entities = await ctx.stores.entity.getAllEntities()
        const duplicate = entities.some((e: any) => e.type === entityType && e.name === String(args.name))
        if (duplicate) {
          return JSON.stringify({ error: `已存在同名${label} "${args.name}"`, hint: `请使用不同名称或先用 entity_type list 查看` })
        }
        const entity = {
          id: crypto.randomUUID(),
          type: entityType,
          name: String(args.name),
          description: String(args.description || ''),
          properties: (args.properties as Record<string, unknown>) || {},
          tags: Array.isArray(args.tags) ? args.tags : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        const id = await ctx.stores.entity.add(entity, 'agent')
        emitEntityCard(ctx, { ...entity, id })
        indexEntity({ ...entity, id }).catch(() => {})
        return JSON.stringify({ success: true, id, name: entity.name })
      }
      case 'update': {
        const entityId = String(args.entityTypeId)
        const existing = await ctx.stores.entity.getById(entityId)
        if (!existing) return JSON.stringify({ error: `${label} ${entityId} 不存在` })
        const changes = (args.changes || {}) as Record<string, unknown>
        const updates: Record<string, unknown> = {}
        if (changes.name) updates.name = String(changes.name)
        if (changes.description) updates.description = String(changes.description)
        const newProps = { ...(existing.properties || {}) }
        for (const [key, val] of Object.entries(changes)) {
          if (key !== 'name' && key !== 'description') newProps[key] = val
        }
        updates.properties = newProps
        await ctx.stores.entity.update(entityId, updates, 'agent')
        const updated = await ctx.stores.entity.getById(entityId)
        if (updated) {
          emitEntityCard(ctx, updated)
          indexEntity(updated).catch(() => {})
        }
        return JSON.stringify({ success: true, id: entityId })
      }
      case 'get_detail': {
        const entityId = String(args.entityTypeId)
        const existing = await ctx.stores.entity.getById(entityId)
        if (!existing) return JSON.stringify({ error: `${label} ${entityId} 不存在` })
        return JSON.stringify({
          id: existing.id, name: existing.name, description: existing.description || '',
          properties: existing.properties || {}, tags: existing.tags || [],
          createdAt: existing.createdAt, updatedAt: existing.updatedAt,
        })
      }
      default:
        return JSON.stringify({ error: `未知操作: ${action}` })
    }
  },
}

// ============================================================
// Unified Export
// ============================================================

export const PLUGIN_BACKEND_TOOLS: ToolDefinition[] = [
  timelineTool,
  graphTool,
  mindmapTool,
  manuscriptTool,
  outlineTool,
  notebookTool,
  tacticalTool,
  magicTool,
  moduleBuilderTool,
  entityTypeTool,
]

/**
 * 旧工具名 → 新域级工具名 映射
 *
 * 用于 tool-meta-registry 等消费方的兼容性查询
 */
export const LEGACY_PLUGIN_MAP: Record<string, string> = {
  // timeline
  timeline_create_event: 'timeline',
  timeline_update_event: 'timeline',
  timeline_sort_events: 'timeline',
  timeline_detect_conflicts: 'timeline',
  timeline_get_events: 'timeline',
  timeline_export_timeline: 'timeline',
  timeline_set_layout_mode: 'timeline',
  timeline_set_group_mode: 'timeline',
  timeline_zoom: 'timeline',
  timeline_toggle_collapse: 'timeline',
  // graph
  graph_get_nodes: 'graph',
  graph_get_edges: 'graph',
  graph_find_path: 'graph',
  graph_cluster_analysis: 'graph',
  graph_highlight_nodes: 'graph',
  graph_export_snapshot: 'graph',
  graph_filter_by_type: 'graph',
  graph_search_subgraph: 'graph',
  // mindmap
  mindmap_create_node: 'mindmap',
  mindmap_update_node: 'mindmap',
  mindmap_delete_node: 'mindmap',
  mindmap_get_structure: 'mindmap',
  mindmap_auto_layout: 'mindmap',
  mindmap_export_image: 'mindmap',
  mindmap_batch_create: 'mindmap',
  mindmap_search_node: 'mindmap',
  mindmap_find_isolated_nodes: 'mindmap',
  mindmap_find_cycles: 'mindmap',
  mindmap_highlight_path: 'mindmap',
  mindmap_suggest_move_to_group: 'mindmap',
  mindmap_ai_organize: 'mindmap',
  // manuscript
  manuscript_create_chapter: 'manuscript',
  manuscript_update_chapter: 'manuscript',
  manuscript_list_chapters: 'manuscript',
  manuscript_get_chapter_content: 'manuscript',
  manuscript_insert_mention: 'manuscript',
  manuscript_export_document: 'manuscript',
  manuscript_reorder_chapters: 'manuscript',
  manuscript_split_chapter: 'manuscript',
  // outline
  outline_create_node: 'outline',
  outline_update_node: 'outline',
  outline_move_node: 'outline',
  outline_get_structure: 'outline',
  outline_link_entity: 'outline',
  outline_export_outline: 'outline',
  outline_delete_node: 'outline',
  outline_batch_create: 'outline',
  // notebook
  notebook_create_note: 'notebook',
  notebook_update_note: 'notebook',
  notebook_list_notes: 'notebook',
  notebook_execute_code: 'notebook',
  notebook_create_backlink: 'notebook',
  notebook_export_note: 'notebook',
  notebook_search_notes: 'notebook',
  notebook_delete_note: 'notebook',
  // tactical
  tactical_deploy_unit: 'tactical',
  tactical_move_unit: 'tactical',
  tactical_get_battle_state: 'tactical',
  tactical_simulate_turn: 'tactical',
  tactical_export_battle_log: 'tactical',
  tactical_undo_move: 'tactical',
  tactical_get_unit_stats: 'tactical',
  tactical_set_terrain: 'tactical',
  // magic
  magic_create_skill_node: 'magic',
  magic_update_skill_node: 'magic',
  magic_get_skill_tree: 'magic',
  magic_validate_tree: 'magic',
  magic_export_skill_tree: 'magic',
  magic_delete_skill_node: 'magic',
  magic_check_dependencies: 'magic',
  // module_builder
  module_builder_create_module: 'module_builder',
  module_builder_delete_module: 'module_builder',
  module_builder_list_modules: 'module_builder',
  module_builder_reorder_components: 'module_builder',
  // entity_type (10 types × 4 actions)
  character_list: 'entity_type',
  character_create: 'entity_type',
  character_update: 'entity_type',
  character_get_detail: 'entity_type',
  culture_list: 'entity_type',
  culture_create: 'entity_type',
  culture_update: 'entity_type',
  culture_get_detail: 'entity_type',
  language_list: 'entity_type',
  language_create: 'entity_type',
  language_update: 'entity_type',
  language_get_detail: 'entity_type',
  conflict_list: 'entity_type',
  conflict_create: 'entity_type',
  conflict_update: 'entity_type',
  conflict_get_detail: 'entity_type',
  building_list: 'entity_type',
  building_create: 'entity_type',
  building_update: 'entity_type',
  building_get_detail: 'entity_type',
  item_list: 'entity_type',
  item_create: 'entity_type',
  item_update: 'entity_type',
  item_get_detail: 'entity_type',
  concept_list: 'entity_type',
  concept_create: 'entity_type',
  concept_update: 'entity_type',
  concept_get_detail: 'entity_type',
  combat_stat_list: 'entity_type',
  combat_stat_create: 'entity_type',
  combat_stat_update: 'entity_type',
  combat_stat_get_detail: 'entity_type',
  apparel_list: 'entity_type',
  apparel_create: 'entity_type',
  apparel_update: 'entity_type',
  apparel_get_detail: 'entity_type',
  inspiration_list: 'entity_type',
  inspiration_create: 'entity_type',
  inspiration_update: 'entity_type',
  inspiration_get_detail: 'entity_type',
}
