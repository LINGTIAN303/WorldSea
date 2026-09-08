/** A2UI 辅助渲染函数：向 A2UI 画布发射 UI 组件，详细见 docs/details/注释/packages/agent-runtime/tools-a2ui-helpers.md */

import type { A2UIMessage, A2UIComponent } from '../bridge-types'
import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import type { WorldSeaToolContext } from './types'

/** WorldSea 应用组件目录 URL */
const WS_CATALOG = 'https://worldsea.app/catalog/v1'

/** 向指定 Surface 发射 A2UI 消息的内部辅助 */
function emit(ctx: WorldSeaToolContext, surfaceId: string, message: A2UIMessage): void {
  ctx.emitA2UI?.(surfaceId, message)
}

/**
 * 发射实体卡片到 A2UI 画布
 * 自动将数值属性渲染为 StatBar 组件，将 tags 渲染为 TagGroup
 */
export function emitEntityCard(
  ctx: WorldSeaToolContext,
  entity: { id: string; name: string; type: string; description?: string; properties?: Record<string, unknown>; tags?: string[]; coverImage?: string; coverPosition?: string; coverZoom?: number },
): void {
  const surfaceId = `entity-${entity.id}`
  emit(ctx, surfaceId, {
    version: 'v0.9',
    createSurface: { surfaceId, catalogId: WS_CATALOG },
  })

  const statKeys = Object.entries(entity.properties || {}).filter(([, v]) => typeof v === 'number').slice(0, 5)
  const childIds: string[] = ['entity-info']
  const extraComponents: A2UIComponent[] = []

  for (let i = 0; i < statKeys.length; i++) {
    const [key] = statKeys[i]
    childIds.push(`stat-${i}`)
    extraComponents.push({
      id: `stat-${i}`,
      component: 'StatBar',
      label: key,
      value: { path: `/entity/${key}` },
      min: 0,
      max: 10,
    })
  }

  if (entity.tags?.length) {
    childIds.push('tags')
    extraComponents.push({ id: 'tags', component: 'TagGroup', tags: { path: '/entity/tags' } })
  }

  childIds.push('actions')

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: childIds },
        { id: 'entity-info', component: 'EntityCard' },
        ...extraComponents,
        { id: 'actions', component: 'Row', children: ['btn-edit', 'btn-delete'] },
        { id: 'btn-edit', component: 'Button', variant: 'primary', text: '编辑', action: { event: { name: 'edit', data: { entityId: entity.id } } } },
        { id: 'btn-delete', component: 'Button', variant: 'danger', text: '删除', action: { event: { name: 'delete', data: { entityId: entity.id } } } },
      ],
    },
  })

  const props = entity.properties || {}
  const coverImage = entity.coverImage || props.coverImage || ''
  const coverPosition = entity.coverPosition || props.coverPosition || '50% 50%'
  const coverZoom = entity.coverZoom || props.coverZoom || 1

  const dataValue: Record<string, unknown> = {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    description: entity.description || '',
    tags: entity.tags || [],
    coverImage,
    coverPosition,
    coverZoom,
    ...Object.fromEntries(statKeys),
  }

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      path: '/entity',
      value: dataValue,
    },
  })
}

/** 发射实体列表到 A2UI 画布，最多展示 10 个 */
export function emitEntityList(
  ctx: WorldSeaToolContext,
  entities: { id: string; name: string; type: string; description?: string; tags?: string[]; properties?: Record<string, unknown>; coverImage?: string; coverPosition?: string; coverZoom?: number }[],
  title?: string,
): void {
  const surfaceId = `entity-list-${Date.now()}`
  emit(ctx, surfaceId, {
    version: 'v0.9',
    createSurface: { surfaceId, catalogId: WS_CATALOG },
  })

  const items = entities.slice(0, 10)
  const components: A2UIComponent[] = [
    { id: 'root', component: 'Column', children: ['title', 'list'] },
    { id: 'title', component: 'Text', text: title || '实体列表', variant: 'h3' },
    { id: 'list', component: 'List', children: items.map((_, i) => `card-${i}`) },
  ]

  for (let i = 0; i < items.length; i++) {
    components.push({
      id: `card-${i}`,
      component: 'EntityCard',
      dataPath: `/entities/${i}`,
      actions: [
        { name: 'view', label: '查看', variant: 'primary' },
        { name: 'edit', label: '编辑', variant: 'secondary' },
      ],
    })
  }

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: { surfaceId, components },
  })

  const listData: Record<string, unknown> = {}
  for (let i = 0; i < items.length; i++) {
    listData[String(i)] = items[i]
  }
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateDataModel: { surfaceId, path: '/entities', value: listData },
  })
}

/** 发射确认栏（确认/取消按钮） */
export function emitConfirmBar(
  ctx: WorldSeaToolContext,
  message: string,
  _actionName: string,
): void {
  const surfaceId = `confirm-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'ConfirmBar', message, confirmText: '确认', cancelText: '取消' },
      ],
    },
  })
}

/** 发射改造协商界面（retrofit 工作流的第一步） */
export function emitRetrofitNegotiate(
  ctx: WorldSeaToolContext,
  sessionId: string,
  intents: { type: string; description: string; warnings?: string[] }[],
): void {
  const surfaceId = `retrofit-${sessionId}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })

  const intentItemIds = intents.map((_, i) => `intent-${i}`)
  const warningIds: string[] = []
  const extraComponents: A2UIComponent[] = []

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i]
    if (intent.warnings && intent.warnings.length > 0) {
      for (let j = 0; j < intent.warnings.length; j++) {
        const warnId = `warn-${i}-${j}`
        warningIds.push(warnId)
        extraComponents.push({ id: warnId, component: 'Text', text: `⚠ ${intent.warnings[j]}`, variant: 'caption' })
      }
    }
  }

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['header', 'intent-list', 'warnings', 'actions'] },
        { id: 'header', component: 'Text', text: `🔧 改造协商 — ${sessionId}`, variant: 'h3' },
        { id: 'intent-list', component: 'List', children: intentItemIds },
        ...intents.map((_intent, i) => ({
          id: `intent-${i}`, component: 'EntityCard' as const, dataPath: `/intents/${i}`,
          actions: [
            { name: 'approve', label: '同意', variant: 'primary' as const },
            { name: 'reject', label: '拒绝', variant: 'danger' as const },
          ],
        })),
        ...extraComponents,
        { id: 'warnings', component: 'Column', children: warningIds },
        { id: 'actions', component: 'Row', children: ['btn-confirm', 'btn-redirect', 'btn-abort'] },
        { id: 'btn-confirm', component: 'Button', variant: 'primary', text: '确认计划', action: { event: { name: 'retrofit_confirm', data: { sessionId } } } },
        { id: 'btn-redirect', component: 'Button', variant: 'secondary', text: '改变想法', action: { event: { name: 'retrofit_redirect', data: { sessionId } } } },
        { id: 'btn-abort', component: 'Button', variant: 'danger', text: '终止改造', action: { event: { name: 'retrofit_abort', data: { sessionId } } } },
      ],
    },
  })

  const intentData: Record<string, unknown> = {}
  for (let i = 0; i < intents.length; i++) {
    intentData[String(i)] = { type: intents[i].type, description: intents[i].description }
  }
  emit(ctx, surfaceId, { version: 'v0.9', updateDataModel: { surfaceId, path: '/intents', value: intentData } })
}

/** 发射改造进度界面 */
export function emitRetrofitProgress(
  ctx: WorldSeaToolContext,
  sessionId: string,
  applied: number,
  total: number,
  currentIntentType: string,
): void {
  const surfaceId = `retrofit-${sessionId}`

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['header', 'progress', 'current', 'actions'] },
        { id: 'header', component: 'Text', text: `🔧 改造进行中 — ${sessionId}`, variant: 'h3' },
        { id: 'progress', component: 'StatBar', label: '进度', value: applied, min: 0, max: total },
        { id: 'current', component: 'Text', text: `正在应用: ${currentIntentType} (${applied}/${total})`, variant: 'body' },
        { id: 'actions', component: 'Row', children: ['btn-rollback', 'btn-redirect', 'btn-abort'] },
        { id: 'btn-rollback', component: 'Button', variant: 'secondary', text: '回滚上一步', action: { event: { name: 'retrofit_rollback', data: { sessionId } } } },
        { id: 'btn-redirect', component: 'Button', variant: 'secondary', text: '改变想法', action: { event: { name: 'retrofit_redirect', data: { sessionId } } } },
        { id: 'btn-abort', component: 'Button', variant: 'danger', text: '终止改造', action: { event: { name: 'retrofit_abort', data: { sessionId } } } },
      ],
    },
  })
}

/** 发射改造验收界面 */
export function emitRetrofitVerify(
  ctx: WorldSeaToolContext,
  sessionId: string,
  applied: number,
  rolledBack: number,
  healthy: boolean,
  issues: string[],
): void {
  const surfaceId = `retrofit-${sessionId}`
  const issueIds = issues.map((_, i) => `issue-${i}`)
  const statusIcon = healthy ? '✅' : '⚠️'
  const statusText = healthy ? '健康检查通过' : '健康检查发现问题'

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['header', 'status', 'stats', 'issues', 'actions'] },
        { id: 'header', component: 'Text', text: `🔧 改造验收 — ${sessionId}`, variant: 'h3' },
        { id: 'status', component: 'Text', text: `${statusIcon} ${statusText}`, variant: 'body' },
        { id: 'stats', component: 'Row', children: ['stat-applied', 'stat-rolled'] },
        { id: 'stat-applied', component: 'Text', text: `已应用: ${applied}`, variant: 'body' },
        { id: 'stat-rolled', component: 'Text', text: `已回滚: ${rolledBack}`, variant: 'body' },
        { id: 'issues', component: 'Column', children: issueIds },
        ...issues.map((issue, i) => ({ id: `issue-${i}`, component: 'Text' as const, text: `• ${issue}`, variant: 'caption' as const })),
        { id: 'actions', component: 'Row', children: healthy ? ['btn-accept', 'btn-repair'] : ['btn-repair', 'btn-abort'] },
        { id: 'btn-accept', component: 'Button', variant: 'primary', text: '验收通过', action: { event: { name: 'retrofit_accept', data: { sessionId } } } },
        { id: 'btn-repair', component: 'Button', variant: 'secondary', text: '需要修复', action: { event: { name: 'retrofit_repair', data: { sessionId } } } },
        { id: 'btn-abort', component: 'Button', variant: 'danger', text: '终止改造', action: { event: { name: 'retrofit_abort', data: { sessionId } } } },
      ],
    },
  })
}

/** 发射改造完成界面 */
export function emitRetrofitCompleted(
  ctx: WorldSeaToolContext,
  sessionId: string,
  applied: number,
  rolledBack: number,
  message: string,
): void {
  const surfaceId = `retrofit-${sessionId}`

  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['header', 'summary', 'stats'] },
        { id: 'header', component: 'Text', text: `✅ 改造完成 — ${sessionId}`, variant: 'h3' },
        { id: 'summary', component: 'Text', text: message, variant: 'body' },
        { id: 'stats', component: 'Row', children: ['stat-applied', 'stat-rolled'] },
        { id: 'stat-applied', component: 'Text', text: `已应用: ${applied}`, variant: 'body' },
        { id: 'stat-rolled', component: 'Text', text: `已回滚: ${rolledBack}`, variant: 'body' },
      ],
    },
  })
}

/** a2ui_show_entity 工具：展示单个实体的 A2UI 卡片 */
export const a2uiShowEntity: ToolDefinition = {
  name: 'a2ui_show_entity',
  description: '快捷方式：用 A2UI EntityCard 展示单个实体的详细信息。自动创建画布并填充数据。使用场景：向用户展示实体的完整信息卡片。',
  parameters: {
    entityId: { type: 'string', description: '要展示的实体 ID', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'a2ui',
    displayName: '展示实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityId = String(args.entityId)
    const entity = await ctx.stores.entity.getById(entityId)
    if (!entity) {
      return JSON.stringify({ ok: false, error: `实体 ${entityId} 不存在` })
    }
    emitEntityCard(ctx, entity)
    return JSON.stringify({ ok: true, entityId, message: `已展示实体: ${entity.name}` })
  },
}

/** a2ui_show_relation 工具：展示关系详情的 A2UI 视图 */
export const a2uiShowRelation: ToolDefinition = {
  name: 'a2ui_show_relation',
  description: '快捷方式：用 A2UI 展示关系详情。自动创建画布并填充数据。使用场景：向用户展示两个实体之间的关系详情。',
  parameters: {
    relationId: { type: 'string', description: '要展示的关系 ID', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'a2ui',
    displayName: '展示关系',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const relationId = String(args.relationId)
    const relations = await ctx.stores.relation.getAllRelations()
    const relation = relations.find((r: any) => r.id === relationId)
    if (!relation) {
      return JSON.stringify({ ok: false, error: `关系 ${relationId} 不存在` })
    }
    const sourceEntity = await ctx.stores.entity.getById(relation.sourceId)
    const targetEntity = await ctx.stores.entity.getById(relation.targetId)
    const surfaceId = `relation-${relationId}`
    ctx.emitA2UI?.(surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
    ctx.emitA2UI?.(surfaceId, {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['header', 'source', 'arrow', 'target', 'details'] },
          { id: 'header', component: 'Text', text: `关系: ${relation.label || relation.type}`, variant: 'h3' },
          { id: 'source', component: 'EntityCard', dataPath: '/source' },
          { id: 'arrow', component: 'Text', text: `→ ${relation.type} →`, variant: 'body' },
          { id: 'target', component: 'EntityCard', dataPath: '/target' },
          { id: 'details', component: 'Text', text: relation.label || '', variant: 'caption' },
        ],
      },
    })
    ctx.emitA2UI?.(surfaceId, {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        path: '/',
        value: {
          source: sourceEntity || { id: relation.sourceId, name: '未知', type: '' },
          target: targetEntity || { id: relation.targetId, name: '未知', type: '' },
        },
      },
    })
    return JSON.stringify({ ok: true, relationId, message: `已展示关系: ${relation.type}` })
  },
}

/** 发射可编辑表格到 A2UI 画布 */
export function emitEditableTable(
  ctx: WorldSeaToolContext,
  columns: { key: string; label: string; editable?: boolean }[],
  rows: Record<string, unknown>[],
  title?: string,
): void {
  const surfaceId = `table-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['title', 'table'] },
        ...(title ? [{ id: 'title', component: 'Text', text: title, variant: 'h3' }] : []),
        { id: 'table', component: 'EditableTable', columns, rows },
      ].filter(Boolean),
    },
  })
}

/** 发射图表到 A2UI 画布 */
export function emitChartView(
  ctx: WorldSeaToolContext,
  chartType: string,
  option: Record<string, unknown>,
  title?: string,
): void {
  const surfaceId = `chart-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['title', 'chart'] },
        ...(title ? [{ id: 'title', component: 'Text', text: title, variant: 'h3' }] : []),
        { id: 'chart', component: 'ChartView', chartType, option },
      ].filter(Boolean),
    },
  })
}

/** 发射 Mermaid 图表到 A2UI 画布 */
export function emitMermaidRender(
  ctx: WorldSeaToolContext,
  code: string,
  title?: string,
): void {
  const surfaceId = `mermaid-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['title', 'diagram'] },
        ...(title ? [{ id: 'title', component: 'Text', text: title, variant: 'h3' }] : []),
        { id: 'diagram', component: 'MermaidRender', code },
      ].filter(Boolean),
    },
  })
}

/** 发射建议选择器到 A2UI 画布 */
export function emitSuggestionPicker(
  ctx: WorldSeaToolContext,
  title: string,
  options: { id: string; label: string; description?: string }[],
): void {
  const surfaceId = `suggestions-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [{ id: 'root', component: 'SuggestionPicker', title, options }],
    },
  })
}

/** 发射文件预览到 A2UI 画布 */
export function emitFilePreview(
  ctx: WorldSeaToolContext,
  file: { fileName: string; fileType: string; summary: string; fileId?: string },
  suggestions: { target: string; reason: string }[],
): void {
  const surfaceId = `file-preview-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [{ id: 'root', component: 'FilePreview', ...file, suggestions }],
    },
  })
}

/** 发射代码块到 A2UI 画布 */
export function emitCodeBlock(
  ctx: WorldSeaToolContext,
  language: string,
  code: string,
  runnable: boolean = false,
  noteId?: string,
): void {
  const surfaceId = `code-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [{ id: 'root', component: 'CodeBlock', language, code, runnable, noteId }],
    },
  })
}

/** 发射实体链接到 A2UI 画布 */
export function emitEntityLink(
  ctx: WorldSeaToolContext,
  entityId: string,
  name: string,
  entityType: string,
): void {
  const surfaceId = `entity-link-${Date.now()}`
  emit(ctx, surfaceId, { version: 'v0.9', createSurface: { surfaceId, catalogId: WS_CATALOG } })
  emit(ctx, surfaceId, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [{ id: 'root', component: 'EntityLink', entityId, name, entityType }],
    },
  })
}

export const a2uiHelperTools: ToolDefinition[] = [a2uiShowEntity, a2uiShowRelation]
