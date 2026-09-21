/**
 * 世界观芽动作表（worldview 工具的执行面）
 *
 * 单一事实源：原 10 个域工具（timeline / graph / mindmap / manuscript / outline /
 * notebook / tactical / magic / module_builder / entity_type）的 switch 分支统一迁入此处；
 * `plugin-backend-tools.ts` 的旧工具定义改为薄壳转发（批 3 退役）。
 *
 * 键结构：芽 id（official.xxx）→ action → SproutAction。
 * `params` 为「说明目录」用的参数说明（中性描述；从执行分支实况梳理，非全量 schema 投影）。
 */
import type { IToolContext } from '../../toolbus/types'
import { emitEntityCard } from '../a2ui-helpers'
import { indexEntity } from '../../embedding/index'

// ────────────────────────────────────────────────────────────
// 共用派发（自 plugin-backend-tools 原样迁入）
// ────────────────────────────────────────────────────────────

function emitPluginEvent(pluginId: string, action: string, payload: unknown): string {
  try {
    const detail = { pluginId, action, payload, timestamp: Date.now() }
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('worldsea:agent:plugin-action', { detail }))
    }
    // 诚实化口径（2026-09-14 全局桥拍板）：dispatched=true 只代表事件已派发。
    // 数据动作由 app 级桥消费（agentDataBridges.ts，与视图挂载无关）→ 必达；
    // UI 动作（导航/开对话框等）仍需对应视图挂载，未挂载时无人消费。
    return JSON.stringify({ ok: true, pluginId, action, dispatched: true, note: '数据动作由 app 级桥必达消费；UI 动作需对应视图挂载' })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) })
  }
}

/** 等待 app 级桥回传查询结果（requestId 配对；3s 超时 = 桥未注册该查询/未安装） */
function waitQueryResult(requestId: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve({ ok: false, error: '查询超时：数据桥未注册该查询或未安装（视图/桥未就绪）' })
    }, timeoutMs)
    const onResult = (e: Event) => {
      const d = (e as CustomEvent).detail as { requestId?: string; result?: unknown } | undefined
      if (!d || d.requestId !== requestId) return
      cleanup()
      resolve({ ok: true, data: d.result })
    }
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('worldsea:agent:plugin-query-result', onResult)
    }
    window.addEventListener('worldsea:agent:plugin-query-result', onResult)
  })
}

/**
 * 查询派发（2026-09-14 真回传改造）：带 requestId 派发并等待 app 级桥
 * （agentDataBridges.ts）回传结果——同步读 store，3s 超时报「桥未就绪」。
 */
async function emitPluginQuery(pluginId: string, query: string, params?: unknown): Promise<string> {
  try {
    if (typeof window === 'undefined' || !window.dispatchEvent) {
      return JSON.stringify({ ok: false, error: '非浏览器环境，查询不可用' })
    }
    const requestId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    window.dispatchEvent(new CustomEvent('worldsea:agent:plugin-query', {
      detail: { pluginId, query, params, requestId, timestamp: Date.now() },
    }))
    const result = await waitQueryResult(requestId, 3000)
    return JSON.stringify(result)
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) })
  }
}

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

export interface SproutActionParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required?: boolean
  enum?: string[]
}

export interface SproutAction {
  name: string
  /** 中性描述（进说明目录） */
  description: string
  /** 参数说明（进说明目录） */
  params?: Record<string, SproutActionParam>
  run: (args: Record<string, unknown>, ctx: IToolContext) => Promise<string>
}

export type SproutActionTable = Record<string, Record<string, SproutAction>>

/** 按「芽 id + 动作名」执行（旧工具薄壳与 worldview 工具共用入口） */
export async function runSproutAction(
  sproutId: string,
  action: string,
  args: Record<string, unknown>,
  ctx: IToolContext,
): Promise<string> {
  const table = SPROUT_ACTIONS[sproutId]
  const handler = table?.[action]
  if (!handler) {
    return JSON.stringify({
      ok: false,
      error: `未知动作: ${action}`,
      availableActions: table ? Object.keys(table) : [],
    })
  }
  return handler.run(args, ctx)
}

/** 旧 entity_type 薄壳的转发入口：实体类型 → 对应芽（见 ENTITY_TYPE_SPROUT_CONFIGS） */
export async function runEntityTypeAction(
  entityType: string,
  action: string,
  args: Record<string, unknown>,
  ctx: IToolContext,
): Promise<string> {
  const config = ENTITY_TYPE_SPROUT_CONFIGS.find((c) => c.entityType === entityType)
  if (!config) {
    return JSON.stringify({
      ok: false,
      error: `未知实体类型: ${entityType}`,
      available: ENTITY_TYPE_SPROUT_CONFIGS.map((c) => c.entityType),
    })
  }
  return runSproutAction(config.sproutId, action, args, ctx)
}

// ────────────────────────────────────────────────────────────
// 1. timeline（official.timeline）· 10 动作
// ────────────────────────────────────────────────────────────

const TIMELINE_ACTIONS: Record<string, SproutAction> = {
  create_event: {
    name: 'create_event',
    description: '创建时间线事件',
    params: {
      name: { type: 'string', description: '事件名称', required: true },
      date: { type: 'string', description: '事件日期（如 1200-01-15 或 第三纪元1420年）' },
      dateEnd: { type: 'string', description: '结束日期（持续事件）' },
      description: { type: 'string', description: '事件描述' },
      era: { type: 'string', description: '所属年代' },
      importance: { type: 'string', description: '重要性：普通 / 重要 / 关键 / 细微' },
      status: { type: 'string', description: '状态：正史 / 传闻 / 传说' },
      location: { type: 'string', description: '发生地点' },
      parentId: { type: 'string', description: '父级事件名称' },
      tags: { type: 'array', description: '标签列表' },
    },
    run: async (args, ctx) => {
      const entityName = String(args.name)
      const entities = await ctx.stores.entity.getAllEntities()
      const duplicate = entities.some((e: any) => e.type === 'event' && e.name === entityName)
      if (duplicate) {
        return JSON.stringify({ error: `已存在同名事件 "${entityName}"`, hint: '请使用不同名称或先用 worldview(sprout=\'时间线\', action=\'get_events\') 查看' })
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
    },
  },
  update_event: {
    name: 'update_event',
    description: '更新事件（增量：未提及字段不动）',
    params: {
      eventId: { type: 'string', description: '事件 ID', required: true },
      changes: { type: 'object', description: '要修改的字段 { name?, date?, dateEnd?, description?, era?, importance?, status?, location?, parentId? }' },
    },
    run: async (args, ctx) => {
      const entityId = String(args.eventId)
      const existing = await ctx.stores.entity.getById(entityId)
      if (!existing) return JSON.stringify({ error: `事件 ${entityId} 不存在`, hint: '请使用 worldview(sprout=\'时间线\', action=\'get_events\') 查看现有事件' })
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
    },
  },
  sort_events: {
    name: 'sort_events',
    description: '按时间排序事件（chronological 正序 / reverse 倒序）',
    params: {
      method: { type: 'string', description: '排序方式：chronological（时间顺序）/ reverse（倒序）' },
    },
    run: async (args) => emitPluginEvent('timeline', 'sort_events', args),
  },
  detect_conflicts: {
    name: 'detect_conflicts',
    description: '检测时间线中日期相近的事件（默认阈值 30 天）',
    params: {
      threshold: { type: 'number', description: '时间阈值（天），默认 30' },
    },
    run: async (args, ctx) => {
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
    },
  },
  get_events: {
    name: 'get_events',
    description: '获取事件列表（可按年代、重要性、关键词过滤，可设上限）',
    params: {
      era: { type: 'string', description: '按年代过滤' },
      importance: { type: 'string', description: '按重要性过滤' },
      keyword: { type: 'string', description: '按关键词搜索' },
      limit: { type: 'number', description: '返回数量上限，默认 20' },
    },
    run: async (args, ctx) => {
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
    },
  },
  export: {
    name: 'export',
    description: '导出时间线数据（json / csv / mermaid）',
    params: {
      format: { type: 'string', description: '导出格式：json / csv / mermaid' },
    },
    run: async (args) => emitPluginEvent('timeline', 'export', args),
  },
  set_layout_mode: {
    name: 'set_layout_mode',
    description: '切换时间线布局模式（horizontal / vertical）',
    params: {
      mode: { type: 'string', description: '布局模式：horizontal / vertical' },
    },
    run: async (args) => emitPluginEvent('timeline', 'set_layout_mode', args),
  },
  set_group_mode: {
    name: 'set_group_mode',
    description: '设置泳道分组（character / location / era / tag / none）',
    params: {
      groupBy: { type: 'string', description: '分组方式：character / location / era / tag / none' },
    },
    run: async (args) => emitPluginEvent('timeline', 'set_group_mode', args),
  },
  zoom: {
    name: 'zoom',
    description: '缩放时间线视图（era / decade / year / month / day）',
    params: {
      level: { type: 'string', description: '缩放级别：era / decade / year / month / day' },
    },
    run: async (args) => emitPluginEvent('timeline', 'zoom', args),
  },
  toggle_collapse: {
    name: 'toggle_collapse',
    description: '折叠 / 展开事件节点',
    params: {
      eventId: { type: 'string', description: '事件 ID' },
      collapsed: { type: 'boolean', description: '是否折叠' },
    },
    run: async (args) => emitPluginEvent('timeline', 'toggle_collapse', args),
  },
}

// ────────────────────────────────────────────────────────────
// 2. graph（official.graph）· 8 动作
// ────────────────────────────────────────────────────────────

const GRAPH_ACTIONS: Record<string, SproutAction> = {
  get_nodes: {
    name: 'get_nodes',
    description: '获取图谱节点列表（可按实体类型过滤、关键词搜索）',
    params: {
      type: { type: 'string', description: '实体类型过滤' },
      keyword: { type: 'string', description: '关键词搜索' },
    },
    run: async (args) => emitPluginQuery('graph', 'get_nodes', args),
  },
  get_edges: {
    name: 'get_edges',
    description: '获取图谱边列表（可按源 / 目标节点、关系类型过滤）',
    params: {
      sourceId: { type: 'string', description: '源节点 ID' },
      targetId: { type: 'string', description: '目标节点 ID' },
      type: { type: 'string', description: '关系类型过滤' },
    },
    run: async (args) => emitPluginQuery('graph', 'get_edges', args),
  },
  find_path: {
    name: 'find_path',
    description: '查找两节点间路径',
    params: {
      sourceId: { type: 'string', description: '源节点 ID' },
      targetId: { type: 'string', description: '目标节点 ID' },
    },
    run: async (args) => emitPluginQuery('graph', 'find_path', args),
  },
  cluster_analysis: {
    name: 'cluster_analysis',
    description: '聚类分析（louvain / label_propagation / k_means）',
    params: {
      method: { type: 'string', description: '聚类算法：louvain / label_propagation / k_means' },
    },
    run: async (args) => emitPluginQuery('graph', 'cluster_analysis', args),
  },
  highlight_nodes: {
    name: 'highlight_nodes',
    description: '高亮指定节点',
    params: {
      nodeIds: { type: 'array', description: '要高亮的节点 ID 列表' },
    },
    run: async (args) => emitPluginEvent('graph', 'highlight_nodes', args),
  },
  export_snapshot: {
    name: 'export_snapshot',
    description: '导出图谱快照（png / svg / json）',
    params: {
      format: { type: 'string', description: '导出格式：png / svg / json' },
    },
    run: async (args) => emitPluginEvent('graph', 'export_snapshot', args),
  },
  filter_by_type: {
    name: 'filter_by_type',
    description: '按实体类型过滤图谱显示',
    params: {
      types: { type: 'array', description: '要显示的实体类型列表' },
    },
    run: async (args) => emitPluginEvent('graph', 'filter_by_type', args),
  },
  search_subgraph: {
    name: 'search_subgraph',
    description: '搜索以某节点为中心的子图',
    params: {
      centerId: { type: 'string', description: '中心节点 ID' },
      depth: { type: 'number', description: '搜索深度，默认 2' },
    },
    run: async (args) => emitPluginQuery('graph', 'search_subgraph', args),
  },
}

// ────────────────────────────────────────────────────────────
// 3. mindmap（official.mindmap）· 13 动作
// ────────────────────────────────────────────────────────────

const MINDMAP_ACTIONS: Record<string, SproutAction> = {
  create_node: {
    name: 'create_node',
    description: '创建节点（支持父节点、标签文本、样式配置）',
    params: {
      parentId: { type: 'string', description: '父节点 ID（根节点则为 root）' },
      label: { type: 'string', description: '节点标签' },
      style: { type: 'object', description: '节点样式配置' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'create_node', args),
  },
  update_node: {
    name: 'update_node',
    description: '更新节点（标签、样式、折叠状态）',
    params: {
      nodeId: { type: 'string', description: '节点 ID' },
      changes: { type: 'object', description: '要修改的字段 { label?, style?, collapsed? }' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'update_node', args),
  },
  delete_node: {
    name: 'delete_node',
    description: '删除节点（含子节点级联删除）',
    params: {
      nodeId: { type: 'string', description: '节点 ID' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'delete_node', args),
  },
  get_structure: {
    name: 'get_structure',
    description: '获取整棵树结构（含所有节点层级与样式）',
    run: async () => emitPluginQuery('mindmap', 'get_structure'),
  },
  auto_layout: {
    name: 'auto_layout',
    description: '自动布局（tree / radial / fishbone）',
    params: {
      algorithm: { type: 'string', description: '布局算法：tree / radial / fishbone' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'auto_layout', args),
  },
  export_image: {
    name: 'export_image',
    description: '导出为图片（png / svg）',
    params: {
      format: { type: 'string', description: '格式：png / svg' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'export_image', args),
  },
  batch_create: {
    name: 'batch_create',
    description: '从结构化数据批量创建节点',
    params: {
      structure: { type: 'object', description: '树形结构数据 { label, children?: [...] }' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'batch_create', args),
  },
  search_node: {
    name: 'search_node',
    description: '按关键词搜索节点',
    params: {
      keyword: { type: 'string', description: '搜索关键词' },
    },
    run: async (args) => emitPluginQuery('mindmap', 'search_node', args),
  },
  find_isolated: {
    name: 'find_isolated',
    description: '查找孤立节点',
    run: async () => emitPluginEvent('mindmap', 'find_isolated', {}),
  },
  find_cycles: {
    name: 'find_cycles',
    description: '查找环',
    params: {
      maxDepth: { type: 'number', description: '最大搜索深度，默认 6' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'find_cycles', args),
  },
  highlight_path: {
    name: 'highlight_path',
    description: '高亮两节点之间的路径',
    params: {
      sourceId: { type: 'string', description: '起始节点 ID' },
      targetId: { type: 'string', description: '目标节点 ID' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'highlight_path', args),
  },
  suggest_move_to_group: {
    name: 'suggest_move_to_group',
    description: '给出节点移动到分组的方案（不直接移动）',
    params: {
      groupId: { type: 'string', description: '目标分组 ID' },
    },
    run: async (args) => emitPluginEvent('mindmap', 'suggest_move_to_group', args),
  },
  ai_organize: {
    name: 'ai_organize',
    description: 'AI 整理导图结构',
    run: async () => emitPluginEvent('mindmap', 'ai_organize', {}),
  },
}

// ────────────────────────────────────────────────────────────
// 4. manuscript（official.manuscript）· 8 动作
// ────────────────────────────────────────────────────────────

const MANUSCRIPT_ACTIONS: Record<string, SproutAction> = {
  create_chapter: {
    name: 'create_chapter',
    description: '创建章节',
    params: {
      title: { type: 'string', description: '章节标题', required: true },
      content: { type: 'string', description: '初始正文内容' },
      volumeName: { type: 'string', description: '所属卷名' },
      status: { type: 'string', description: '状态：draft / writing / review / done' },
      bookId: { type: 'string', description: '目标书籍 ID（不传 = 未归书章节）' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'create_chapter', args),
  },
  update_chapter: {
    name: 'update_chapter',
    description: '更新章节内容或状态',
    params: {
      chapterId: { type: 'string', description: '章节 ID', required: true },
      content: { type: 'string', description: '新正文内容' },
      status: { type: 'string', description: '状态：draft / writing / review / done' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'update_chapter', args),
  },
  list_chapters: {
    name: 'list_chapters',
    description: '列出章节（可按卷名过滤）',
    params: {
      volumeName: { type: 'string', description: '按卷名过滤' },
    },
    run: async (args) => emitPluginQuery('manuscript', 'list_chapters', args),
  },
  get_chapter_content: {
    name: 'get_chapter_content',
    description: '获取章节完整内容（含富文本与实体引用）',
    params: {
      chapterId: { type: 'string', description: '章节 ID', required: true },
    },
    run: async (args) => emitPluginQuery('manuscript', 'get_chapter_content', args),
  },
  insert_mention: {
    name: 'insert_mention',
    description: '在章节中插入实体引用（@提及）',
    params: {
      chapterId: { type: 'string', description: '章节 ID' },
      entityId: { type: 'string', description: '要引用的实体 ID' },
      position: { type: 'number', description: '插入位置（字符偏移）' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'insert_mention', args),
  },
  export_document: {
    name: 'export_document',
    description: '导出文档（html / pdf / markdown / docx，可选章节范围）',
    params: {
      format: { type: 'string', description: '导出格式：html / pdf / markdown / docx' },
      chapters: { type: 'array', description: '指定导出的章节 ID 列表' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'export_document', args),
  },
  reorder_chapters: {
    name: 'reorder_chapters',
    description: '调整章节顺序',
    params: {
      chapterIds: { type: 'array', description: '章节 ID 新顺序' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'reorder_chapters', args),
  },
  split_chapter: {
    name: 'split_chapter',
    description: '拆分章节为多个子章节',
    params: {
      chapterId: { type: 'string', description: '章节 ID' },
      splitPoints: { type: 'array', description: '拆分点（字符偏移数组）' },
    },
    run: async (args) => emitPluginEvent('manuscript', 'split_chapter', args),
  },
}

// ────────────────────────────────────────────────────────────
// 5. outline（official.outline）· 8 动作
// ────────────────────────────────────────────────────────────

const OUTLINE_ACTIONS: Record<string, SproutAction> = {
  create_node: {
    name: 'create_node',
    description: '创建单个大纲节点',
    params: {
      title: { type: 'string', description: '节点标题', required: true },
      parentId: { type: 'string', description: '父节点 ID（根节点为 root）' },
      type: { type: 'string', description: '节点类型：act / sequence / scene / beat' },
    },
    run: async (args) => emitPluginEvent('outline', 'create_node', args),
  },
  update_node: {
    name: 'update_node',
    description: '增量更新节点字段（未提及的字段保持不动）',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
      changes: { type: 'object', description: '要修改的字段 { title?, type?, description?, status? }；摘要用 description 或 summary（等价，均写入实体 description）' },
    },
    run: async (args) => emitPluginEvent('outline', 'update_node', args),
  },
  move_node: {
    name: 'move_node',
    description: '移动节点到新父节点下的指定位置',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
      newParentId: { type: 'string', description: '新父节点 ID' },
      position: { type: 'number', description: '在新父节点中的位置索引' },
    },
    run: async (args) => emitPluginEvent('outline', 'move_node', args),
  },
  get_structure: {
    name: 'get_structure',
    description: '获取大纲完整树结构（层级 + 标题 / 类型 / 状态）',
    run: async () => emitPluginQuery('outline', 'get_structure'),
  },
  link_entity: {
    name: 'link_entity',
    description: '把节点关联到角色 / 地点 / 事件等实体（或解除关联）',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
      entities: { type: 'object', description: '要关联的实体数组 [{ entityId, relation? }]。relation 取 mentions（提及，默认）/ located_in（发生于，目标须是区域或建筑）/ covers（承载，目标须是事件或冲突）' },
      unlink: { type: 'boolean', description: 'true 则解除关联而非建立' },
    },
    // 派发到 app 级桥的 `outline:link_entity`（真写关系表）
    run: async (args) => emitPluginEvent('outline', 'link_entity', args),
  },
  export_outline: {
    name: 'export_outline',
    description: '导出大纲（text / json / markdown）',
    params: {
      format: { type: 'string', description: '导出格式：text / json / markdown' },
    },
    // 必须是 'export_outline'：app 级桥的注册键是 `outline:export_outline`。
    // 原实现派发的是 'export'，键不匹配 → 无消费者 → 导出假成功（2026-09-17 体检）。
    run: async (args) => emitPluginEvent('outline', 'export_outline', args),
  },
  delete_node: {
    name: 'delete_node',
    description: '删除节点（含子树级联删除）',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
    },
    run: async (args) => emitPluginEvent('outline', 'delete_node', args),
  },
  batch_create: {
    name: 'batch_create',
    description: '从结构化数据一次创建多个节点',
    params: {
      structure: { type: 'object', description: '树形结构 { title, type, children?: [...] }' },
    },
    run: async (args) => emitPluginEvent('outline', 'batch_create', args),
  },
}

// ────────────────────────────────────────────────────────────
// 6. notebook（official.notebook）· 8 动作
// ────────────────────────────────────────────────────────────

const NOTEBOOK_ACTIONS: Record<string, SproutAction> = {
  create_note: {
    name: 'create_note',
    description: '创建笔记（Markdown 格式）',
    params: {
      content: { type: 'string', description: '笔记内容（Markdown 格式）' },
      noteType: { type: 'string', description: '类型：log / research / diagnosis / code' },
      folderId: { type: 'string', description: '文件夹 ID' },
      tags: { type: 'array', description: '标签列表' },
    },
    run: async (args) => emitPluginEvent('notebook', 'create_note', args),
  },
  update_note: {
    name: 'update_note',
    description: '更新笔记内容与标签',
    params: {
      noteId: { type: 'string', description: '笔记 ID', required: true },
      content: { type: 'string', description: '新内容' },
      tags: { type: 'array', description: '标签列表' },
    },
    run: async (args) => emitPluginEvent('notebook', 'update_note', args),
  },
  list_notes: {
    name: 'list_notes',
    description: '列出笔记（可按文件夹过滤、关键词搜索）',
    params: {
      folderId: { type: 'string', description: '文件夹 ID' },
      keyword: { type: 'string', description: '按关键词搜索' },
    },
    run: async (args) => emitPluginQuery('notebook', 'list_notes', args),
  },
  execute_code: {
    name: 'execute_code',
    description: '在笔记中执行代码单元格',
    params: {
      noteId: { type: 'string', description: '笔记 ID' },
      code: { type: 'string', description: '代码内容' },
    },
    run: async (args) => emitPluginEvent('notebook', 'execute_code', args),
  },
  create_backlink: {
    name: 'create_backlink',
    description: '创建笔记间双向链接',
    params: {
      sourceId: { type: 'string', description: '源笔记 ID' },
      targetId: { type: 'string', description: '目标笔记 ID' },
    },
    run: async (args) => emitPluginEvent('notebook', 'create_backlink', args),
  },
  export_note: {
    name: 'export_note',
    description: '导出笔记（markdown / html / pdf）',
    params: {
      noteId: { type: 'string', description: '笔记 ID' },
      format: { type: 'string', description: '导出格式：markdown / html / pdf' },
    },
    run: async (args) => emitPluginEvent('notebook', 'export_note', args),
  },
  search_notes: {
    name: 'search_notes',
    description: '全文搜索笔记内容',
    params: {
      query: { type: 'string', description: '搜索关键词' },
    },
    run: async (args) => emitPluginQuery('notebook', 'search_notes', args),
  },
  delete_note: {
    name: 'delete_note',
    description: '删除笔记',
    params: {
      noteId: { type: 'string', description: '笔记 ID', required: true },
    },
    run: async (args) => emitPluginEvent('notebook', 'delete_note', args),
  },
}

// ────────────────────────────────────────────────────────────
// 7. tactical-board（official.tactical-board）· 8 动作
// ────────────────────────────────────────────────────────────

const TACTICAL_ACTIONS: Record<string, SproutAction> = {
  deploy_unit: {
    name: 'deploy_unit',
    description: '部署单位到指定坐标与阵型',
    params: {
      unitId: { type: 'string', description: '单位 ID' },
      position: { type: 'object', description: '坐标 { x: number, y: number }' },
      formation: { type: 'string', description: '编队 / 阵型名称' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'deploy_unit', args),
  },
  move_unit: {
    name: 'move_unit',
    description: '移动战斗单位到新坐标',
    params: {
      unitId: { type: 'string', description: '单位 ID' },
      newPosition: { type: 'object', description: '新坐标 { x: number, y: number }' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'move_unit', args),
  },
  get_battle_state: {
    name: 'get_battle_state',
    description: '获取当前战场状态（全部单位、部署、地形）',
    run: async () => emitPluginQuery('tactical-board', 'get_battle_state'),
  },
  simulate_turn: {
    name: 'simulate_turn',
    description: '模拟一回合战斗（含攻击 / 移动 / 技能 / 防御行动）',
    params: {
      actions: { type: 'array', description: '行动列表 [{ unitId, action, target?, ... }]' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'simulate_turn', args),
  },
  export_battle_log: {
    name: 'export_battle_log',
    description: '导出战斗日志（json / markdown / html）',
    params: {
      format: { type: 'string', description: '导出格式：json / markdown / html' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'export_battle_log', args),
  },
  undo_move: {
    name: 'undo_move',
    description: '撤销上一步移动',
    params: {
      unitId: { type: 'string', description: '单位 ID' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'undo_move', args),
  },
  get_unit_stats: {
    name: 'get_unit_stats',
    description: '获取单位详细属性（HP / MP / 攻防速 / 技能列表）',
    params: {
      unitId: { type: 'string', description: '单位 ID' },
    },
    run: async (args) => emitPluginQuery('tactical-board', 'get_unit_stats', args),
  },
  set_terrain: {
    name: 'set_terrain',
    description: '设置战场地形',
    params: {
      terrainData: { type: 'object', description: '地形数据' },
    },
    run: async (args) => emitPluginEvent('tactical-board', 'set_terrain', args),
  },
}

// ────────────────────────────────────────────────────────────
// 8. magic（official.magic）· 7 动作
// ────────────────────────────────────────────────────────────

const MAGIC_ACTIONS: Record<string, SproutAction> = {
  create_skill_node: {
    name: 'create_skill_node',
    description: '创建技能节点',
    params: {
      name: { type: 'string', description: '技能名称', required: true },
      parentId: { type: 'string', description: '父节点 ID（root 表示根技能）' },
      cost: { type: 'number', description: '技能点花费' },
      description: { type: 'string', description: '技能描述' },
      effects: { type: 'object', description: '技能效果配置' },
    },
    run: async (args) => emitPluginEvent('magic', 'create_skill_node', args),
  },
  update_skill_node: {
    name: 'update_skill_node',
    description: '更新技能节点',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
      changes: { type: 'object', description: '要修改的字段 { name?, cost?, description?, effects? }' },
    },
    run: async (args) => emitPluginEvent('magic', 'update_skill_node', args),
  },
  get_skill_tree: {
    name: 'get_skill_tree',
    description: '获取完整技能树结构（含所有节点层级与效果）',
    run: async () => emitPluginQuery('magic', 'get_skill_tree'),
  },
  validate_tree: {
    name: 'validate_tree',
    description: '验证技能树（检查花费 / 效果 / 依赖合理性）',
    run: async () => emitPluginQuery('magic', 'validate_tree'),
  },
  export_skill_tree: {
    name: 'export_skill_tree',
    description: '导出技能树（json / png / svg）',
    params: {
      format: { type: 'string', description: '导出格式：json / png / svg' },
    },
    run: async (args) => emitPluginEvent('magic', 'export_skill_tree', args),
  },
  delete_skill_node: {
    name: 'delete_skill_node',
    description: '删除技能节点（含子节点级联删除）',
    params: {
      nodeId: { type: 'string', description: '节点 ID', required: true },
    },
    run: async (args) => emitPluginEvent('magic', 'delete_skill_node', args),
  },
  check_dependencies: {
    name: 'check_dependencies',
    description: '检查技能前置依赖是否满足',
    params: {
      nodeId: { type: 'string', description: '节点 ID' },
    },
    run: async (args) => emitPluginQuery('magic', 'check_dependencies', args),
  },
}

// ────────────────────────────────────────────────────────────
// 9. module-builder（official.module-builder）· 4 动作
// ────────────────────────────────────────────────────────────

const MODULE_BUILDER_ACTIONS: Record<string, SproutAction> = {
  create_module: {
    name: 'create_module',
    description: '创建自定义模块',
    params: {
      name: { type: 'string', description: '模块名称', required: true },
      description: { type: 'string', description: '模块描述' },
      layout: { type: 'string', description: '布局类型：dashboard / editor / manager / analyzer' },
    },
    run: async (args) => emitPluginEvent('module-builder', 'create_module', args),
  },
  delete_module: {
    name: 'delete_module',
    description: '删除模块',
    params: {
      moduleId: { type: 'string', description: '模块 ID', required: true },
    },
    run: async (args) => emitPluginEvent('module-builder', 'delete_module', args),
  },
  list_modules: {
    name: 'list_modules',
    description: '列出所有自定义模块',
    run: async () => emitPluginQuery('module-builder', 'list_modules'),
  },
  reorder_components: {
    name: 'reorder_components',
    description: '重新排列模块内组件顺序',
    params: {
      moduleId: { type: 'string', description: '模块 ID' },
      componentIds: { type: 'array', description: '组件 ID 新顺序' },
    },
    run: async (args) => emitPluginEvent('module-builder', 'reorder_components', args),
  },
}

// ────────────────────────────────────────────────────────────
// 10. entity_type 系（10 芽 · 每芽 4 动作）
// ────────────────────────────────────────────────────────────

interface EntityTypeSproutConfig {
  sproutId: string
  pluginId: string
  entityType: string
  label: string
  filterFields: string[]
}

const ENTITY_TYPE_SPROUT_CONFIGS: EntityTypeSproutConfig[] = [
  { sproutId: 'official.characters', pluginId: 'character', entityType: 'character', label: '角色', filterFields: ['role', 'affiliation', 'race', 'gender'] },
  { sproutId: 'official.culture', pluginId: 'culture', entityType: 'culture', label: '文化条目', filterFields: ['cultureType'] },
  { sproutId: 'official.languages', pluginId: 'language', entityType: 'language', label: '语言', filterFields: ['langType', 'scope', 'maturity'] },
  { sproutId: 'official.conflict', pluginId: 'conflict', entityType: 'conflict', label: '冲突', filterFields: ['conflictType', 'scale'] },
  { sproutId: 'official.buildings', pluginId: 'building', entityType: 'building', label: '建筑', filterFields: ['buildingType', 'style', 'status'] },
  { sproutId: 'official.items', pluginId: 'item', entityType: 'item', label: '道具', filterFields: ['itemType', 'rarity', 'condition'] },
  { sproutId: 'official.concepts', pluginId: 'concept', entityType: 'concept', label: '概念', filterFields: ['conceptType'] },
  { sproutId: 'official.combat_stats', pluginId: 'combat_stat', entityType: 'combat_stat', label: '战力条目', filterFields: ['system', 'culture'] },
  { sproutId: 'official.apparel', pluginId: 'apparel', entityType: 'apparel', label: '服饰', filterFields: ['apparelType', 'armorClass', 'style'] },
  { sproutId: 'official.inspiration', pluginId: 'inspiration', entityType: 'inspiration', label: '素材', filterFields: ['materialType'] },
]

/** 过滤字段的中性说明（说明目录用） */
const FILTER_FIELD_DESCRIPTIONS: Record<string, string> = {
  role: '按 role 过滤',
  affiliation: '按 affiliation 过滤',
  race: '按 race 过滤',
  gender: '按 gender 过滤',
  cultureType: '按 cultureType 过滤',
  langType: '按 langType 过滤',
  scope: '按 scope 过滤',
  maturity: '按 maturity 过滤',
  conflictType: '按 conflictType 过滤',
  scale: '按 scale 过滤',
  buildingType: '按 buildingType 过滤',
  style: '按 style 过滤',
  status: '按 status 过滤',
  itemType: '按 itemType 过滤',
  rarity: '按 rarity 过滤',
  condition: '按 condition 过滤',
  conceptType: '按 conceptType 过滤',
  system: '按 system 过滤',
  culture: '按 culture 过滤',
  apparelType: '按 apparelType 过滤',
  armorClass: '按 armorClass 过滤',
  materialType: '按 materialType 过滤',
}

function buildEntityTypeActions(config: EntityTypeSproutConfig): Record<string, SproutAction> {
  const { entityType, label, filterFields } = config
  const listParams: Record<string, SproutActionParam> = {}
  for (const field of filterFields) {
    listParams[field] = { type: 'string', description: FILTER_FIELD_DESCRIPTIONS[field] || `按 ${field} 过滤` }
  }
  return {
    list: {
      name: 'list',
      description: `列出${label}（可按字段过滤）`,
      params: Object.keys(listParams).length > 0 ? listParams : undefined,
      run: async (args, ctx) => {
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
      },
    },
    create: {
      name: 'create',
      description: `创建${label}`,
      params: {
        name: { type: 'string', description: '实体名称', required: true },
        description: { type: 'string', description: '描述' },
        properties: { type: 'object', description: '属性字段' },
        tags: { type: 'array', description: '标签列表' },
      },
      run: async (args, ctx) => {
        const entities = await ctx.stores.entity.getAllEntities()
        const duplicate = entities.some((e: any) => e.type === entityType && e.name === String(args.name))
        if (duplicate) {
          return JSON.stringify({ error: `已存在同名${label} "${args.name}"`, hint: `请使用不同名称或先用 worldview(sprout='${label}', action='list') 查看` })
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
      },
    },
    update: {
      name: 'update',
      description: `更新${label}（增量）`,
      params: {
        entityId: { type: 'string', description: '实体 ID', required: true },
        changes: { type: 'object', description: '要修改的字段' },
      },
      run: async (args, ctx) => {
        const entityId = String(args.entityId)
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
      },
    },
    get_detail: {
      name: 'get_detail',
      description: `获取${label}详情`,
      params: {
        entityId: { type: 'string', description: '实体 ID', required: true },
      },
      run: async (args, ctx) => {
        const entityId = String(args.entityId)
        const existing = await ctx.stores.entity.getById(entityId)
        if (!existing) return JSON.stringify({ error: `${label} ${entityId} 不存在` })
        return JSON.stringify({
          id: existing.id, name: existing.name, description: existing.description || '',
          properties: existing.properties || {}, tags: existing.tags || [],
          createdAt: existing.createdAt, updatedAt: existing.updatedAt,
        })
      },
    },
  }
}

// ────────────────────────────────────────────────────────────
// 总表
// ────────────────────────────────────────────────────────────

export const SPROUT_ACTIONS: SproutActionTable = {
  'official.timeline': TIMELINE_ACTIONS,
  'official.graph': GRAPH_ACTIONS,
  'official.mindmap': MINDMAP_ACTIONS,
  'official.manuscript': MANUSCRIPT_ACTIONS,
  'official.outline': OUTLINE_ACTIONS,
  'official.notebook': NOTEBOOK_ACTIONS,
  'official.tactical-board': TACTICAL_ACTIONS,
  'official.magic': MAGIC_ACTIONS,
  'official.module-builder': MODULE_BUILDER_ACTIONS,
  ...Object.fromEntries(
    ENTITY_TYPE_SPROUT_CONFIGS.map((c) => [c.sproutId, buildEntityTypeActions(c)]),
  ),
}
