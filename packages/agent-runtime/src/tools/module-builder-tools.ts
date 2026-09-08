/**
 * 模块构建器工具集
 *
 * 在自定义模块编辑器中操作 UI 组件布局。
 * 支持 24 种组件类型，提供添加/移除/配置/建议布局四种操作。
 *
 * 这些工具是操作引导型而非直接执行型——返回确认消息后
 * 由前端自定义模块编辑器处理实际的组件操作。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/**
 * module_builder_add_component — 向模块添加组件
 * 校验组件类型是否在 24 种支持类型列表中
 */
export const moduleBuilderAddComponentTool: ToolDefinition = {
  name: 'module_builder_add_component',
  description: '在自定义模块编辑器中添加组件到指定槽位。支持 24 种组件类型：detail-panel/edit-form/property-panel/field-group/toolbar/action-button/batch-actions/context-menu/quick-actions/search-box/filter-bar/sort-control/entity-list/entity-grid/entity-table/kanban-board/entity-card/chart-bar/chart-pie/chart-line/relation-graph/tab-container/accordion-container/split-panel。需用户确认。',
  parameters: {
    moduleId: { type: 'string', description: '目标自定义模块ID', required: true },
    slotId: { type: 'string', description: '目标槽位ID', required: true },
    componentType: { type: 'string', description: '组件类型ID（如 entity-list, chart-bar）', required: true },
    zoneIndex: { type: 'number', description: '目标区域索引（默认0）', required: false },
    config: { type: 'object', description: '组件配置（如 {entityType: "character", showDescription: true}）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '添加组件',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const moduleId = String(args.moduleId)
    const slotId = String(args.slotId)
    const componentType = String(args.componentType)
    const zoneIndex = Number(args.zoneIndex || 0)
    const config = (args.config as Record<string, unknown>) || {}

    const validTypes = [
      'detail-panel', 'edit-form', 'property-panel', 'field-group',
      'toolbar', 'action-button', 'batch-actions', 'context-menu', 'quick-actions',
      'search-box', 'filter-bar', 'sort-control',
      'entity-list', 'entity-grid', 'entity-table', 'kanban-board', 'entity-card',
      'chart-bar', 'chart-pie', 'chart-line', 'relation-graph',
      'tab-container', 'accordion-container', 'split-panel',
    ]
    if (!validTypes.includes(componentType)) {
      return JSON.stringify({ ok: false, error: `不支持的组件类型: ${componentType}，可用: ${validTypes.join('/')}` })
    }

    return JSON.stringify({
      ok: true,
      action: 'add_component',
      moduleId, slotId, componentType, zoneIndex, config,
      message: `请在编辑器中确认添加 ${componentType} 组件`,
    })
  },
}

/** module_builder_remove_component — 从模块移除指定组件 */
export const moduleBuilderRemoveComponentTool: ToolDefinition = {
  name: 'module_builder_remove_component',
  description: '从自定义模块编辑器中移除指定组件。',
  parameters: {
    moduleId: { type: 'string', description: '目标自定义模块ID', required: true },
    componentId: { type: 'string', description: '要移除的组件ID', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '移除组件',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const moduleId = String(args.moduleId)
    const componentId = String(args.componentId)

    return JSON.stringify({
      ok: true,
      action: 'remove_component',
      moduleId, componentId,
      message: `请在编辑器中确认移除组件 ${componentId}`,
    })
  },
}

/** module_builder_update_config — 更新组件配置（合并更新） */
export const moduleBuilderUpdateConfigTool: ToolDefinition = {
  name: 'module_builder_update_config',
  description: '更新自定义模块编辑器中指定组件的配置。',
  parameters: {
    moduleId: { type: 'string', description: '目标自定义模块ID', required: true },
    componentId: { type: 'string', description: '组件ID', required: true },
    config: { type: 'object', description: '新的配置（合并更新）', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    displayName: '更新配置',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const moduleId = String(args.moduleId)
    const componentId = String(args.componentId)
    const config = args.config as Record<string, unknown>

    return JSON.stringify({
      ok: true,
      action: 'update_config',
      moduleId, componentId, config,
      message: `请在编辑器中确认更新组件 ${componentId} 的配置`,
    })
  },
}

/** module_builder_suggest_layout — 根据描述建议布局方案 */
export const moduleBuilderSuggestLayoutTool: ToolDefinition = {
  name: 'module_builder_suggest_layout',
  description: '根据用户描述，建议自定义模块的布局方案。返回推荐的槽位结构和组件配置。',
  parameters: {
    moduleId: { type: 'string', description: '目标自定义模块ID', required: true },
    description: { type: 'string', description: '用户对模块功能的描述（如"角色管理，带搜索和详情面板"）', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'plugin',
    displayName: '建议布局',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const moduleId = String(args.moduleId)
    const description = String(args.description)

    return JSON.stringify({
      ok: true,
      action: 'suggest_layout',
      moduleId, description,
      message: `正在为"${description}"生成布局建议，请在编辑器中查看`,
    })
  },
}

export const moduleBuilderTools: ToolDefinition[] = [
  moduleBuilderAddComponentTool,
  moduleBuilderRemoveComponentTool,
  moduleBuilderUpdateConfigTool,
  moduleBuilderSuggestLayoutTool,
]
