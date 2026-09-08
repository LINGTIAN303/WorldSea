import type { LibraryDescriptor, CapabilityDeclaration, AvailabilitySpec } from '@worldsea/agent-runtime/toolbus/capability-types.ts'
import type { ToolParameter } from '@worldsea/agent-runtime/bridge-types'
import { a2uiCreateSurface, a2uiUpdateComponents, a2uiUpdateData, a2uiDeleteSurface } from '@worldsea/agent-runtime/tools/a2ui-tools'
import { a2uiShowEntity, a2uiShowRelation } from '@worldsea/agent-runtime/tools/a2ui-helpers'

const A2UI_AVAILABILITY: AvailabilitySpec = {
  platforms: ['web', 'tauri'],
  chain: ['internal'],
  requiresUI: true,
}

export const uiKitDescriptor: LibraryDescriptor = {
  id: '@worldsea/ui-kit',
  name: 'A2UI Surface & Components',
  version: '0.1.0',
  capabilities: [
    {
      id: 'ui.surface.create',
      name: 'Create A2UI Surface',
      description: '创建一个交互式 UI 画布，用于展示表单、卡片、数据面板等。返回 surfaceId。使用场景：需要向用户展示结构化信息、收集用户输入、创建交互式操作界面。',
      category: 'render',
      parameters: {
        surfaceId: { type: 'string', description: '画布唯一标识，如 "entity-card-1"、"search-results"', required: true } satisfies ToolParameter,
        catalogId: { type: 'string', description: '组件目录 ID，默认使用 WorldSea 目录', required: false } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiCreateSurface.execute,
    },
    {
      id: 'ui.components.update',
      name: 'Update A2UI Components',
      description: '定义画布上的 UI 组件布局。组件类型包括：Text(文本)、Button(按钮)、TextField(输入框)、Slider(滑块)、CheckBox(复选框)、ChoicePicker(选择器)、DateTimeInput(日期)、Card(卡片)、Row/Column(布局)、List(列表)、Tabs(标签页)、EntityCard(实体卡片)、StatBar(统计条)、TagGroup(标签组)、ConfirmBar(确认栏)、plan_board(计划板)、json_view(JSON视图)、svg_view(SVG视图)、mermaid_view(Mermaid图表)。',
      category: 'render',
      parameters: {
        surfaceId: { type: 'string', description: '目标画布 ID', required: true } satisfies ToolParameter,
        components: {
          type: 'array',
          description: '组件定义数组，每个组件需有 id、component(类型名) 和对应属性',
          required: true,
          items: { type: 'object', description: '{ id: string, component: string, ...属性 }' },
        } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiUpdateComponents.execute,
    },
    {
      id: 'ui.data.update',
      name: 'Update A2UI Data Model',
      description: '向画布填充数据，绑定到组件的 dataModel。数据通过 binding 路径与组件关联。使用场景：更新实体卡片的数据、填充表单默认值、刷新统计数字。',
      category: 'render',
      parameters: {
        surfaceId: { type: 'string', description: '目标画布 ID', required: true } satisfies ToolParameter,
        path: { type: 'string', description: '数据路径，如 /entity、/form、/stats', required: true } satisfies ToolParameter,
        value: { type: 'object', description: '要设置的数据值', required: true } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiUpdateData.execute,
    },
    {
      id: 'ui.surface.delete',
      name: 'Delete A2UI Surface',
      description: '删除一个交互式 UI 画布。使用场景：用户关闭面板、操作完成后清理界面。',
      category: 'render',
      parameters: {
        surfaceId: { type: 'string', description: '要删除的画布 ID', required: true } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiDeleteSurface.execute,
    },
    {
      id: 'ui.entity.show',
      name: 'Show Entity Card',
      description: '快捷方式：用 A2UI EntityCard 展示单个实体的详细信息。自动创建画布并填充数据。使用场景：向用户展示实体的完整信息卡片。',
      category: 'render',
      parameters: {
        entityId: { type: 'string', description: '要展示的实体 ID', required: true } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiShowEntity.execute,
    },
    {
      id: 'ui.relation.show',
      name: 'Show Relation',
      description: '快捷方式：用 A2UI 展示关系详情。自动创建画布并填充数据。使用场景：向用户展示两个实体之间的关系详情。',
      category: 'render',
      parameters: {
        relationId: { type: 'string', description: '要展示的关系 ID', required: true } satisfies ToolParameter,
      },
      availability: A2UI_AVAILABILITY,
      execute: a2uiShowRelation.execute,
    },
  ] satisfies CapabilityDeclaration[],
}
