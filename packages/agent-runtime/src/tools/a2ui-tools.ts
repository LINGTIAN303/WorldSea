import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import type { A2UIMessage, A2UIComponent } from '../bridge-types'

const WORLD_SMITH_CATALOG = 'https://worldsea.app/catalog/v1'

export const a2uiCreateSurface: ToolDefinition = {
  name: 'ui_create_surface',
  description: '创建一个交互式 UI 画布，用于展示表单、卡片、数据面板等。返回 surfaceId。使用场景：需要向用户展示结构化信息、收集用户输入、创建交互式操作界面。',
  parameters: {
    surfaceId: { type: 'string', description: '画布唯一标识，如 "entity-card-1"、"search-results"', required: true },
    catalogId: { type: 'string', description: '组件目录 ID，默认使用 WorldSea 目录', required: false },
  },
  meta: {
    permission: 'moderate',
    readOnly: false,
    sideEffectScope: 'session',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'a2ui',
    displayName: '创建 UI 面',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const surfaceId = String(args.surfaceId)
    const catalogId = String(args.catalogId || WORLD_SMITH_CATALOG)
    const msg: A2UIMessage = {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId },
    }
    ctx.emitA2UI?.(surfaceId, msg)
    return JSON.stringify({ ok: true, surfaceId, catalogId })
  },
}

export const a2uiUpdateComponents: ToolDefinition = {
  name: 'ui_update_components',
  description: '定义画布上的 UI 组件布局。组件类型包括：Text(文本)、Button(按钮)、TextField(输入框)、Slider(滑块)、CheckBox(复选框)、ChoicePicker(选择器)、DateTimeInput(日期)、Card(卡片)、Row/Column(布局)、List(列表)、Tabs(标签页)、EntityCard(实体卡片)、StatBar(统计条)、TagGroup(标签组)、ConfirmBar(确认栏)、plan_board(计划板)、json_view(JSON视图)、svg_view(SVG视图)、mermaid_view(Mermaid图表)。',
  parameters: {
    surfaceId: { type: 'string', description: '目标画布 ID', required: true },
    components: {
      type: 'array',
      description: '组件定义数组，每个组件需有 id、component(类型名) 和对应属性',
      required: true,
      items: { type: 'object', description: '{ id: string, component: string, ...属性 }' },
    },
  },
  meta: {
    permission: 'moderate',
    readOnly: false,
    sideEffectScope: 'session',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'a2ui',
    displayName: '更新 UI 组件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const surfaceId = String(args.surfaceId)
    const components = (args.components as A2UIComponent[]) || []
    const msg: A2UIMessage = {
      version: 'v0.9',
      updateComponents: { surfaceId, components },
    }
    ctx.emitA2UI?.(surfaceId, msg)
    return JSON.stringify({ ok: true, surfaceId, componentCount: components.length })
  },
}

export const a2uiUpdateData: ToolDefinition = {
  name: 'ui_update_data',
  description: '向画布填充数据，绑定到组件的 dataModel。数据通过 binding 路径与组件关联。使用场景：更新实体卡片的数据、填充表单默认值、刷新统计数字。',
  parameters: {
    surfaceId: { type: 'string', description: '目标画布 ID', required: true },
    path: { type: 'string', description: '数据路径，如 /entity、/form、/stats', required: true },
    value: { type: 'object', description: '要设置的数据值', required: true },
  },
  meta: {
    permission: 'moderate',
    readOnly: false,
    sideEffectScope: 'session',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'a2ui',
    displayName: '更新 UI 数据',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const surfaceId = String(args.surfaceId)
    const path = String(args.path)
    const value = args.value
    const msg: A2UIMessage = {
      version: 'v0.9',
      updateDataModel: { surfaceId, path, value },
    }
    ctx.emitA2UI?.(surfaceId, msg)
    return JSON.stringify({ ok: true, surfaceId, path })
  },
}

export const a2uiDeleteSurface: ToolDefinition = {
  name: 'ui_delete_surface',
  description: '删除一个交互式 UI 画布。使用场景：用户关闭面板、操作完成后清理界面。',
  parameters: {
    surfaceId: { type: 'string', description: '要删除的画布 ID', required: true },
  },
  meta: {
    permission: 'dangerous',
    readOnly: false,
    sideEffectScope: 'session',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: true,
    category: 'a2ui',
    displayName: '删除 UI 面',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const surfaceId = String(args.surfaceId)
    const msg: A2UIMessage = {
      version: 'v0.9',
      deleteSurface: { surfaceId },
    }
    ctx.emitA2UI?.(surfaceId, msg)
    return JSON.stringify({ ok: true, surfaceId, deleted: true })
  },
}

export const a2uiTools: ToolDefinition[] = [
  a2uiCreateSurface,
  a2uiUpdateComponents,
  a2uiUpdateData,
  a2uiDeleteSurface,
]
